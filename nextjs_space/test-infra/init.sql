-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create test documents table
CREATE TABLE IF NOT EXISTS test_documents (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create chunks table with BOTH embedding types for comparison
CREATE TABLE IF NOT EXISTS test_chunks (
    id SERIAL PRIMARY KEY,
    document_id INTEGER REFERENCES test_documents(id),
    content TEXT NOT NULL,
    page_number INTEGER,

    -- OpenAI embeddings (1536 dimensions)
    embedding_openai vector(1536),

    -- Local embeddings (384 dimensions - MiniLM)
    embedding_local vector(384),

    -- Metadata for search
    content_tokens TSVECTOR,  -- For keyword search

    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for both embedding types
CREATE INDEX IF NOT EXISTS idx_chunks_openai_embedding
    ON test_chunks USING ivfflat (embedding_openai vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_chunks_local_embedding
    ON test_chunks USING ivfflat (embedding_local vector_cosine_ops)
    WITH (lists = 100);

-- Full-text search index for keyword search
CREATE INDEX IF NOT EXISTS idx_chunks_content_tokens
    ON test_chunks USING gin(content_tokens);

-- Function: Semantic-only search with OpenAI embeddings
CREATE OR REPLACE FUNCTION search_semantic_openai(
    query_embedding vector(1536),
    match_count INTEGER DEFAULT 10
)
RETURNS TABLE (
    id INTEGER,
    document_id INTEGER,
    content TEXT,
    file_name VARCHAR(255),
    page_number INTEGER,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        c.content,
        d.file_name,
        c.page_number,
        1 - (c.embedding_openai <=> query_embedding) AS similarity
    FROM test_chunks c
    JOIN test_documents d ON c.document_id = d.id
    WHERE c.embedding_openai IS NOT NULL
    ORDER BY c.embedding_openai <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Function: Semantic-only search with Local embeddings
CREATE OR REPLACE FUNCTION search_semantic_local(
    query_embedding vector(384),
    match_count INTEGER DEFAULT 10
)
RETURNS TABLE (
    id INTEGER,
    document_id INTEGER,
    content TEXT,
    file_name VARCHAR(255),
    page_number INTEGER,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.document_id,
        c.content,
        d.file_name,
        c.page_number,
        1 - (c.embedding_local <=> query_embedding) AS similarity
    FROM test_chunks c
    JOIN test_documents d ON c.document_id = d.id
    WHERE c.embedding_local IS NOT NULL
    ORDER BY c.embedding_local <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Function: Hybrid search (Semantic + Keyword with RRF)
CREATE OR REPLACE FUNCTION search_hybrid_local(
    query_embedding vector(384),
    query_text TEXT,
    match_count INTEGER DEFAULT 10,
    rrf_k INTEGER DEFAULT 60
)
RETURNS TABLE (
    id INTEGER,
    document_id INTEGER,
    content TEXT,
    file_name VARCHAR(255),
    page_number INTEGER,
    rrf_score FLOAT
) AS $$
BEGIN
    RETURN QUERY
    WITH semantic_results AS (
        SELECT
            c.id,
            ROW_NUMBER() OVER (ORDER BY c.embedding_local <=> query_embedding) AS semantic_rank
        FROM test_chunks c
        WHERE c.embedding_local IS NOT NULL
        LIMIT match_count * 2
    ),
    keyword_results AS (
        SELECT
            c.id,
            ROW_NUMBER() OVER (ORDER BY ts_rank(c.content_tokens, plainto_tsquery('english', query_text)) DESC) AS keyword_rank
        FROM test_chunks c
        WHERE c.content_tokens @@ plainto_tsquery('english', query_text)
        LIMIT match_count * 2
    ),
    rrf_scores AS (
        SELECT
            COALESCE(s.id, k.id) AS chunk_id,
            COALESCE(1.0 / (rrf_k + s.semantic_rank), 0) +
            COALESCE(1.0 / (rrf_k + k.keyword_rank), 0) AS score
        FROM semantic_results s
        FULL OUTER JOIN keyword_results k ON s.id = k.id
    )
    SELECT
        c.id,
        c.document_id,
        c.content,
        d.file_name,
        c.page_number,
        r.score AS rrf_score
    FROM rrf_scores r
    JOIN test_chunks c ON r.chunk_id = c.id
    JOIN test_documents d ON c.document_id = d.id
    ORDER BY r.score DESC
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Insert sample test data (will be populated by benchmark script)
-- This is just a placeholder
INSERT INTO test_documents (file_name) VALUES ('sample.pdf') ON CONFLICT DO NOTHING;

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres;
