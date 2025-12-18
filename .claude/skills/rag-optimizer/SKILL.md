---
name: rag-optimizer
description: Optimize and debug RAG (Retrieval-Augmented Generation) systems. Use when there are retrieval quality issues, when optimizing search performance, or when implementing new RAG features.
---

# RAG Optimizer Skill

## When to Use
- User reports poor retrieval quality
- User wants to optimize search
- Implementing new RAG features
- Debugging embedding issues
- Tuning chunk sizes or overlap

## Current System Analysis

### Architecture
```
Query → Expansion → Embedding → Hybrid Search → RRF Fusion → Rerank → Response
```

### Key Components
- **Embeddings**: text-embedding-3-small (1536D)
- **Chunk Size**: 1000 chars
- **Overlap**: 150 chars
- **Search**: Semantic + Keyword
- **Fusion**: RRF (k=60)
- **Threshold**: 0.3 similarity

## Optimization Checklist

### 1. Query Analysis
```typescript
// Check query expansion
const expandedQuery = expandQuery(originalQuery);
console.log('Expanded:', expandedQuery);

// Verify embedding quality
const embedding = await generateEmbedding(query);
console.log('Embedding dims:', embedding.length);
```

### 2. Retrieval Debugging
```typescript
// Log search results
const semanticResults = await semanticSearch(embedding);
console.log('Semantic hits:', semanticResults.length);
console.log('Top scores:', semanticResults.slice(0, 5).map(r => r.score));

const keywordResults = await keywordSearch(query);
console.log('Keyword hits:', keywordResults.length);
```

### 3. Chunking Analysis
```typescript
// Analyze chunk distribution
const chunks = await getDocumentChunks(docId);
console.log('Total chunks:', chunks.length);
console.log('Avg chunk size:', avg(chunks.map(c => c.content.length)));
console.log('Page coverage:', unique(chunks.map(c => c.pageNumber)).length);
```

### 4. Performance Metrics
Track and optimize:
- Query latency (target: <1s)
- Retrieval accuracy (target: >90%)
- Result relevance (human eval)
- False positive rate

## Common Issues & Solutions

### Poor Retrieval Quality
1. Check embedding model alignment
2. Verify chunk boundaries preserve meaning
3. Tune similarity threshold
4. Add query expansion terms

### Slow Search
1. Add vector index (HNSW/IVFFlat)
2. Reduce top_k in initial search
3. Cache frequent queries
4. Use approximate search

### Missing Relevant Chunks
1. Increase chunk overlap
2. Add keyword fallback
3. Implement query rewriting
4. Use multi-query retrieval

### Hallucinations
1. Strengthen system prompt
2. Add source verification
3. Implement confidence scoring
4. Use grounding techniques

## Code Locations
- RAG System: @nextjs_space/lib/embeddings-v2.ts
- Chat API: @nextjs_space/app/api/chat/route.ts
- Document Processing: @nextjs_space/lib/pdf-processor.ts

## Research References
- @research/application/rag-frameworks/RAG_FRAMEWORKS_COMPARISON.md
- @research/application/architecture/RECOMMENDED_ARCHITECTURE.md
