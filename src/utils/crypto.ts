// =============================================================================
// HMAC-SHA256 Webhook Signature Verification
// Uses the Web Crypto API — no Node.js dependencies required.
// =============================================================================

/**
 * Verifies a Sanity webhook HMAC-SHA256 signature.
 *
 * Sanity signs the raw request body with the shared secret and sends the
 * base64-encoded result in the `x-sanity-signature` header.
 *
 * @param rawBody   - Raw UTF-8 request body string (before JSON.parse).
 * @param signature - Value of the `x-sanity-signature` request header.
 * @param secret    - The shared webhook secret stored as a Worker secret.
 * @returns         - `true` if the signature is valid, `false` otherwise.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) {
    console.warn("[crypto] Missing signature or secret — rejecting request.");
    return false;
  }

  try {
    const encoder = new TextEncoder();

    // Import the shared secret as an HMAC-SHA256 key.
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,       // not extractable
      ["verify"]   // only used for verification
    );

    // Decode the base64 signature from the header.
    // Cast through ArrayBuffer to satisfy the strict Workers types BufferSource.
    const sigBytes = base64ToArrayBuffer(signature);

    // Verify the signature against the raw body bytes.
    const isValid = await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      sigBytes,
      encoder.encode(rawBody)
    );

    return isValid;
  } catch (err) {
    console.error("[crypto] Signature verification threw an error:", err);
    return false;
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Decodes a standard or URL-safe base64 string to an ArrayBuffer.
 * Using ArrayBuffer directly avoids the Uint8Array<SharedArrayBuffer> type
 * conflict with the Web Crypto API's BufferSource constraint.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Normalise URL-safe base64 to standard base64.
  const normalized = base64
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");

  const binaryStr = atob(normalized);
  const buffer = new ArrayBuffer(binaryStr.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binaryStr.length; i++) {
    view[i] = binaryStr.charCodeAt(i);
  }
  return buffer;
}
