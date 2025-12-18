# Current RAG Architecture Analysis

## Current Stack (As-Is)

### 1. **Embedding Generation** ❌ TF-IDF Only
- **File**: `lib/embeddings.ts`
- **Method**: Custom TF-IDF implementation
- **Dimensions**: 384D vectors
- **Limitations**:
  - No semantic understanding
  - Bag-of-words approach
  - Manual term weighting required
  - Poor synonym handling
  - "Chapter 50" ≠ "Article 50" semantically

### 2. **Vector Storage** ⚠️ Suboptimal
- **Database**: PostgreSQL via Prisma
- **Storage Method**: JSON strings in `DocumentChunk.embedding` column
- **Search**: In-memory cosine similarity (loads all chunks)
- **Limitations**:
  - No vector indexing (HNSW, IVF)
  - O(n) search complexity
  - No approximate nearest neighbor (ANN)
  - Scales poorly with documents

### 3. **Text Extraction** ✅ Good
- **Tool**: `unpdf` (modern, serverless)
- **Chunking**: LangChain `RecursiveCharacterTextSplitter`
- **Settings**: 1000 chars, 150 overlap
- **Works well** for legal documents

### 4. **Search Method** ❌ Single-mode
- **Type**: Semantic search only
- **No keyword search**: Misses exact matches
- **No hybrid fusion**: Can't combine approaches
- **No reranking**: No cross-encoder validation

### 5. **Orchestration** ❌ None
- **Pattern**: Manual API route logic
- **No LangChain/LangGraph**: No agent framework
- **No retrieval chain**: Basic fetch → LLM pattern
- **No monitoring**: Limited observability

## Proposed Architecture Upgrade

### 1. **Embedding Models** ✅ Upgrade to Real Embeddings
- **Primary**: Abacus.AI API (already configured!)
  - Use `/v1/embeddings` endpoint
  - Model: `text-embedding-3-small` or similar
  - 1536D vectors (better semantic understanding)
- **Fallback**: Local Sentence Transformers
  - `all-MiniLM-L6-v2` (384D)
  - For offline operation

### 2. **Vector Database** ✅ Add pgvector
- **Extension**: PostgreSQL `pgvector`
- **Indexing**: HNSW for fast ANN search
- **Benefits**:
  - Native vector operations
  - Approximate nearest neighbor (ANN)
  - Sub-millisecond queries
  - Scales to millions of vectors

### 3. **Hybrid Search** ✅ Best of Both Worlds
- **Semantic**: pgvector cosine similarity
- **Keyword**: PostgreSQL full-text search (tsvector)
- **Fusion**: Reciprocal Rank Fusion (RRF)
- **Benefits**:
  - Catches exact term matches
  - Handles semantic similarity
  - More robust retrieval

### 4. **LangChain/LangGraph** ✅ Modern Orchestration
- **Chain**: RetrievalQA with custom retrievers
- **Graph**: Multi-step reasoning with LangGraph
- **Components**:
  - Document loader
  - Text splitter
  - Vector store
  - Retriever
  - LLM chain

### 5. **Monitoring & Observability**
- **LangSmith**: Trace RAG pipeline
- **Metrics**: Retrieval accuracy, latency
- **Feedback**: User corrections to improve

## Technology Stack Comparison

| Component | Current | Proposed |
|-----------|---------|----------|
| Embeddings | TF-IDF (custom) | Abacus.AI API |
| Vector DB | PostgreSQL (JSON) | PostgreSQL + pgvector |
| Search | Cosine similarity | Hybrid (semantic + keyword) |
| Indexing | None | HNSW index |
| Orchestration | Manual | LangChain/LangGraph |
| Chunking | LangChain ✓ | LangChain ✓ |
| PDF Extract | unpdf ✓ | unpdf ✓ |
| Language | TypeScript | TypeScript |

## Why Not Python?

**You asked about Python** - we're using **TypeScript/Node.js** because:
1. ✅ **Full-stack consistency**: Same language for frontend/backend
2. ✅ **Next.js integration**: Native API routes
3. ✅ **LangChain.js exists**: Full TypeScript port available
4. ✅ **Performance**: Node.js handles async I/O well
5. ✅ **Deployment**: Easier with Next.js ecosystem

**Python would require**:
- Separate Python service
- Extra infrastructure (FastAPI + Next.js)
- Inter-process communication
- More complex deployment

**But we can use Python-quality tools**:
- LangChain.js (official TypeScript port)
- pgvector (works with any language)
- Abacus.AI API (language-agnostic)

## Implementation Plan

### Phase 1: Setup pgvector Extension ✅
1. Enable pgvector in PostgreSQL
2. Add vector column to DocumentChunk
3. Create HNSW index
4. Migrate existing embeddings (optional)

### Phase 2: Implement Real Embeddings ✅
1. Use Abacus.AI `/v1/embeddings` endpoint
2. Replace TF-IDF in `lib/embeddings.ts`
3. Update upload flow
4. Test semantic matching

### Phase 3: Add Hybrid Search ✅
1. Add full-text search column (tsvector)
2. Implement RRF fusion
3. Create hybrid retriever function
4. Test with legal queries

### Phase 4: LangChain Integration ✅
1. Install `@langchain/core`, `langchain`
2. Create vector store wrapper
3. Build retrieval chain
4. Integrate with chat API

### Phase 5: Optimize & Monitor
1. Add caching layer
2. Implement query rewriting
3. Add reranking (cross-encoder)
4. Setup observability

## Estimated Effort

- **Phase 1-2**: 1-2 hours (pgvector + real embeddings)
- **Phase 3**: 1 hour (hybrid search)
- **Phase 4**: 1-2 hours (LangChain integration)
- **Phase 5**: Ongoing optimization

**Total**: 4-6 hours for production-grade RAG system
