-- =============================================================================
-- RAG Chatbot – D1 Initial Schema Migration
-- =============================================================================

-- documents: one row per Sanity document that has been ingested.
-- status: 'published' | 'deleted'
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT    PRIMARY KEY,          -- Sanity document _id
  title        TEXT    NOT NULL,
  slug         TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'published',  -- 'published' | 'deleted'
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Index on status so we can quickly filter active documents during RAG queries.
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

-- Index on slug for human-readable lookups.
CREATE INDEX IF NOT EXISTS idx_documents_slug ON documents(slug);
