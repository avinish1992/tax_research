# RAG Optimization Research - December 2025

## Summary

This document captures the empirical testing done to optimize the RAG retrieval pipeline for the Legal AI Assistant.

## Test Environment

- **Database:** Supabase PostgreSQL with pgvector
- **Embedding Model:** OpenAI text-embedding-3-small (1536 dimensions)
- **Test Dataset:** 500 QA pairs from UAE Corporate Tax Law documents
- **User:** chandra (5f855b8f-d34d-44dd-96c5-ea2263a6939d)
- **Documents:** 77 uploaded legal documents

---

## Test 1: Similarity Threshold Comparison

**Objective:** Find optimal similarity threshold for filtering results

### Thresholds Tested
- 0.25, 0.30, 0.35, 0.40, 0.75

### Key Findings

| Threshold | DocTop3 | ChunkTop10 | Coverage |
|-----------|---------|------------|----------|
| 0.25      | 74%     | 80%        | 100%     |
| 0.30      | 74%     | 80%        | 100%     |
| 0.35      | 74%     | 80%        | 100%     |
| 0.40      | 74%     | 80%        | 100%     |
| 0.75      | 24%     | ~26%       | ~26%     |

**Analysis:**
- Thresholds 0.25-0.40 produce identical results because avg similarity is ~0.65
- Threshold 0.75 is too aggressive - filters out most relevant chunks
- **Recommendation:** Use threshold 0.25 to maximize recall

---

## Test 2: Top-K Comparison (10 vs 20)

**Objective:** Determine if retrieving more chunks improves multi-document question performance

### Results by Chunk Span

| Span | K=10 Chunk% | K=20 Chunk% | Improvement |
|------|-------------|-------------|-------------|
| 1    | 70%         | 90%         | +20%        |
| 3    | 60%         | 70%         | +10%        |
| 5    | 50%         | 50%         | 0%          |
| 10   | 50%         | 60%         | +10%        |
| 15   | 50%         | 55%         | +5%         |
| ALL  | 58%         | 68%         | +10%        |

**Key Observations:**
- Chunks found at ranks 11-16 with K=20 that were missed with K=10
- Single-document questions (span=1) show largest improvement (+20%)
- **Recommendation:** Increase FINAL_TOP_K from 10 to 20

---

## Test 3: LLM Reranking Comparison

**Objective:** Test if LLM-based reranking (GPT-4o-mini) improves retrieval quality

### Configuration
- Initial retrieval: top-50
- Rerank to: top-20
- Final results: top-10

### Results

| Metric | No Rerank | LLM Rerank | Change |
|--------|-----------|------------|--------|
| Overall Chunk Found | 62% | 62% | 0% |
| Document Found | 90% | 90% | 0% |
| Avg Latency | 579ms | 2979ms | +2400ms (+415%) |

### By Chunk Span

| Span | NoRerank Chunk% | LLM Chunk% | Change |
|------|-----------------|------------|--------|
| 1    | 60%             | 80%        | +20%   |
| 3    | 80%             | 90%        | +10%   |
| 5    | 80%             | 70%        | -10%   |
| 10   | 40%             | 40%        | 0%     |
| 15   | 50%             | 30%        | -20%   |

### Rank Analysis
- Chunks newly found by reranking: 4
- Chunks lost by reranking: 4
- Rank improved (moved up): 11
- Rank degraded (moved down): 7
- **Net chunk improvement: 0**

**Analysis:**
- LLM reranking helps single-document questions (+20% for span=1)
- But HURTS multi-document questions (-10% to -20% for span=5-15)
- Latency increase of +2400ms is significant
- **Recommendation:** Do NOT enable LLM reranking - net zero benefit

---

## Final Production Configuration

```typescript
// supabase-rag.ts
const DEFAULT_TOP_K = 50      // Initial retrieval
const DEFAULT_MIN_SIMILARITY = 0.25  // Threshold
const FINAL_TOP_K = 20        // Final results (increased from 10)
// Reranking: DISABLED
```

## Performance Summary

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Chunk Found (K=10) | 58% | - | - |
| Chunk Found (K=20) | - | 68% | +10% |
| Document Recall | 90% | 90% | 0% |
| Avg Response Time | ~1400ms | ~1400ms | 0% |

---

## Future Optimization Ideas

1. **Query Decomposition:** Break complex multi-document questions into sub-queries
2. **Chunking Strategy:** Experiment with larger chunks for better context
3. **Embedding Model:** Try text-embedding-3-large for better semantic matching
4. **Hybrid Search Tuning:** Adjust semantic/keyword weights per query type
5. **Heuristic Reranking:** Test keyword-based boosting (free, faster than LLM)

---

## Test Scripts Location

- `nextjs_space/scripts/topk-comparison-test.ts` - Top-K comparison
- `nextjs_space/scripts/reranking-comparison-test.ts` - Reranking comparison
- `nextjs_space/scripts/e2e-rag-eval.ts` - E2E evaluation with Playwright
- `nextjs_space/scripts/parallel-rag-test.ts` - Full strategy comparison

## Dataset Location

- `nextjs_space/scripts/eval_results/qa_pairs_dataset_v2.json` - 500 QA pairs with correct chunk IDs
