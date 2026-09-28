// =============================================================================
// POST /webhook/sync — Sanity → Cloudflare ingestion handler
//
// Security:   HMAC-SHA256 signature verification (x-sanity-signature header)
// On publish: chunk text → embed → upsert Vectorize + upsert D1
// On delete:  remove vectors from Vectorize + mark document deleted in D1
// =============================================================================

import type { Env, SanityDocument, SanityWebhookPayload } from "../types.js";
import { verifyWebhookSignature } from "../utils/crypto.js";
import { chunkDocument } from "../utils/chunker.js";

// Vectorize supports metadata values of these types.
type VectorizeMetadataValue = string | number | boolean | string[];

interface ChunkMetadata extends Record<string, VectorizeMetadataValue> {
  documentId: string;
  chunkIndex: number;
  text: string;
  title: string;
  slug: string;
}

// -----------------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------------

export async function handleWebhookSync(
  request: Request,
  env: Env
): Promise<Response> {
  // 1. Read the raw body BEFORE parsing JSON — HMAC operates on raw bytes.
  const rawBody = await request.text();

  // 2. Verify HMAC-SHA256 signature.
  const signature = request.headers.get("x-sanity-signature") ?? "";
  const isValid = await verifyWebhookSignature(
    rawBody,
    signature,
    env.SANITY_WEBHOOK_SECRET
  );

  if (!isValid) {
    console.error("[webhook] Invalid or missing HMAC signature — rejecting.");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Parse the verified payload.
  let payload: SanityWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SanityWebhookPayload;
  } catch {
    console.error("[webhook] Failed to parse JSON body.");
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 4. Detect operation type.
  //
  //    Sanity webhooks for "Document was published" include a full `document`
  //    object.  Webhooks for "Document was deleted / unpublished" omit it (or
  //    set a `_id` at root level with no document body).
  //
  //    We support two common Sanity webhook payload shapes:
  //    Shape A: { document: { _id, title, slug, body, ... } }
  //    Shape B: { _id: "...", _type: "..." }  (delete / unpublish)

  const document: SanityDocument | null =
    payload.document != null
      ? (payload.document as SanityDocument)
      : isRootLevelDocument(payload)
      ? (payload as unknown as SanityDocument)
      : null;

  if (!document || !document._id) {
    console.error("[webhook] Could not extract a document _id from payload.");
    return new Response(
      JSON.stringify({ error: "Cannot determine document identity" }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  const documentId = document._id;

  // 5. Route to publish or delete handler.
  const isDeletion =
    payload.document == null ||
    !hasBodyContent(document);

  if (isDeletion) {
    console.log(`[webhook] Delete operation detected for document: ${documentId}`);
    return handleDeletion(documentId, env);
  } else {
    console.log(`[webhook] Publish operation detected for document: ${documentId}`);
    return handlePublish(document, env);
  }
}

// -----------------------------------------------------------------------------
// Publish handler — chunk → embed → dual-write (Vectorize + D1)
// -----------------------------------------------------------------------------

async function handlePublish(
  document: SanityDocument,
  env: Env
): Promise<Response> {
  const documentId = document._id;
  const title = typeof document.title === "string" ? document.title : "Untitled";
  const slug = extractSlug(document);
  const rawBody = document.body ?? document.content ?? null;

  // 5a. Chunk the document text.
  const chunks = chunkDocument(documentId, rawBody as Parameters<typeof chunkDocument>[1]);

  if (chunks.length === 0) {
    console.warn(`[webhook] No chunks produced for ${documentId}. Skipping vectorize write.`);
    return new Response(
      JSON.stringify({ ok: true, documentId, chunksUpserted: 0, warning: "No content found" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 5b. Generate embeddings for all chunks in parallel (respecting Workers AI limits).
  //     bge-small-en-v1.5 produces 384-dimensional embeddings.
  console.log(`[webhook] Generating embeddings for ${chunks.length} chunks…`);

  const embeddingResults = await Promise.allSettled(
    chunks.map((chunk) =>
      env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [chunk.text] })
    )
  );

  // Collect successfully embedded chunks.
  const vectors: VectorizeVector[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const result = embeddingResults[i];
    if (result.status === "rejected") {
      console.error(`[webhook] Embedding failed for chunk ${chunks[i].id}:`, result.reason);
      continue;
    }

    const embeddingData = result.value as { data: number[][] };
    const vector = embeddingData?.data?.[0];
    if (!vector || vector.length === 0) {
      console.error(`[webhook] Empty embedding returned for chunk ${chunks[i].id}`);
      continue;
    }

    const metadata: ChunkMetadata = {
      documentId,
      chunkIndex: chunks[i].index,
      // Store the raw text in metadata so we can retrieve it without a
      // separate lookup.  Vectorize metadata is capped at 10 KB per vector.
      text: chunks[i].text.slice(0, 1000),
      title,
      slug,
    };

    vectors.push({
      id: chunks[i].id,
      values: vector,
      metadata,
    });
  }

  if (vectors.length === 0) {
    console.error(`[webhook] All embedding attempts failed for document ${documentId}`);
    return new Response(
      JSON.stringify({ error: "Embedding generation failed for all chunks" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // 5c. Upsert vectors to Vectorize.
  console.log(`[webhook] Upserting ${vectors.length} vector(s) to Vectorize…`);
  try {
    await env.VECTORIZE.upsert(vectors);
    console.log(`[webhook] Vectorize upsert complete for document ${documentId}`);
  } catch (err) {
    console.error("[webhook] Vectorize upsert failed:", err);
    return new Response(
      JSON.stringify({ error: "Vectorize upsert failed", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // 5d. Upsert document metadata to D1.
  console.log(`[webhook] Writing document metadata to D1 for ${documentId}…`);
  try {
    await env.DB.prepare(
      `INSERT INTO documents (id, title, slug, status, chunk_count, updated_at)
       VALUES (?1, ?2, ?3, 'published', ?4, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         title       = excluded.title,
         slug        = excluded.slug,
         status      = 'published',
         chunk_count = excluded.chunk_count,
         updated_at  = datetime('now')`
    )
      .bind(documentId, title, slug, vectors.length)
      .run();

    console.log(`[webhook] D1 upsert complete for document ${documentId}`);
  } catch (err) {
    console.error("[webhook] D1 write failed:", err);
    // We already wrote to Vectorize — log this inconsistency but don't fail
    // silently.  In production you'd enqueue a compensating job here.
    return new Response(
      JSON.stringify({
        error: "D1 write failed (Vectorize write succeeded — possible inconsistency)",
        detail: String(err),
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      documentId,
      title,
      slug,
      chunksUpserted: vectors.length,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// -----------------------------------------------------------------------------
// Deletion handler — remove from Vectorize + mark deleted in D1
// -----------------------------------------------------------------------------

async function handleDeletion(
  documentId: string,
  env: Env
): Promise<Response> {
  // We need the chunk count to build the vector IDs.
  // Fall back to scanning if not stored — we'll query D1 first.
  let chunkCount = 0;
  try {
    const row = await env.DB.prepare(
      "SELECT chunk_count FROM documents WHERE id = ?1"
    )
      .bind(documentId)
      .first<{ chunk_count: number }>();

    chunkCount = row?.chunk_count ?? 0;
  } catch (err) {
    console.warn(`[webhook] Could not read chunk_count from D1 for ${documentId}:`, err);
  }

  // Build the vector IDs we stored during publish.
  const vectorIds = Array.from(
    { length: chunkCount },
    (_, i) => `${documentId}#chunk-${i}`
  );

  // 6a. Delete vectors from Vectorize.
  if (vectorIds.length > 0) {
    console.log(
      `[webhook] Deleting ${vectorIds.length} vector(s) from Vectorize for ${documentId}…`
    );
    try {
      await env.VECTORIZE.deleteByIds(vectorIds);
      console.log(`[webhook] Vectorize delete complete for document ${documentId}`);
    } catch (err) {
      console.error("[webhook] Vectorize delete failed:", err);
      // Continue to mark D1 deleted even if Vectorize fails — this prevents
      // the document from appearing in RAG results.
    }
  } else {
    console.warn(
      `[webhook] No known chunk IDs for ${documentId} — skipping Vectorize delete.`
    );
  }

  // 6b. Mark document as deleted in D1.
  console.log(`[webhook] Marking document ${documentId} as deleted in D1…`);
  try {
    await env.DB.prepare(
      `UPDATE documents SET status = 'deleted', updated_at = datetime('now')
       WHERE id = ?1`
    )
      .bind(documentId)
      .run();
  } catch (err) {
    console.error("[webhook] D1 delete-mark failed:", err);
    return new Response(
      JSON.stringify({ error: "D1 update failed", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, documentId, deleted: true }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// -----------------------------------------------------------------------------
// Helper utilities
// -----------------------------------------------------------------------------

/** Extracts a string slug from the various Sanity slug shapes. */
function extractSlug(doc: SanityDocument): string {
  if (!doc.slug) return doc._id;
  if (typeof doc.slug === "string") return doc.slug;
  if (typeof doc.slug === "object" && "current" in doc.slug) {
    return (doc.slug as { current: string }).current;
  }
  return doc._id;
}

/** Checks whether a payload root looks like a Sanity document (Shape B). */
function isRootLevelDocument(payload: SanityWebhookPayload): boolean {
  return typeof payload._id === "string" && payload._id.length > 0;
}

/** Returns true if the document has any body content to chunk. */
function hasBodyContent(doc: SanityDocument): boolean {
  const body = doc.body ?? doc.content;
  if (!body) return false;
  if (typeof body === "string") return body.trim().length > 0;
  if (Array.isArray(body)) return body.length > 0;
  return false;
}
