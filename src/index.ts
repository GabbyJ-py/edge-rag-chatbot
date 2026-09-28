// =============================================================================
// RAG Chatbot — Cloudflare Worker Entry Point
//
// Routes:
//   POST /webhook/sync  — Sanity webhook ingestion (Phase 1)
//   POST /api/chat      — RAG query + streaming LLM response (Phase 2)
//   GET  /health        — Liveness check
// =============================================================================

import type { Env } from "./types.js";
import { handleWebhookSync } from "./handlers/webhook.js";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    console.log(`[router] ${method} ${url.pathname}`);

    // ------------------------------------------------------------------
    // Health check
    // ------------------------------------------------------------------
    if (method === "GET" && url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", environment: env.ENVIRONMENT }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ------------------------------------------------------------------
    // POST /webhook/sync — Sanity ingestion pipeline (Phase 1)
    // ------------------------------------------------------------------
    if (method === "POST" && url.pathname === "/webhook/sync") {
      return handleWebhookSync(request, env);
    }

    // ------------------------------------------------------------------
    // POST /api/chat — RAG query endpoint (Phase 2 — placeholder)
    // ------------------------------------------------------------------
    if (method === "POST" && url.pathname === "/api/chat") {
      return new Response(
        JSON.stringify({ error: "Phase 2 not yet implemented" }),
        { status: 501, headers: { "Content-Type": "application/json" } }
      );
    }

    // ------------------------------------------------------------------
    // 404 fallthrough
    // ------------------------------------------------------------------
    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  },
};
