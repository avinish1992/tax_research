# Supabase Migration Plan

**Version:** 1.0
**Date:** 2025-12-18
**Status:** Ready for Approval

---

## Pre-Migration Checklist

- [x] Supabase project created: `sjdaemlbjntadadggenr`
- [x] MCP connection configured and working
- [x] pgvector extension available (v0.8.0)
- [x] pg_trgm extension available (v1.6)
- [x] No existing tables in public schema
- [x] Auth system working (1 user exists)
- [ ] Backup strategy defined (N/A - fresh project)

---

## Migration Sequence

```
Migration 1: enable_pgvector
     │
     ▼
Migration 2: enable_pg_trgm
     │
     ▼
Migration 3: create_profiles
     │
     ▼
Migration 4: create_documents
     │
     ▼
Migration 5: create_document_chunks
     │
     ▼
Migration 6: create_chat_sessions
     │
     ▼
Migration 7: create_messages
     │
     ▼
Migration 8: create_storage_bucket
     │
     ▼
Migration 9: create_search_function
     │
     ▼
Migration 10: create_hybrid_search_function
```

---

## Migration Details

### Migration 1: enable_pgvector

**Purpose:** Enable vector data type and HNSW/IVFFlat indexes for semantic search

**SQL:**
```sql
-- Enable the vector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
```

**Verification:**
```sql
SELECT * FROM pg_extension WHERE extname = 'vector';
```

**Risk:** None
**Rollback:** `DROP EXTENSION vector;`

---

### Migration 2: enable_pg_trgm

**Purpose:** Enable trigram matching for keyword/fuzzy text search

**SQL:**
```sql
-- Enable trigram extension for keyword search
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
```

**Verification:**
```sql
SELECT * FROM pg_extension WHERE extname = 'pg_trgm';
```

**Risk:** None
**Rollback:** `DROP EXTENSION pg_trgm;`

---

### Migration 3: create_profiles

**Purpose:** Store user profile information linked to Supabase Auth

**SQL:**
```sql
-- Create profiles table linked to auth.users
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create profile for existing user(s)
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;
```

**Verification:**
```sql
SELECT * FROM public.profiles;
```

**Risk:** Low
**Rollback:**
```sql
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP TABLE IF EXISTS public.profiles;
```

---

### Migration 4: create_documents

**Purpose:** Store document metadata with processing status

**SQL:**
```sql
-- Create documents table
CREATE TABLE public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,

    CONSTRAINT valid_file_size CHECK (file_size > 0 AND file_size <= 52428800)
);

-- Enable Row Level Security
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own documents"
    ON public.documents FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
    ON public.documents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents"
    ON public.documents FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents"
    ON public.documents FOR DELETE
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_documents_user_id ON public.documents(user_id);
CREATE INDEX idx_documents_status ON public.documents(status);
CREATE INDEX idx_documents_uploaded_at ON public.documents(uploaded_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.processed_at = CASE
        WHEN NEW.status IN ('completed', 'failed') AND OLD.status NOT IN ('completed', 'failed')
        THEN NOW()
        ELSE NEW.processed_at
    END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_status_change
    BEFORE UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

**Verification:**
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'documents';
```

**Risk:** Low
**Rollback:**
```sql
DROP TRIGGER IF EXISTS documents_status_change ON public.documents;
DROP TABLE IF EXISTS public.documents;
```

---

### Migration 5: create_document_chunks

**Purpose:** Store document text chunks with vector embeddings

**SQL:**
```sql
-- Create document_chunks table with vector column
CREATE TABLE public.document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
    page_number INTEGER,
    chunk_index INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_chunk_index CHECK (chunk_index >= 0),
    CONSTRAINT content_not_empty CHECK (length(content) > 0)
);

-- Enable Row Level Security
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- RLS Policy (inherit access from documents table)
CREATE POLICY "Users can view chunks of own documents"
    ON public.document_chunks FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.documents
            WHERE documents.id = document_chunks.document_id
            AND documents.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert chunks for own documents"
    ON public.document_chunks FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.documents
            WHERE documents.id = document_chunks.document_id
            AND documents.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete chunks of own documents"
    ON public.document_chunks FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.documents
            WHERE documents.id = document_chunks.document_id
            AND documents.user_id = auth.uid()
        )
    );

-- Indexes
CREATE INDEX idx_chunks_document_id ON public.document_chunks(document_id);
CREATE INDEX idx_chunks_chunk_index ON public.document_chunks(document_id, chunk_index);

-- HNSW index for fast vector similarity search
-- Using cosine distance (most common for text embeddings)
CREATE INDEX idx_chunks_embedding ON public.document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- GIN index for trigram text search (hybrid search)
CREATE INDEX idx_chunks_content_trgm ON public.document_chunks
    USING gin (content gin_trgm_ops);
```

**Verification:**
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'document_chunks';
```

**Risk:** Low
**Rollback:**
```sql
DROP TABLE IF EXISTS public.document_chunks;
```

---

### Migration 6: create_chat_sessions

**Purpose:** Store chat conversation containers

**SQL:**
```sql
-- Create chat_sessions table
CREATE TABLE public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New Conversation',
    model TEXT DEFAULT 'claude-3-5-sonnet-20241022',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies (full access to own sessions)
CREATE POLICY "Users can manage own chat sessions"
    ON public.chat_sessions FOR ALL
    USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_chat_sessions_user_id ON public.chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_updated_at ON public.chat_sessions(updated_at DESC);

-- Updated_at trigger
CREATE TRIGGER chat_sessions_updated_at
    BEFORE UPDATE ON public.chat_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Verification:**
```sql
SELECT * FROM public.chat_sessions LIMIT 1;
```

**Risk:** Low
**Rollback:**
```sql
DROP TABLE IF EXISTS public.chat_sessions;
```

---

### Migration 7: create_messages

**Purpose:** Store individual chat messages

**SQL:**
```sql
-- Create messages table
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS Policy (inherit access from chat_sessions)
CREATE POLICY "Users can manage messages in own chat sessions"
    ON public.messages FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.chat_sessions
            WHERE chat_sessions.id = messages.chat_session_id
            AND chat_sessions.user_id = auth.uid()
        )
    );

-- Indexes
CREATE INDEX idx_messages_chat_session_id ON public.messages(chat_session_id);
CREATE INDEX idx_messages_created_at ON public.messages(chat_session_id, created_at);

-- Update chat_session.updated_at when message is added
CREATE OR REPLACE FUNCTION public.update_chat_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.chat_sessions
    SET updated_at = NOW()
    WHERE id = NEW.chat_session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER messages_update_session
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.update_chat_session_timestamp();
```

**Verification:**
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'messages';
```

**Risk:** Low
**Rollback:**
```sql
DROP TRIGGER IF EXISTS messages_update_session ON public.messages;
DROP FUNCTION IF EXISTS public.update_chat_session_timestamp();
DROP TABLE IF EXISTS public.messages;
```

---

### Migration 8: create_storage_bucket

**Purpose:** Create secure storage bucket for legal documents

**SQL:**
```sql
-- Create storage bucket for legal documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'legal-documents',
    'legal-documents',
    false,  -- Private bucket
    52428800,  -- 50MB limit
    ARRAY[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
    ]
);

-- Storage RLS policies
CREATE POLICY "Users can upload to own folder"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'legal-documents'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can view own files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'legal-documents'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete own files"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'legal-documents'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
```

**Verification:**
```sql
SELECT * FROM storage.buckets WHERE id = 'legal-documents';
```

**Risk:** Low
**Rollback:**
```sql
DELETE FROM storage.buckets WHERE id = 'legal-documents';
```

---

### Migration 9: create_search_function

**Purpose:** Create semantic similarity search function

**SQL:**
```sql
-- Function for semantic similarity search
CREATE OR REPLACE FUNCTION public.search_documents(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.3,
    match_count int DEFAULT 10,
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    content text,
    similarity float,
    page_number int,
    chunk_index int,
    metadata jsonb,
    document_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        dc.id,
        dc.document_id,
        dc.content,
        1 - (dc.embedding <=> query_embedding) as similarity,
        dc.page_number,
        dc.chunk_index,
        dc.metadata,
        d.original_name as document_name
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE d.user_id = p_user_id
    AND d.status = 'completed'
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.search_documents TO authenticated;
```

**Verification:**
```sql
-- Test with dummy embedding (will return empty if no data)
SELECT * FROM search_documents(
    '[0.1,0.2,0.3]'::vector(1536),  -- Would need full 1536 dims
    0.3,
    5
);
```

**Risk:** Low
**Rollback:**
```sql
DROP FUNCTION IF EXISTS public.search_documents;
```

---

### Migration 10: create_hybrid_search_function

**Purpose:** Create combined semantic + keyword search function

**SQL:**
```sql
-- Function for hybrid search (semantic + keyword with RRF)
CREATE OR REPLACE FUNCTION public.hybrid_search_documents(
    query_text text,
    query_embedding vector(1536),
    match_count int DEFAULT 10,
    semantic_weight float DEFAULT 0.7,
    keyword_weight float DEFAULT 0.3,
    rrf_k int DEFAULT 60,
    p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    content text,
    semantic_rank int,
    keyword_rank int,
    rrf_score float,
    page_number int,
    chunk_index int,
    document_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH semantic_results AS (
        SELECT
            dc.id,
            dc.document_id,
            dc.content,
            dc.page_number,
            dc.chunk_index,
            d.original_name,
            ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding) as rank
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE d.user_id = p_user_id
        AND d.status = 'completed'
        AND dc.embedding IS NOT NULL
        ORDER BY dc.embedding <=> query_embedding
        LIMIT match_count * 3
    ),
    keyword_results AS (
        SELECT
            dc.id,
            ROW_NUMBER() OVER (ORDER BY similarity(dc.content, query_text) DESC) as rank
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE d.user_id = p_user_id
        AND d.status = 'completed'
        AND dc.content % query_text  -- Trigram similarity operator
        ORDER BY similarity(dc.content, query_text) DESC
        LIMIT match_count * 3
    ),
    combined AS (
        SELECT
            sr.id,
            sr.document_id,
            sr.content,
            sr.page_number,
            sr.chunk_index,
            sr.original_name,
            sr.rank as s_rank,
            COALESCE(kr.rank, match_count * 3 + 1) as k_rank
        FROM semantic_results sr
        LEFT JOIN keyword_results kr ON sr.id = kr.id
    )
    SELECT
        c.id,
        c.document_id,
        c.content,
        c.s_rank::int as semantic_rank,
        c.k_rank::int as keyword_rank,
        (
            (semantic_weight / (rrf_k + c.s_rank)) +
            (keyword_weight / (rrf_k + c.k_rank))
        )::float as rrf_score,
        c.page_number,
        c.chunk_index,
        c.original_name as document_name
    FROM combined c
    ORDER BY rrf_score DESC
    LIMIT match_count;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.hybrid_search_documents TO authenticated;

-- Also create a service role version for n8n
CREATE OR REPLACE FUNCTION public.hybrid_search_documents_service(
    query_text text,
    query_embedding vector(1536),
    p_user_id uuid,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    content text,
    rrf_score float,
    page_number int,
    chunk_index int,
    document_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        h.id,
        h.document_id,
        h.content,
        h.rrf_score,
        h.page_number,
        h.chunk_index,
        h.document_name
    FROM public.hybrid_search_documents(
        query_text,
        query_embedding,
        match_count,
        0.7,
        0.3,
        60,
        p_user_id
    ) h;
END;
$$;

-- Grant to service role
GRANT EXECUTE ON FUNCTION public.hybrid_search_documents_service TO service_role;
```

**Verification:**
```sql
-- Check function exists
SELECT proname, prosrc FROM pg_proc
WHERE proname LIKE 'hybrid_search%';
```

**Risk:** Low
**Rollback:**
```sql
DROP FUNCTION IF EXISTS public.hybrid_search_documents;
DROP FUNCTION IF EXISTS public.hybrid_search_documents_service;
```

---

## Post-Migration Verification

After all migrations are applied, run these checks:

```sql
-- 1. Check all tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Expected: chat_sessions, document_chunks, documents, messages, profiles

-- 2. Check extensions
SELECT extname, extversion FROM pg_extension
WHERE extname IN ('vector', 'pg_trgm');

-- Expected: vector 0.8.0, pg_trgm 1.6

-- 3. Check indexes
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public';

-- 4. Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public';

-- 5. Check storage bucket
SELECT id, name, public FROM storage.buckets
WHERE id = 'legal-documents';

-- 6. Check functions
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
AND proname LIKE '%search%';
```

---

## Rollback Plan

If issues occur, rollback in reverse order:

```sql
-- Full rollback (DESTRUCTIVE - loses all data)
DROP FUNCTION IF EXISTS public.hybrid_search_documents_service;
DROP FUNCTION IF EXISTS public.hybrid_search_documents;
DROP FUNCTION IF EXISTS public.search_documents;
DELETE FROM storage.buckets WHERE id = 'legal-documents';
DROP TABLE IF EXISTS public.messages;
DROP TABLE IF EXISTS public.chat_sessions;
DROP TABLE IF EXISTS public.document_chunks;
DROP TABLE IF EXISTS public.documents;
DROP TABLE IF EXISTS public.profiles;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS vector;
```

---

## Ready for Approval

**Total Migrations:** 10
**Estimated Time:** 2-3 minutes
**Risk Level:** Low (fresh project, no existing data)

Shall I proceed with applying these migrations step by step?
