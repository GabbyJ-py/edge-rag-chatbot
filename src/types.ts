// =============================================================================
// Shared type definitions for the RAG Chatbot Worker
// =============================================================================

/**
 * Cloudflare Worker environment bindings.
 * These must exactly match the binding names in wrangler.jsonc.
 */
export interface Env {
  // Cloudflare Workers AI — embeddings + LLM generation
  AI: Ai;

  // Cloudflare Vectorize — semantic vector store
  VECTORIZE: VectorizeIndex;

  // Cloudflare D1 — relational metadata database
  DB: D1Database;

  // Secret: shared key for Sanity HMAC-SHA256 webhook verification.
  // Set via: wrangler secret put SANITY_WEBHOOK_SECRET
  SANITY_WEBHOOK_SECRET: string;

  // General environment tag
  ENVIRONMENT: string;
}

// -----------------------------------------------------------------------------
// Sanity Webhook payload shapes
// -----------------------------------------------------------------------------

/** Portable Text block (simplified — enough for text extraction) */
export interface PortableTextBlock {
  _type: string;
  _key?: string;
  style?: string;
  children?: Array<{
    _type: string;
    _key?: string;
    text?: string;
    marks?: string[];
  }>;
  text?: string; // Some block types carry text directly
}

/** Sanity document as it arrives in the webhook body */
export interface SanityDocument {
  _id: string;
  _type: string;
  _rev?: string;
  title?: string;
  slug?: { current: string } | string;
  // Body can be Portable Text blocks or a plain string
  body?: PortableTextBlock[] | string;
  content?: PortableTextBlock[] | string;
  // Any other fields the CMS sends
  [key: string]: unknown;
}

/** Shape of the full Sanity webhook POST body */
export interface SanityWebhookPayload {
  /** Populated on create/update */
  _id?: string;
  /** The full document on publish */
  document?: SanityDocument;
  /** Some webhook configs embed the doc at root level */
  [key: string]: unknown;
}

// -----------------------------------------------------------------------------
// Internal chunk representation
// -----------------------------------------------------------------------------

export interface TextChunk {
  /** Globally unique ID: `{documentId}#chunk-{index}` */
  id: string;
  /** The source Sanity document ID */
  documentId: string;
  /** The text content of this chunk */
  text: string;
  /** Sequential index within the document */
  index: number;
}
