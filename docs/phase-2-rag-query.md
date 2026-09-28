# Phase 2: RAG Query & Streaming Chat Endpoint

## Overview

The `/api/chat` endpoint executes hybrid RAG queries that combine semantic search via Vectorize with relational filtering via D1, then streams LLM-generated responses to the client using Server-Sent Events. This phase transforms the ingested knowledge base into an interactive question-answering system with real-time streaming responses.

## Architecture Flow

When a client sends a POST request to `/api/chat` with a message field, the Worker first validates that the message exists and is non-empty. The user's question is then embedded using the same bge-small-en-v1.5 model used during ingestion to ensure vector space compatibility. This query embedding is sent to Vectorize with a request for the top 5 most semantically similar chunks based on cosine similarity scores.

The vector search returns matches with scores and metadata, but these chunks may belong to documents that have been deleted or unpublished since ingestion. To filter out stale content, the Worker extracts all unique document IDs from the vector matches and queries D1 to determine which documents currently have published status. Only chunks belonging to published documents are retained for context assembly.

If no published documents match the query, the Worker returns a fallback message suggesting the user rephrase their question or check the knowledge base directly. Otherwise, the valid chunks are formatted into a context block with numbered citations including the document title, category, and chunk text. This context is combined with a system prompt that instructs the LLM to answer based only on provided context and a user prompt containing the original question.

The complete prompt is sent to Workers AI using the llama-3-8b-instruct model with streaming enabled. As the LLM generates tokens, the Worker transforms the readable stream into Server-Sent Events format by encoding each chunk as a data field followed by double newlines. The stream concludes with a final DONE event signaling completion. The response is returned with content-type text/event-stream and headers disabling caching.

## Implementation Components

### Query Embedding

**Location:** `src/handlers/chat.ts`

The chat handler extracts and validates the message from the request body, generates an embedding vector using Workers AI with bge-small-en-v1.5, and validates that the embedding result contains a non-empty vector array before proceeding to search.

### Hybrid Vector Search with D1 Filtering

The search phase queries Vectorize with the embedded query vector requesting the top 5 matches with metadata included. If no matches are found, a fallback response is returned immediately. The Worker extracts unique document IDs from the match metadata and queries D1 with an IN clause filtered by published status. Only vector matches whose document IDs appear in the published set are retained. If all matches are filtered out, a fallback message informs the user that matching content may have been unpublished.

### Context Assembly

Valid matches are formatted into a numbered context block where each entry includes the document title, category, and chunk text. The context is combined with a system prompt that establishes the assistant's role, sets ground rules for answering based only on provided context, and instructs citation of source documents. The user prompt contains the original question unchanged.

### LLM Streaming with Server-Sent Events

The constructed prompt messages are sent to Workers AI with the llama-3-8b-instruct model and stream enabled. The Worker creates a ReadableStream that reads from the AI response stream, extracts text chunks from each value, formats them as SSE data events, and encodes them as UTF-8 bytes. When the AI stream completes, a final DONE event signals the client to close the connection. The stream is returned as the response body with appropriate headers.

## Prompt Engineering Best Practices

The system prompt should identify the assistant's role and organization, establish that answers must be based only on provided context, specify behavior when context is insufficient (admit lack of information rather than fabricate), encourage citation of source documents in responses, and handle conflicting information by acknowledging both sources. The system prompt should remain concise to preserve token budget for context.

Context formatting should use numbered citations for easy reference, include document metadata like title and category, present the raw chunk text without modification, and separate chunks with clear visual delimiters. This structure helps the LLM understand document boundaries and enables natural citation in generated responses.

Token budget management allocates approximately 100-200 tokens for the system prompt, 600-700 tokens for 5 chunks of 500 characters each at roughly 0.75 tokens per character, 20-100 tokens for the user query, resulting in roughly 1000 total input tokens well within the 8K context window. LLM responses typically range from 200-500 tokens and stream as generated.

## Client-Side Integration

**Frontend Location:** To be implemented in Phase 3

Clients consume the SSE stream by opening a connection to the `/api/chat` endpoint with a POST request containing the user message. As the Worker streams data events, the client decodes each event, extracts the text field, and appends it to the displayed message. When the DONE event arrives, the client closes the connection and marks the message as complete. Error handling should detect stream interruptions and display appropriate fallback messages.

Browser-based clients can use the Fetch API with ReadableStream readers to manually parse SSE format, or implement EventSource-like behavior through libraries. The manual approach provides more control over request headers and body content.

## Performance Optimization Strategies

### Caching Strategy

Future enhancements could implement caching for frequently asked questions by hashing the normalized query and storing complete responses in Cloudflare KV with appropriate TTL values. Cache hits would bypass the full RAG pipeline and return stored responses immediately.

### Parallel Queries

The current implementation queries Vectorize first then D1, but these operations could be parallelized by fetching all published document IDs from D1 while simultaneously running the vector search, then filtering in memory. This reduces total latency at the cost of potentially fetching more data from D1 than needed.

### Chunk Deduplication

If multiple chunks from the same document match the query, the system could deduplicate by document to provide diverse context from different sources rather than multiple excerpts from one document. This is achieved by tracking seen document IDs and filtering subsequent chunks from already-included documents.

## Error Handling Strategy

Missing or empty message fields return 400 Bad Request to indicate client error. Embedding generation failures return 502 Bad Gateway suggesting temporary AI service issues. No vector matches return 200 OK with a fallback message suggesting query rephrasing. No published documents return 200 OK with a message that matching content may have been unpublished. LLM stream errors log the exception and return 500 Internal Server Error, potentially with partial response content if streaming had begun.

## Testing Procedures

Manual testing involves sending POST requests to the deployed `/api/chat` endpoint with various question types and observing the streamed response. Test with questions that should match documents in the knowledge base, questions about topics not covered, very short and very long queries, and rapid successive requests to verify concurrency handling.

Expected SSE output should consist of data events with JSON payloads containing text fields, gradual accumulation of response content, and a final DONE event to signal completion. The response should cite specific documents from the knowledge base and admit lack of information for out-of-scope questions.

## Monitoring Procedures

Live Worker logs via `npx wrangler tail` show query embeddings, vector search results with scores, D1 filtering operations, and LLM streaming start and completion. D1 queries can verify published document counts to understand the available corpus size. Vectorize dashboard metrics show query patterns and average similarity scores.

Track metrics including time to first token (embedding + search + prompt assembly + LLM start), total response time, vector match quality (average similarity scores), and D1 filter efficiency (percentage of vector matches that pass publication filter).

## Next Steps

With Phase 2 complete, the system provides a fully functional RAG query API with streaming responses. Test various question types against your knowledge base and measure end-to-end latency from request to first token. Verify that unpublished documents are properly filtered from results. Evaluate response quality and relevance to determine if chunk size, overlap, or top-K parameters need tuning. When the RAG query endpoint meets quality and performance requirements, proceed to Phase 3 to build the frontend chat user interface.
