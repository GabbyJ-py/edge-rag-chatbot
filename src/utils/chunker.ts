// =============================================================================
// Text Chunking Engine
//
// Strategy: Fixed-size character windows with overlap.
//   - Chunk size:  500 characters  (fits comfortably in embedding context)
//   - Overlap:      50 characters  (preserves cross-boundary context)
//
// The chunker also handles Portable Text → plain text extraction so callers
// never need to worry about the raw Sanity block format.
// =============================================================================

import type { PortableTextBlock, TextChunk } from "../types.js";

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Converts a Sanity document's body field (Portable Text or plain string)
 * into an array of overlapping text chunks.
 *
 * @param documentId - The Sanity `_id` used to build stable chunk IDs.
 * @param rawBody    - The `body` or `content` field from the Sanity document.
 * @returns          - Array of TextChunk objects ready for embedding.
 */
export function chunkDocument(
  documentId: string,
  rawBody: PortableTextBlock[] | string | undefined | null
): TextChunk[] {
  if (!rawBody) {
    console.warn(`[chunker] Document ${documentId} has no body — skipping.`);
    return [];
  }

  const plainText =
    typeof rawBody === "string"
      ? rawBody
      : portableTextToPlainText(rawBody);

  const trimmed = plainText.trim();
  if (!trimmed) {
    console.warn(`[chunker] Document ${documentId} produced empty plain text.`);
    return [];
  }

  return splitIntoChunks(documentId, trimmed);
}

// -----------------------------------------------------------------------------
// Portable Text → plain text extraction
// -----------------------------------------------------------------------------

/**
 * Walks a Portable Text block array and concatenates all text nodes,
 * inserting paragraph breaks between top-level blocks.
 */
export function portableTextToPlainText(
  blocks: PortableTextBlock[]
): string {
  const lines: string[] = [];

  for (const block of blocks) {
    // Standard text block
    if (block._type === "block" && Array.isArray(block.children)) {
      const line = block.children
        .map((span) => span.text ?? "")
        .join("")
        .trim();

      if (line) {
        lines.push(line);
      }
      continue;
    }

    // Fallback: block carries a top-level `text` property
    if (typeof block.text === "string" && block.text.trim()) {
      lines.push(block.text.trim());
    }
  }

  return lines.join("\n\n");
}

// -----------------------------------------------------------------------------
// Sliding-window chunker
// -----------------------------------------------------------------------------

/**
 * Splits a plain-text string into overlapping chunks of CHUNK_SIZE characters
 * with CHUNK_OVERLAP characters of context carried into the next chunk.
 *
 * The algorithm tries to break at whitespace to avoid splitting mid-word,
 * but falls back to a hard cut if no whitespace is found in the window.
 */
function splitIntoChunks(documentId: string, text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = start + CHUNK_SIZE;

    if (end < text.length) {
      // Walk back to the nearest whitespace to avoid splitting mid-word.
      let breakPoint = end;
      while (breakPoint > start && !/\s/.test(text[breakPoint])) {
        breakPoint--;
      }
      // If no whitespace was found in the chunk window, hard-cut at CHUNK_SIZE.
      if (breakPoint === start) {
        breakPoint = end;
      }
      end = breakPoint;
    } else {
      end = text.length;
    }

    const chunkText = text.slice(start, end).trim();

    if (chunkText.length > 0) {
      chunks.push({
        id: `${documentId}#chunk-${index}`,
        documentId,
        text: chunkText,
        index,
      });
      index++;
    }

    // Advance by (CHUNK_SIZE - CHUNK_OVERLAP) to create the sliding overlap.
    start = end - CHUNK_OVERLAP;

    // Safety guard: ensure we always make forward progress.
    if (start <= (chunks.length > 0 ? chunks[chunks.length - 1].index : -1)) {
      start = end;
    }
  }

  console.log(
    `[chunker] Document ${documentId} → ${chunks.length} chunk(s) ` +
      `(size=${CHUNK_SIZE}, overlap=${CHUNK_OVERLAP})`
  );

  return chunks;
}
