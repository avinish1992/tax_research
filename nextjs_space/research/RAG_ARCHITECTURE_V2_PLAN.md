# RAG Pipeline V2 - Comprehensive Architecture Plan

## Executive Summary

This document outlines a complete redesign of the RAG pipeline to address all identified weaknesses from the evaluation metrics. The new architecture focuses on:

1. **Improved Document Parsing** - Better structure extraction with Unstructured.io
2. **Intelligent Chunking** - Hierarchical, semantic-aware chunking
3. **Rich Metadata** - Article/Section/Page hierarchy preservation
4. **Advanced Retrieval** - HyDE query expansion, contextual retrieval, re-ranking
5. **Performance Optimization** - Parallel processing, caching, batch embeddings

---

## Current State Analysis

### Current Implementation
```
lib/pdf-processor.ts    → unpdf extraction + LangChain RecursiveCharacterTextSplitter
lib/supabase-rag.ts     → OpenAI embeddings + Supabase hybrid_search RPC
```

### Current Metrics (Baseline)
| Metric | Current | Target |
|--------|---------|--------|
| Precision@5 | 77.6% | 88%+ |
| Recall | 71.0% | 82%+ |
| NDCG@5 | 0.377 | 0.70+ |
| Page Accuracy | 28.7% | 70%+ |
| Context Relevancy | 42.8% | 80%+ |
| Avg Retrieval Time | 1783ms | 800ms |
| P95 Latency | 4207ms | 1500ms |

### Root Causes
1. **Low Page Accuracy**: `unpdf` extracts text but loses precise page boundaries in overlapping chunks
2. **Low NDCG**: No re-ranking; relevant content scattered across ranks
3. **Low Context Relevancy**: Chunks lack contextual headers/hierarchy
4. **High Latency**: Sequential API calls, no caching

---

## Proposed Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RAG PIPELINE V2                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐                 │
│  │  INGESTION  │    │   STORAGE    │    │   RETRIEVAL    │                 │
│  │   LAYER     │───▶│    LAYER     │───▶│     LAYER      │                 │
│  └─────────────┘    └──────────────┘    └────────────────┘                 │
│         │                  │                    │                           │
│         ▼                  ▼                    ▼                           │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐                 │
│  │ Unstructured│    │  Supabase    │    │  Query Engine  │                 │
│  │    API      │    │  pgvector    │    │  + Re-ranking  │                 │
│  │             │    │  + Redis     │    │  + HyDE        │                 │
│  └─────────────┘    └──────────────┘    └────────────────┘                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component 1: Document Parsing Layer

### Option Analysis

| Framework | TypeScript SDK | Quality | Cost | Parallelism |
|-----------|---------------|---------|------|-------------|
| **Unstructured.io** | ✅ Yes | High | $10/1000 pages | Built-in (splitPdfPage) |
| LlamaParse | ✅ Yes | Highest | $1/1000 pages | Manual |
| Docling | ❌ Python only | High | Free | Yes |
| unpdf (current) | ✅ Native | Medium | Free | Manual |

### Recommended: Unstructured.io

**Rationale:**
1. Native TypeScript SDK (`unstructured-client`)
2. Built-in PDF splitting for parallel processing (up to 15 concurrent)
3. Extracts structural elements: headings, paragraphs, tables, lists
4. Returns element types and hierarchies
5. 1000 free pages/day for development

### Implementation Design

```typescript
// lib/document-parser-v2.ts

import { UnstructuredClient } from "unstructured-client"
import { Strategy, PartitionResponse } from "unstructured-client/sdk/models/shared"

interface ParsedElement {
  type: 'Title' | 'NarrativeText' | 'ListItem' | 'Table' | 'Header' | 'Footer'
  text: string
  metadata: {
    page_number: number
    parent_id: string | null
    category_depth: number
    emphasized_texts: string[]
    link_urls: string[]
    coordinates: { x: number; y: number; width: number; height: number } | null
  }
}

interface ParsedDocument {
  elements: ParsedElement[]
  metadata: {
    filename: string
    filetype: string
    languages: string[]
    page_count: number
    parsing_strategy: string
  }
}

export class DocumentParserV2 {
  private client: UnstructuredClient

  constructor() {
    this.client = new UnstructuredClient({
      serverURL: process.env.UNSTRUCTURED_API_URL,
      security: { apiKeyAuth: process.env.UNSTRUCTURED_API_KEY }
    })
  }

  async parse(buffer: Buffer, filename: string): Promise<ParsedDocument> {
    const response = await this.client.general.partition({
      partitionParameters: {
        files: { content: buffer, fileName: filename },
        strategy: Strategy.HiRes,  // Best quality for legal docs
        hiResModelName: "yolox",   // Layout detection model
        splitPdfPage: true,        // Enable parallel processing
        splitPdfConcurrencyLevel: 10,
        extractImageBlockTypes: ["Image", "Table"],
        includePageBreaks: true,
        coordinates: true,         // For precise positioning
        languages: ["eng"],
      }
    })

    return this.transformResponse(response, filename)
  }
}
```

### Metadata to Extract

| Metadata Field | Source | Purpose |
|----------------|--------|---------|
| `page_number` | Unstructured | Page citations |
| `element_type` | Unstructured | Chunk type classification |
| `parent_id` | Unstructured | Section hierarchy |
| `category_depth` | Unstructured | Heading level (H1, H2, H3) |
| `article_number` | Regex extraction | Legal article reference |
| `section_title` | Parent element | Context for chunk |
| `coordinates` | Unstructured | Visual position |

---

## Component 2: Intelligent Chunking Layer

### Strategy: Hierarchical Semantic Chunking

Instead of fixed-size character splitting, use a multi-level approach:

```
Level 1: Document
  └── Level 2: Article/Chapter
        └── Level 3: Section
              └── Level 4: Paragraph chunks (target: 500-1000 chars)
```

### Implementation Design

```typescript
// lib/chunker-v2.ts

interface ChunkMetadata {
  // Position
  page_number: number
  page_range: number[]          // If chunk spans pages
  chunk_index: number

  // Hierarchy (legal document specific)
  article_number: string | null  // "Article 5", "Article 23"
  section_number: string | null  // "Section 1", "5.2"
  subsection: string | null

  // Context (Anthropic's Contextual Retrieval)
  context_header: string         // "Article 5: Tax Rates > Section 1"
  document_summary: string       // Brief doc description (from parent)

  // Element info
  element_type: string           // 'provision', 'definition', 'example', 'table'
  has_table: boolean
  has_list: boolean

  // Keywords (extracted via NER or regex)
  legal_entities: string[]       // "Taxable Person", "Authority"
  monetary_values: string[]      // "AED 375,000", "9%"
  date_references: string[]      // "1 June 2023"
}

interface EnhancedChunk {
  id: string
  content: string
  content_with_context: string   // Anthropic's contextual retrieval
  embedding: number[] | null
  metadata: ChunkMetadata
}

export class SemanticChunker {
  private maxChunkSize = 800      // ~200 tokens, smaller for precision
  private minChunkSize = 200
  private overlapSize = 100

  async chunkDocument(elements: ParsedElement[]): Promise<EnhancedChunk[]> {
    // Step 1: Build hierarchy from elements
    const hierarchy = this.buildHierarchy(elements)

    // Step 2: Group elements by section
    const sections = this.groupBySections(hierarchy)

    // Step 3: Create chunks with context
    const chunks: EnhancedChunk[] = []

    for (const section of sections) {
      const sectionChunks = await this.chunkSection(section)
      chunks.push(...sectionChunks)
    }

    // Step 4: Add contextual headers (Anthropic's method)
    return this.addContextualHeaders(chunks, hierarchy)
  }

  private addContextualHeaders(
    chunks: EnhancedChunk[],
    hierarchy: DocumentHierarchy
  ): EnhancedChunk[] {
    // Anthropic's Contextual Retrieval: prepend chunk-specific context
    return chunks.map(chunk => {
      const contextHeader = this.buildContextHeader(chunk.metadata, hierarchy)

      return {
        ...chunk,
        content_with_context: `${contextHeader}\n\n${chunk.content}`
      }
    })
  }

  private buildContextHeader(metadata: ChunkMetadata, hierarchy: any): string {
    // Build hierarchical context: "Federal Decree-Law No. 47 of 2022 > Article 5: Tax Rates > Section 1"
    const parts: string[] = []

    if (hierarchy.documentTitle) {
      parts.push(hierarchy.documentTitle)
    }
    if (metadata.article_number) {
      parts.push(`Article ${metadata.article_number}`)
    }
    if (metadata.section_number) {
      parts.push(`Section ${metadata.section_number}`)
    }

    return parts.join(' > ')
  }
}
```

### Parallelism for Fast Indexing

```typescript
// lib/parallel-processor.ts

export class ParallelDocumentProcessor {
  private batchSize = 10  // Process 10 pages concurrently
  private embeddingBatchSize = 20  // Batch embeddings

  async processDocument(buffer: Buffer, filename: string): Promise<ProcessingResult> {
    const startTime = performance.now()

    // Step 1: Parse with Unstructured (parallel PDF splitting built-in)
    const parsed = await this.parser.parse(buffer, filename)
    const parseTime = performance.now() - startTime

    // Step 2: Chunk with semantic awareness
    const chunks = await this.chunker.chunkDocument(parsed.elements)
    const chunkTime = performance.now() - startTime - parseTime

    // Step 3: Batch embed chunks (parallel API calls)
    const embeddedChunks = await this.batchEmbed(chunks)
    const embedTime = performance.now() - startTime - parseTime - chunkTime

    // Step 4: Batch insert to Supabase
    await this.batchInsert(embeddedChunks)

    return {
      totalChunks: chunks.length,
      timing: { parseTime, chunkTime, embedTime, totalTime: performance.now() - startTime }
    }
  }

  private async batchEmbed(chunks: EnhancedChunk[]): Promise<EnhancedChunk[]> {
    // OpenAI supports batch embedding up to 2048 inputs
    const batches = this.createBatches(chunks, this.embeddingBatchSize)

    // Process batches in parallel (but limit concurrency)
    const results = await Promise.all(
      batches.map(batch => this.embedBatch(batch))
    )

    return results.flat()
  }

  private async embedBatch(chunks: EnhancedChunk[]): Promise<EnhancedChunk[]> {
    // Use content_with_context for contextual embeddings
    const texts = chunks.map(c => c.content_with_context)

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts,  // Batch input
      }),
    })

    const data = await response.json()

    return chunks.map((chunk, i) => ({
      ...chunk,
      embedding: data.data[i].embedding
    }))
  }
}
```

---

## Component 3: Enhanced Database Schema

### New Schema Design

```sql
-- Enhanced document_chunks table
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS content_with_context TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS page_range INTEGER[];
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS article_number TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS section_number TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS element_type TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS context_header TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS has_table BOOLEAN DEFAULT FALSE;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS legal_entities TEXT[];
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS monetary_values TEXT[];

-- Create GIN indexes for fast filtering
CREATE INDEX IF NOT EXISTS idx_chunks_article ON document_chunks (article_number);
CREATE INDEX IF NOT EXISTS idx_chunks_legal_entities ON document_chunks USING GIN (legal_entities);
CREATE INDEX IF NOT EXISTS idx_chunks_page ON document_chunks (page_number);

-- Optimize HNSW index for new embedding strategy
DROP INDEX IF EXISTS document_chunks_embedding_idx;
CREATE INDEX document_chunks_embedding_idx ON document_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 32, ef_construction = 80);  -- Higher m for better recall
```

---

## Component 4: Advanced Retrieval Layer

### 4.1 Query Expansion with HyDE

```typescript
// lib/query-expander.ts

export class QueryExpander {
  /**
   * Hypothetical Document Embedding (HyDE)
   * Generate a hypothetical answer, then use its embedding for search
   */
  async expandWithHyDE(query: string): Promise<QueryExpansion> {
    // Generate hypothetical document
    const hypotheticalDoc = await this.generateHypotheticalDocument(query)

    // Generate embeddings for both
    const [queryEmbedding, hydeEmbedding] = await Promise.all([
      this.embed(query),
      this.embed(hypotheticalDoc)
    ])

    return {
      originalQuery: query,
      hypotheticalDocument: hypotheticalDoc,
      queryEmbedding,
      hydeEmbedding,
      // Option: Average the embeddings
      fusedEmbedding: this.averageEmbeddings([queryEmbedding, hydeEmbedding])
    }
  }

  private async generateHypotheticalDocument(query: string): Promise<string> {
    const prompt = `Given the question about UAE Corporate Tax Law, write a detailed passage that would answer this question. Include specific articles, sections, rates, and thresholds where applicable.

Question: ${query}

Hypothetical Answer (2-3 paragraphs):`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',  // Cost-effective for expansion
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.3
      })
    })

    const data = await response.json()
    return data.choices[0].message.content
  }
}
```

### 4.2 Multi-Query Retrieval

```typescript
// lib/multi-query-retriever.ts

export class MultiQueryRetriever {
  /**
   * Generate multiple query variations and retrieve for each
   */
  async retrieve(query: string, topK: number = 10): Promise<RetrievalResult[]> {
    // Generate query variations
    const variations = await this.generateQueryVariations(query)

    // Retrieve for each variation in parallel
    const allResults = await Promise.all(
      variations.map(v => this.hybridSearch(v, topK))
    )

    // Merge and deduplicate using RRF
    return this.mergeWithRRF(allResults)
  }

  private async generateQueryVariations(query: string): Promise<string[]> {
    const prompt = `Generate 3 different ways to ask this question about UAE Corporate Tax Law. Keep the same meaning but vary the phrasing.

Original: ${query}

Variations (one per line):`

    // ... LLM call
    return [query, ...variations]
  }
}
```

### 4.3 Re-ranking with Cohere

```typescript
// lib/reranker.ts

export class CohereReranker {
  private apiKey = process.env.COHERE_API_KEY

  async rerank(
    query: string,
    documents: RetrievalResult[],
    topK: number = 5
  ): Promise<RetrievalResult[]> {
    const response = await fetch('https://api.cohere.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'rerank-english-v3.0',
        query: query,
        documents: documents.map(d => d.content),
        top_n: topK,
        return_documents: false
      })
    })

    const data = await response.json()

    // Reorder documents by relevance score
    return data.results.map((r: any) => ({
      ...documents[r.index],
      rerank_score: r.relevance_score
    }))
  }
}
```

### 4.4 Complete Retrieval Pipeline

```typescript
// lib/retrieval-pipeline-v2.ts

export class RetrievalPipelineV2 {
  private queryExpander: QueryExpander
  private multiQueryRetriever: MultiQueryRetriever
  private reranker: CohereReranker
  private cache: SemanticCache

  async retrieve(query: string, userId: string, topK: number = 5): Promise<RetrievalResult> {
    const startTime = performance.now()

    // Step 1: Check semantic cache
    const cached = await this.cache.get(query)
    if (cached) {
      return { results: cached, fromCache: true, timing: performance.now() - startTime }
    }

    // Step 2: Query expansion with HyDE
    const expansion = await this.queryExpander.expandWithHyDE(query)

    // Step 3: Multi-query retrieval
    const retrievalResults = await this.multiQueryRetriever.retrieve(
      [query, expansion.hypotheticalDocument],
      expansion.fusedEmbedding,
      userId,
      topK * 3  // Over-retrieve for re-ranking
    )

    // Step 4: Re-rank with Cohere
    const rerankedResults = await this.reranker.rerank(query, retrievalResults, topK)

    // Step 5: Cache results
    await this.cache.set(query, rerankedResults)

    return {
      results: rerankedResults,
      fromCache: false,
      timing: performance.now() - startTime,
      metadata: {
        hydeUsed: true,
        queriesGenerated: 4,
        documentsReranked: retrievalResults.length
      }
    }
  }
}
```

---

## Component 5: Caching Layer

### 5.1 Embedding Cache (Redis)

```typescript
// lib/embedding-cache.ts

import { createClient } from 'redis'

export class EmbeddingCache {
  private redis: ReturnType<typeof createClient>
  private ttl = 86400 * 7  // 7 days

  async getEmbedding(text: string): Promise<number[] | null> {
    const key = `emb:${this.hash(text)}`
    const cached = await this.redis.get(key)
    return cached ? JSON.parse(cached) : null
  }

  async setEmbedding(text: string, embedding: number[]): Promise<void> {
    const key = `emb:${this.hash(text)}`
    await this.redis.setEx(key, this.ttl, JSON.stringify(embedding))
  }

  async getOrCreate(text: string): Promise<number[]> {
    const cached = await this.getEmbedding(text)
    if (cached) return cached

    const embedding = await this.generateEmbedding(text)
    await this.setEmbedding(text, embedding)
    return embedding
  }
}
```

### 5.2 Semantic Query Cache

```typescript
// lib/semantic-cache.ts

export class SemanticCache {
  private similarityThreshold = 0.95  // High threshold for legal queries

  async get(query: string): Promise<CachedResult | null> {
    const queryEmbedding = await this.embeddingCache.getOrCreate(query)

    // Find similar cached queries
    const { data } = await this.supabase.rpc('find_similar_query', {
      query_embedding: queryEmbedding,
      threshold: this.similarityThreshold,
      limit: 1
    })

    if (data && data.length > 0) {
      return JSON.parse(data[0].cached_results)
    }
    return null
  }

  async set(query: string, results: RetrievalResult[]): Promise<void> {
    const queryEmbedding = await this.embeddingCache.getOrCreate(query)

    await this.supabase.from('query_cache').insert({
      query_text: query,
      query_embedding: queryEmbedding,
      cached_results: JSON.stringify(results),
      expires_at: new Date(Date.now() + 3600000)  // 1 hour
    })
  }
}
```

---

## Component 6: pgvector Optimization

### Index Optimization

```sql
-- Optimized HNSW index parameters for 1536-dim embeddings
CREATE INDEX document_chunks_embedding_hnsw_idx ON document_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (
  m = 32,               -- Connections per node (16 default, 32 for better recall)
  ef_construction = 80  -- Build-time accuracy (64 default, 80 for quality)
);

-- Set search-time parameters
ALTER SYSTEM SET hnsw.ef_search = 100;  -- Query-time accuracy (40 default)
```

### Query-Time Filtering Optimization

```sql
-- Create partial indexes for common filters
CREATE INDEX idx_chunks_user_embedding ON document_chunks (user_id)
INCLUDE (embedding) WHERE status = 'completed';

-- Use covering index for metadata queries
CREATE INDEX idx_chunks_metadata ON document_chunks
USING GIN (metadata jsonb_path_ops);
```

---

## Expected Improvements

### Metric Projections

| Metric | Current | After V2 | Improvement |
|--------|---------|----------|-------------|
| Precision@5 | 77.6% | 88-92% | +13-18% |
| Recall | 71.0% | 82-88% | +15-24% |
| NDCG@5 | 0.377 | 0.72-0.78 | +91-107% |
| Page Accuracy | 28.7% | 72-80% | +151-179% |
| Context Relevancy | 42.8% | 82-88% | +91-106% |
| Avg Retrieval Time | 1783ms | 650-800ms | -55-63% |
| P95 Latency | 4207ms | 1200-1500ms | -64-71% |

### Component Impact

| Component | Primary Impact |
|-----------|----------------|
| Unstructured Parsing | Page Accuracy (+40%), Metadata richness |
| Hierarchical Chunking | Context Relevancy (+30%), NDCG (+0.2) |
| Contextual Headers | Context Relevancy (+15%), Precision (+5%) |
| HyDE Query Expansion | Recall (+10%), handles paraphrase queries |
| Cohere Re-ranking | NDCG (+0.2), Precision (+8%) |
| Embedding Cache | Latency (-50%), repeat query cost (-90%) |
| pgvector HNSW tuning | Search latency (-30%) |

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Set up Unstructured.io API integration
- [ ] Create new chunking service with hierarchy extraction
- [ ] Design and migrate database schema
- [ ] Implement batch embedding with parallel processing

### Phase 2: Retrieval Enhancement (Week 3-4)
- [ ] Implement HyDE query expansion
- [ ] Add multi-query retrieval
- [ ] Integrate Cohere re-ranking
- [ ] Implement contextual headers (Anthropic method)

### Phase 3: Performance (Week 5)
- [ ] Set up Redis for embedding caching
- [ ] Implement semantic query cache
- [ ] Optimize pgvector HNSW parameters
- [ ] Add batch processing for document ingestion

### Phase 4: Testing & Refinement (Week 6)
- [ ] Run comprehensive evaluation on extended dataset
- [ ] A/B test V1 vs V2 pipeline
- [ ] Fine-tune parameters based on metrics
- [ ] Documentation and deployment

---

## Cost Analysis

### API Costs (Per 1000 Documents)

| Service | Usage | Cost |
|---------|-------|------|
| Unstructured.io | 1000 docs × 50 pages avg | $500 |
| OpenAI Embeddings | 50,000 chunks | $1 |
| OpenAI GPT-4o-mini (HyDE) | 10,000 queries | $3 |
| Cohere Rerank | 10,000 queries | $10 |
| **Total** | | **~$514/1000 docs** |

### Optimization to Reduce Costs
- Use Unstructured free tier (1000 pages/day) for development
- Cache embeddings aggressively (90% cache hit rate target)
- Consider self-hosted Unstructured for production
- Use smaller embedding models for semantic cache

---

## Files to Create/Modify

### New Files
```
lib/document-parser-v2.ts      # Unstructured.io integration
lib/chunker-v2.ts              # Semantic hierarchical chunking
lib/query-expander.ts          # HyDE implementation
lib/multi-query-retriever.ts   # Multi-query retrieval
lib/reranker.ts                # Cohere re-ranking
lib/embedding-cache.ts         # Redis embedding cache
lib/semantic-cache.ts          # Query result cache
lib/retrieval-pipeline-v2.ts   # Orchestration
```

### Modified Files
```
lib/supabase-rag.ts            # Add new retrieval methods
lib/pdf-processor.ts           # Deprecate, wrap V2
app/api/documents/upload/route.ts  # Use new processing pipeline
```

### Database Migrations
```
supabase/migrations/xxx_enhance_chunks_schema.sql
supabase/migrations/xxx_add_query_cache.sql
supabase/migrations/xxx_optimize_hnsw_index.sql
```

---

## Environment Variables Required

```env
# Existing
OPENAI_API_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# New - Document Parsing
UNSTRUCTURED_API_KEY=
UNSTRUCTURED_API_URL=https://api.unstructuredapp.io/general/v0/general

# New - Re-ranking
COHERE_API_KEY=

# New - Caching
REDIS_URL=redis://localhost:6379
```

---

## Alternatives Considered

### Document Parsing
1. **LlamaParse**: Higher quality but more expensive ($1/1000 vs free tier)
2. **Docling**: Excellent but Python-only (would need microservice)
3. **Keep unpdf**: Lower quality, no structure extraction

### Re-ranking
1. **Cross-encoder (local)**: Free but adds latency, needs GPU
2. **OpenAI custom**: No official rerank API
3. **Voyage AI**: Good alternative to Cohere

### Chunking
1. **Late Chunking**: More efficient but requires specific embedding models
2. **Agentic Chunking**: LLM-driven, expensive but highest quality

---

## References

- [Unstructured.io TypeScript SDK](https://docs.unstructured.io/api-reference/partition/sdk-jsts)
- [LlamaParse TypeScript](https://developers.llamaindex.ai/typescript/cloud/llamaparse/getting_started/)
- [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- [HyDE - Hypothetical Document Embeddings](https://docs.haystack.deepset.ai/docs/hypothetical-document-embeddings-hyde)
- [Cohere Rerank API](https://docs.cohere.com/v2/docs/reranking-with-cohere)
- [pgvector HNSW Optimization](https://supabase.com/blog/increase-performance-pgvector-hnsw)
- [Semantic Chunking Strategies](https://weaviate.io/blog/chunking-strategies-for-rag)
- [Redis Semantic Caching](https://redis.io/blog/building-a-context-enabled-semantic-cache-with-redis/)
