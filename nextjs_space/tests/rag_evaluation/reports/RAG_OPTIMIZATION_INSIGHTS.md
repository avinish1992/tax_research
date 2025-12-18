# RAG Pipeline Optimization Insights

## Executive Summary

Based on the comprehensive evaluation of your RAG pipeline on the UAE Corporate Tax Law document, here are the key findings and actionable recommendations.

---

## Current Performance Snapshot

### Retrieval Metrics
| Metric | Score | Target | Status |
|--------|-------|--------|--------|
| Precision@5 | 77.6% | >80% | Needs Improvement |
| Recall | 71.0% | >75% | Needs Improvement |
| F1 Score | 71.3% | >75% | Needs Improvement |
| MRR | 0.943 | >0.90 | Excellent |
| MAP | 0.933 | >0.85 | Excellent |
| Hit Rate | 100% | >95% | Excellent |
| NDCG@5 | 0.377 | >0.60 | Needs Improvement |
| Page Accuracy | 28.7% | >50% | Critical |
| Context Relevancy (LLM) | 42.8% | >70% | Critical |

### Generation Metrics (LLM-Judged)
| Metric | Score | Target | Status |
|--------|-------|--------|--------|
| Faithfulness | 82.0% | >85% | Good |
| Answer Relevancy | 84.0% | >85% | Good |

### Timing Metrics
| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Avg Embedding Time | 1332ms | <500ms | Needs Improvement |
| Avg Search Time | 452ms | <300ms | Acceptable |
| Avg Total Retrieval | 1783ms | <1000ms | Needs Improvement |
| P95 Retrieval | 4207ms | <2000ms | Critical |

---

## Key Findings

### Strengths

1. **Excellent Ranking Quality (MRR=0.943)**
   - The first relevant document appears near the top 94.3% of the time
   - Hybrid search with RRF fusion is working effectively

2. **Perfect Hit Rate (100%)**
   - Every query returns at least one relevant result
   - No queries completely fail to find relevant content

3. **Good Generation Quality**
   - Faithfulness (82%) indicates low hallucination risk
   - Answer relevancy (84%) shows responses address queries well

4. **Hard Questions Perform Well**
   - Hard questions: P@K=83.3%, MRR=1.000
   - Complex legal queries are handled effectively

### Weaknesses

1. **Low Page Accuracy (28.7%)**
   - **Root Cause**: Chunks don't maintain clear page boundary markers
   - **Impact**: Users can't easily verify source information

2. **Low Context Relevancy (42.8%)**
   - **Root Cause**: Retrieved chunks contain related but not directly relevant content
   - **Impact**: LLM may include tangential information in responses

3. **Low NDCG (0.377)**
   - **Root Cause**: Relevant information scattered across ranks, not concentrated at top
   - **Impact**: Users need to read more chunks to find complete answers

4. **High Embedding Latency (1332ms)**
   - **Root Cause**: API calls to OpenAI for each query
   - **Impact**: Poor user experience, especially for follow-up questions

5. **High P95 Latency (4207ms)**
   - **Root Cause**: Occasional slow API responses
   - **Impact**: Inconsistent user experience

---

## Optimization Recommendations

### Priority 1: Improve Chunking Strategy

**Current Issue**: Page accuracy is only 28.7%

**Recommendations**:

```typescript
// Enhanced chunking with metadata preservation
interface EnhancedChunk {
  content: string;
  page_numbers: number[];      // All pages this chunk spans
  section_hierarchy: string[]; // Article > Section > Subsection
  chunk_type: 'definition' | 'provision' | 'example' | 'reference';
  semantic_summary: string;    // AI-generated summary
}
```

1. **Use Semantic Chunking**: Split by document structure (Articles, Sections) not just character count
2. **Preserve Page Boundaries**: Tag chunks with all pages they span
3. **Add Section Headers**: Include hierarchical context in each chunk
4. **Implement Overlap Deduplication**: Current overlap may create near-duplicate chunks

### Priority 2: Implement Query Expansion

**Current Issue**: Recall is 71%, missing some relevant content

**Recommendations**:

```python
# Query expansion for legal documents
def expand_legal_query(query: str) -> list[str]:
    expansions = [query]

    # Add synonyms for legal terms
    legal_synonyms = {
        "corporate tax": ["CT", "business tax", "company tax"],
        "taxable income": ["chargeable income", "assessable income"],
        "exemptions": ["exempt entities", "tax-exempt", "exclusions"],
    }

    # Generate paraphrased queries
    paraphrased = llm.paraphrase(query)
    expansions.append(paraphrased)

    # Add hypothetical document query (HyDE)
    hypothetical_answer = llm.generate_answer(query)
    expansions.append(hypothetical_answer)

    return expansions
```

### Priority 3: Improve Re-ranking

**Current Issue**: NDCG is 0.377, relevant docs not at top

**Recommendations**:

1. **Add Cross-Encoder Re-ranking**:
```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-12-v2')

def rerank_results(query: str, results: list[dict]) -> list[dict]:
    pairs = [(query, r['content']) for r in results]
    scores = reranker.predict(pairs)

    for i, r in enumerate(results):
        r['rerank_score'] = scores[i]

    return sorted(results, key=lambda x: x['rerank_score'], reverse=True)
```

2. **Use Cohere Rerank API** for production (faster, better quality)

### Priority 4: Reduce Latency

**Current Issue**: Embedding time averages 1332ms

**Recommendations**:

1. **Implement Embedding Caching**:
```typescript
// Redis-based embedding cache
const EMBEDDING_CACHE_TTL = 86400; // 24 hours

async function getEmbedding(text: string): Promise<number[]> {
  const cacheKey = `emb:${hash(text)}`;

  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });

  await redis.setex(cacheKey, EMBEDDING_CACHE_TTL, JSON.stringify(embedding));
  return embedding;
}
```

2. **Use Local Embedding Model** for follow-up queries:
   - `all-MiniLM-L6-v2` is 10x faster
   - Acceptable quality for conversation context

3. **Batch Embedding Requests** for document processing

### Priority 5: Enhance Context Relevancy

**Current Issue**: LLM-judged context relevancy is only 42.8%

**Recommendations**:

1. **Implement Contextual Compression**:
```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import LLMChainExtractor

compressor = LLMChainExtractor.from_llm(llm)
compression_retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=base_retriever
)
```

2. **Add Relevancy Filtering**:
```python
def filter_by_relevancy(query: str, chunks: list, threshold: float = 0.6) -> list:
    """Filter chunks that don't meet relevancy threshold"""
    filtered = []
    for chunk in chunks:
        relevancy = judge_relevancy(query, chunk.content)
        if relevancy >= threshold:
            chunk.relevancy_score = relevancy
            filtered.append(chunk)
    return filtered
```

3. **Use Multi-Query Retrieval**:
   - Generate 3-5 query variations
   - Retrieve for each and merge results
   - Improves coverage and relevancy

---

## Metrics Comparison: Industry Benchmarks

| Metric | Your Pipeline | Industry Average | Top RAG Systems |
|--------|---------------|------------------|-----------------|
| Precision@5 | 77.6% | 70-75% | 85-90% |
| Recall | 71.0% | 65-70% | 80-85% |
| MRR | 0.943 | 0.75-0.85 | >0.95 |
| NDCG@5 | 0.377 | 0.50-0.60 | 0.75-0.85 |
| Faithfulness | 82.0% | 75-80% | 90-95% |
| Latency (P50) | 1336ms | 500-1000ms | 200-500ms |

---

## Recommended Implementation Roadmap

### Week 1: Quick Wins
- [ ] Implement embedding caching (reduce latency by 50%+)
- [ ] Add page boundary markers to chunks
- [ ] Implement query expansion with synonyms

### Week 2: Core Improvements
- [ ] Implement cross-encoder re-ranking
- [ ] Add contextual compression
- [ ] Improve chunking to respect document structure

### Week 3: Advanced Optimizations
- [ ] Implement multi-query retrieval
- [ ] Add relevancy filtering
- [ ] Set up semantic caching for common queries

### Week 4: Monitoring & Testing
- [ ] Run evaluation on extended dataset (50 questions)
- [ ] Set up automated regression testing
- [ ] Configure alerting for metric degradation

---

## Expected Improvements After Optimization

| Metric | Current | Expected After Optimization |
|--------|---------|----------------------------|
| Precision@5 | 77.6% | 85-88% |
| Recall | 71.0% | 80-85% |
| NDCG@5 | 0.377 | 0.65-0.75 |
| Page Accuracy | 28.7% | 60-70% |
| Context Relevancy | 42.8% | 75-85% |
| Avg Latency | 1783ms | 600-900ms |
| P95 Latency | 4207ms | 1500-2000ms |

---

## Files Created

1. **Comprehensive Python Evaluator**: `python_eval/comprehensive_rag_eval.py`
   - 12 retrieval metrics
   - 4 LLM-judged generation metrics
   - Timing and cost analysis
   - Breakdown by difficulty and category

2. **RAGAS/DeepEval Integration**: `python_eval/ragas_deepeval_integration.py`
   - Custom LLM judge fallback
   - Context precision/recall
   - Faithfulness evaluation
   - Answer relevancy scoring

3. **Extended Dataset**: `datasets/uae_corporate_tax_extended_qa.json`
   - 50 questions (double the original)
   - Multi-hop questions
   - Edge cases and stress tests
   - Question type annotations

4. **Requirements**: `python_eval/requirements.txt`
   - All dependencies for evaluation

---

## Running Evaluations

```bash
# Run comprehensive evaluation
cd tests/rag_evaluation/python_eval
python3 comprehensive_rag_eval.py

# Run with extended dataset (modify dataset path in script)
# Change: dataset_path = script_dir.parent / 'datasets' / 'uae_corporate_tax_extended_qa.json'
python3 comprehensive_rag_eval.py

# Run LLM-judged evaluation
python3 ragas_deepeval_integration.py
```

---

## Sources & References

- [RAGAS Documentation](https://docs.ragas.io/)
- [DeepEval RAG Evaluation](https://deepeval.com/guides/guides-rag-evaluation)
- [Best RAG Evaluation Tools 2025](https://www.deepchecks.com/best-rag-evaluation-tools/)
- [RAG Evaluation Guide - Qdrant](https://qdrant.tech/blog/rag-evaluation-guide/)
- [RAG Evaluation Metrics - Pinecone](https://www.pinecone.io/learn/series/vector-databases-in-production-for-busy-engineers/rag-evaluation/)
