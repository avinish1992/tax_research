-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column for semantic search (1536 dimensions for OpenAI-compatible embeddings)
ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "embeddingVector" vector(1536);

-- Add tsvector column for full-text search
ALTER TABLE "DocumentChunk" ADD COLUMN IF NOT EXISTS "contentTsvector" tsvector;

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS "DocumentChunk_contentTsvector_idx" ON "DocumentChunk" USING GIN ("contentTsvector");

-- Create HNSW index for vector similarity search (faster than IVFFlat for most use cases)
CREATE INDEX IF NOT EXISTS "DocumentChunk_embeddingVector_idx" ON "DocumentChunk" USING hnsw ("embeddingVector" vector_cosine_ops);

-- Create trigger to auto-update tsvector on content changes
CREATE OR REPLACE FUNCTION update_document_chunk_tsvector()
RETURNS TRIGGER AS $$
BEGIN
  NEW."contentTsvector" := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_chunk_tsvector_update ON "DocumentChunk";
CREATE TRIGGER document_chunk_tsvector_update
  BEFORE INSERT OR UPDATE OF content ON "DocumentChunk"
  FOR EACH ROW
  EXECUTE FUNCTION update_document_chunk_tsvector();

-- Update existing rows to populate tsvector
UPDATE "DocumentChunk" SET "contentTsvector" = to_tsvector('english', COALESCE(content, ''));
