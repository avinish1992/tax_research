---
argument-hint: [query-or-doc-id]
description: Analyze RAG retrieval quality for a query or document
allowed-tools: Read, Grep, Glob, Bash
---

# RAG Analysis Request

Analyze the RAG retrieval quality for: $1

## Tasks

1. **If query provided**: Test the retrieval pipeline
   - Check query expansion
   - Generate embedding
   - Run hybrid search
   - Analyze result relevance

2. **If document ID provided**: Analyze document indexing
   - Count chunks
   - Check embedding coverage
   - Verify page tracking
   - Test sample queries

## Files to Check
- RAG System: nextjs_space/lib/embeddings-v2.ts
- Chat API: nextjs_space/app/api/chat/route.ts
- Test Scripts: nextjs_space/test_rag.js

## Output
Provide:
- Retrieval metrics
- Quality assessment
- Specific recommendations
- Code changes if needed
