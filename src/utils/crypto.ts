// =============================================================================
// HMAC-SHA256 Webhook Signature Verification
// Uses the Web Crypto API — no Node.js dependencies required.
//
// Sanity uses a Stripe-style signature scheme:
//   Header:  sanity-webhook-signature: t=<ms-timestamp>,v1=<base64url-sig>
//   Payload: HMAC-SHA256(`${timestamp}.${rawBody}`, secret)
// =============================================================================

/**
 * Verifies a Sanity webhook HMAC-SHA256 signature.
 *
 * @param rawBody   - Raw UTF-8 request body string (before JSON.parse).
 * @param signature - Value of the `sanity-webhook-signature` request header.
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
    // Parse Stripe-style header: t=<timestamp>,v1=<sig>
    const parts = Object.fromEntries(
      signature.split(",").map((part) => part.split("=") as [string, string])
    );

    const timestamp = parts["t"];
    const v1 = parts["v1"];

    if (!timestamp || !v1) {
      console.warn("[crypto] Signature header missing t= or v1= fields.");
      return false;
    }

    const encoder = new TextEncoder();

    // Import the shared secret as an HMAC-SHA256 key.
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Sanity signs: `${timestamp}.${rawBody}`
    const signedPayload = `${timestamp}.${rawBody}`;

    // Decode the base64url signature (no padding).
    const sigBytes = base64UrlToArrayBuffer(v1);

    // Verify the signature against the signed payload bytes.
    const isValid = await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      sigBytes,
      encoder.encode(signedPayload)
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
 * Decodes a base64url string (no padding) to an ArrayBuffer.
 */
function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  // Convert base64url → standard base64 and add padding.
  const base64 = base64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), "=");

  const binaryStr = atob(base64);
  const buffer = new ArrayBuffer(binaryStr.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binaryStr.length; i++) {
    view[i] = binaryStr.charCodeAt(i);
  }
  return buffer;
}
