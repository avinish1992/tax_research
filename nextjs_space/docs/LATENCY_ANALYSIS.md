# Latency Analysis Report

**Date:** December 27, 2025
**Test User:** chandra.4@iitj.ac.in
**Environment:** Local development server

## Summary

Comprehensive latency testing was performed on the Legal AI Assistant chat API. The main finding is that **the LLM TTFT (615-1376ms) is acceptable**, but the overall user-perceived TTFT (~9-11s) is dominated by the RAG preprocessing pipeline.

---

## Metrics Captured

### What We Measure

| Metric | Description |
|--------|-------------|
| `authTimeMs` | Time to authenticate user via Supabase |
| `sessionFetchTimeMs` | Time to fetch chat session from database |
| `ragEmbeddingTimeMs` | Time to generate query embedding (OpenAI API) |
| `ragSearchTimeMs` | Time for hybrid search (pgvector + keyword) |
| `ragTotalTimeMs` | Total RAG pipeline time |
| `llmTtftMs` | **Time To First Token** from LLM |
| `llmStreamDurationMs` | Time from first to last token |
| `llmTotalTimeMs` | Total LLM response time |
| `tokenCount` | Approximate tokens in response |
| `tokensPerSecond` | Streaming throughput |
| `totalRequestTimeMs` | End-to-end request time |

---

## Test Results

### Individual Query Performance

| Query Type | End-to-End | LLM TTFT | RAG Time | Tokens |
|------------|------------|----------|----------|--------|
| Simple greeting | 14.2s | 615ms | ~2s | 14 |
| Document listing | 13.3s | 1376ms | ~4s | 175 |
| Legal question | 11.7s | 1376ms | ~3.7s | 91 |
| Complex summary | 13.4s | 615ms | ~4s | 239 |

### Aggregate Statistics

```
⚡ LLM Time To First Token:
   Min:  615ms
   Avg:  996ms
   Max:  1376ms

🔄 RAG Pipeline:
   Min:  ~2000ms (no docs retrieved)
   Avg:  ~3800ms
   Max:  ~4000ms

⏱️  Total Request Time:
   Min:  11.7s
   Avg:  13.2s
   Max:  14.2s
```

---

## Latency Breakdown

```
┌────────────────────────────────────────────────────────────┐
│                    REQUEST TIMELINE                        │
├────────────────────────────────────────────────────────────┤
│ Auth          │████                           │  ~480ms    │
│ Session       │████                           │  ~470ms    │
│ RAG Embedding │████████████████               │  ~2000ms   │
│ RAG Search    │████████████████               │  ~2000ms   │
│ LLM TTFT      │████████                       │  ~1000ms   │
│ LLM Stream    │████████████████████████       │  ~3000ms   │
├────────────────────────────────────────────────────────────┤
│ TOTAL         │                               │  ~10-12s   │
└────────────────────────────────────────────────────────────┘
```

### Percentage Breakdown

| Component | Time | % of Total |
|-----------|------|------------|
| Auth | 480ms | 4% |
| Session Fetch | 470ms | 4% |
| **RAG Embedding** | **2000ms** | **18%** |
| **RAG Search** | **2000ms** | **18%** |
| LLM TTFT | 1000ms | 9% |
| LLM Streaming | 3000ms | 27% |
| Other overhead | 2000ms | 18% |

---

## Key Findings

### ✅ Good Performance

1. **LLM TTFT is acceptable**: 615-1376ms is within reasonable range for GPT-4o-mini
2. **Token throughput is healthy**: 66-86 tokens/second
3. **Auth is fast after warmup**: First request ~1.1s, subsequent ~320ms

### ⚠️ Bottlenecks Identified

1. **RAG Pipeline is the main bottleneck** (~4 seconds, 36% of total time)
   - Embedding generation: ~2s (OpenAI embeddings API latency)
   - Hybrid search: ~2s (Supabase pgvector + keyword search)

2. **Cold start penalty**: First request takes ~2s longer (auth + session cache miss)

---

## Optimization Recommendations

### High Impact

1. **Cache embeddings for common queries**
   - Implement query embedding cache (Redis/in-memory)
   - Expected improvement: -1.5s for repeated queries

2. **Optimize hybrid search**
   - Reduce `TOP_K` from 50 to 30 (currently fetching 50, using 20)
   - Use approximate nearest neighbor (ANN) indexes
   - Expected improvement: -500ms to -1s

3. **Stream earlier**
   - Send "thinking..." indicator before RAG completes
   - Improves perceived responsiveness

### Medium Impact

4. **Batch embedding requests**
   - If multiple queries, batch them to OpenAI

5. **Pre-warm connections**
   - Keep Supabase connection pool warm
   - Pre-authenticate on app load

6. **Consider smaller embedding model**
   - `text-embedding-3-small` → faster alternative if quality acceptable

### Lower Priority

7. **Edge caching for session data**
8. **Connection pooling optimization**
9. **Query expansion optimization**

---

## How to Use the Test Endpoint

### API Endpoint

```bash
POST /api/test/latency
```

### Headers

```
x-api-key: latency-test-key-2024
Content-Type: application/json
```

### Request Body

```json
{
  "query": "What is the corporate tax rate?",
  "model": "gpt-4o-mini"
}
```

### Example

```bash
curl -X POST http://localhost:3000/api/test/latency \
  -H "x-api-key: latency-test-key-2024" \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the corporate tax rate?"}'
```

### Run Test Script

```bash
cd nextjs_space
API_URL=http://localhost:3000 npx tsx scripts/test-latency.ts
```

---

## Log Monitoring

### Find Latency Logs

```bash
# In Netlify logs, search for:
grep "LATENCY METRICS" <log-file>

# Or for JSON parsing:
grep "METRICS_JSON" <log-file> | sed 's/.*METRICS_JSON] //'
```

### Log Format

```
📊 LATENCY METRICS [req_id]
================================================================================
⏱️  TIMING BREAKDOWN:
   Auth:          481ms
   Session Fetch: 474ms
   RAG Total:     3669ms
     - Embedding: 1759ms
     - Search:    1910ms
   LLM Total:     2750ms
     - TTFT:      1376ms
     - Streaming: 1367ms
================================================================================
```

---

## Files Modified

- [app/api/chat/route.ts](../app/api/chat/route.ts) - Added comprehensive latency logging
- [app/api/test/latency/route.ts](../app/api/test/latency/route.ts) - New test endpoint
- [scripts/test-latency.ts](../scripts/test-latency.ts) - Test script for running benchmarks
