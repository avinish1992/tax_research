---
paths: nextjs_space/lib/embeddings**, nextjs_space/**/chat/**
---

# RAG System Standards

## Embedding Generation
- Use text-embedding-3-small (1536 dimensions)
- Always handle API errors gracefully
- Cache embeddings when possible
- Batch embedding requests for efficiency

## Chunking
- Chunk size: 1000 characters
- Overlap: 150 characters
- Preserve sentence boundaries when possible
- Track page numbers for citations

## Search
### Semantic Search
- Minimum similarity threshold: 0.3
- Top-K: 10 for initial retrieval
- Use cosine similarity

### Keyword Search
- TF-IDF scoring
- Include query expansion terms
- Weight legal terms higher

### Hybrid Search
- Combine with RRF (k=60)
- Final reranking by combined score
- Return top 5-10 for context

## Query Expansion
```typescript
// Always expand legal terms
const expansions: Record<string, string[]> = {
  'chapter': ['article', 'section'],
  'clause': ['provision', 'term'],
  'liability': ['responsibility', 'obligation'],
  // Add more as needed
}
```

## Context Building
- Include page numbers in context
- Format chunks clearly for LLM
- Add source attribution markers
- Limit total context to ~4000 tokens

## System Prompts
- Enforce document-only responses
- Require source citations
- Handle "not found" gracefully
- No hallucination tolerance
