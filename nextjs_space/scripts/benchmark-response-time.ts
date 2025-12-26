/**
 * Response Pipeline Benchmark Script
 *
 * Measures time spent in each phase:
 * 1. Embedding generation (OpenAI API)
 * 2. Hybrid search / chunk retrieval (Supabase pgvector)
 * 3. LLM generation (OpenAI API)
 * 4. Other overhead (DB operations, network)
 *
 * Run with: npx ts-node scripts/benchmark-response-time.ts
 */

import { createClient } from '@supabase/supabase-js'

// Configuration - uses environment variables
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Test configuration
const TEST_USER_ID = process.env.TEST_USER_ID || '5f855b8f-d34d-44dd-96c5-ea2263a6939d' // chandra
const TEST_QUERIES = [
  'What is the corporate tax rate in UAE?',
  'What are the penalties for late tax filing?',
  'How is taxable income calculated?',
]

interface BenchmarkResult {
  query: string
  timings: {
    embeddingMs: number
    searchMs: number
    llmFirstTokenMs: number
    llmTotalMs: number
    overheadMs: number
    totalMs: number
  }
  chunksRetrieved: number
  tokensGenerated: number
}

// Validate environment
function validateEnv(): boolean {
  const missing: string[] = []
  if (!OPENAI_API_KEY) missing.push('OPENAI_API_KEY')
  if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!SUPABASE_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  if (missing.length > 0) {
    console.error('❌ Missing environment variables:')
    missing.forEach(v => console.error(`   - ${v}`))
    return false
  }

  console.log('✅ Environment variables configured')
  console.log(`   OPENAI_API_KEY: ${OPENAI_API_KEY?.substring(0, 10)}...${OPENAI_API_KEY?.substring(OPENAI_API_KEY.length - 4)}`)
  console.log(`   SUPABASE_URL: ${SUPABASE_URL}`)
  console.log(`   SUPABASE_KEY: ${SUPABASE_KEY?.substring(0, 15)}...`)
  return true
}

// Create Supabase client
function getSupabase() {
  return createClient(SUPABASE_URL!, SUPABASE_KEY!)
}

// Phase 1: Generate embedding
async function benchmarkEmbedding(text: string): Promise<{ embedding: number[], timeMs: number }> {
  const start = performance.now()

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Embedding API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const embedding = data?.data?.[0]?.embedding || []

    return {
      embedding,
      timeMs: performance.now() - start
    }
  } catch (error: any) {
    console.error(`    ❌ Embedding error: ${error.message}`)
    throw error
  }
}

// Phase 2: Hybrid search
async function benchmarkSearch(
  queryEmbedding: number[],
  queryText: string,
  userId: string
): Promise<{ chunks: any[], timeMs: number }> {
  const supabase = getSupabase()
  const start = performance.now()

  const { data, error } = await supabase.rpc('hybrid_search', {
    query_text: queryText,
    query_embedding: JSON.stringify(queryEmbedding),
    p_user_id: userId,
    match_count: 20,
    semantic_weight: 0.6,
    keyword_weight: 0.4,
    rrf_k: 60,
    min_semantic_similarity: 0.25
  })

  if (error) {
    console.error('Search error:', error)
    return { chunks: [], timeMs: performance.now() - start }
  }

  return {
    chunks: data || [],
    timeMs: performance.now() - start
  }
}

// Phase 3: LLM generation with streaming
async function benchmarkLLM(
  query: string,
  context: string
): Promise<{ response: string, firstTokenMs: number, totalMs: number, tokens: number }> {
  const start = performance.now()
  let firstTokenTime = 0
  let response = ''

  const messages = [
    {
      role: 'system',
      content: `You are a helpful legal AI assistant. Answer based on the provided context.\n\nContext:\n${context}`
    },
    { role: 'user', content: query }
  ]

  const fetchResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      stream: true,
      max_tokens: 500,
    }),
  })

  if (!fetchResponse.ok) {
    throw new Error(`LLM API error: ${fetchResponse.status}`)
  }

  const reader = fetchResponse.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        try {
          const data = JSON.parse(line.slice(6))
          const content = data?.choices?.[0]?.delta?.content
          if (content) {
            if (!firstTokenTime) {
              firstTokenTime = performance.now() - start
            }
            response += content
          }
        } catch (e) {
          // Skip malformed JSON
        }
      }
    }
  }

  return {
    response,
    firstTokenMs: firstTokenTime,
    totalMs: performance.now() - start,
    tokens: Math.ceil(response.length / 4) // Rough estimate
  }
}

// Run single query benchmark
async function benchmarkQuery(query: string): Promise<BenchmarkResult> {
  const totalStart = performance.now()

  console.log(`\n  Query: "${query.substring(0, 50)}..."`)

  // Phase 1: Embedding
  console.log('    [1/3] Generating embedding...')
  const embeddingResult = await benchmarkEmbedding(query)
  console.log(`         ✓ ${embeddingResult.timeMs.toFixed(0)}ms`)

  // Phase 2: Search
  console.log('    [2/3] Searching chunks...')
  const searchResult = await benchmarkSearch(
    embeddingResult.embedding,
    query,
    TEST_USER_ID
  )
  console.log(`         ✓ ${searchResult.timeMs.toFixed(0)}ms (${searchResult.chunks.length} chunks)`)

  // Build context from chunks
  const context = searchResult.chunks
    .slice(0, 10)
    .map((c: any, i: number) => `[${i+1}] ${c.content}`)
    .join('\n\n')

  // Phase 3: LLM
  console.log('    [3/3] Generating response...')
  const llmResult = await benchmarkLLM(query, context)
  console.log(`         ✓ First token: ${llmResult.firstTokenMs.toFixed(0)}ms, Total: ${llmResult.totalMs.toFixed(0)}ms`)

  const totalMs = performance.now() - totalStart
  const overheadMs = totalMs - embeddingResult.timeMs - searchResult.timeMs - llmResult.totalMs

  return {
    query,
    timings: {
      embeddingMs: embeddingResult.timeMs,
      searchMs: searchResult.timeMs,
      llmFirstTokenMs: llmResult.firstTokenMs,
      llmTotalMs: llmResult.totalMs,
      overheadMs: Math.max(0, overheadMs),
      totalMs,
    },
    chunksRetrieved: searchResult.chunks.length,
    tokensGenerated: llmResult.tokens,
  }
}

// Main benchmark function
async function runBenchmark() {
  console.log('='.repeat(70))
  console.log('⏱️  RESPONSE PIPELINE BENCHMARK')
  console.log('='.repeat(70))

  // Validate environment
  if (!validateEnv()) {
    process.exit(1)
  }

  console.log(`\nTest User ID: ${TEST_USER_ID}`)
  console.log(`Queries to test: ${TEST_QUERIES.length}`)

  const results: BenchmarkResult[] = []

  // Run benchmarks
  console.log('\n' + '-'.repeat(70))
  console.log('Running benchmarks...')
  console.log('-'.repeat(70))

  for (const query of TEST_QUERIES) {
    try {
      const result = await benchmarkQuery(query)
      results.push(result)

      // Small delay between queries
      await new Promise(r => setTimeout(r, 500))
    } catch (error) {
      console.error(`  ❌ Error: ${error}`)
    }
  }

  // Calculate averages
  const avgTimings = {
    embeddingMs: results.reduce((s, r) => s + r.timings.embeddingMs, 0) / results.length,
    searchMs: results.reduce((s, r) => s + r.timings.searchMs, 0) / results.length,
    llmFirstTokenMs: results.reduce((s, r) => s + r.timings.llmFirstTokenMs, 0) / results.length,
    llmTotalMs: results.reduce((s, r) => s + r.timings.llmTotalMs, 0) / results.length,
    overheadMs: results.reduce((s, r) => s + r.timings.overheadMs, 0) / results.length,
    totalMs: results.reduce((s, r) => s + r.timings.totalMs, 0) / results.length,
  }

  // Print results
  console.log('\n' + '='.repeat(70))
  console.log('📊 BENCHMARK RESULTS')
  console.log('='.repeat(70))

  console.log('\n┌─────────────────────────┬──────────┬──────────┐')
  console.log('│ Phase                   │ Avg (ms) │ % Total  │')
  console.log('├─────────────────────────┼──────────┼──────────┤')
  console.log(`│ 1. Embedding Generation │ ${avgTimings.embeddingMs.toFixed(0).padStart(8)} │ ${((avgTimings.embeddingMs/avgTimings.totalMs)*100).toFixed(1).padStart(7)}% │`)
  console.log(`│ 2. Chunk Retrieval      │ ${avgTimings.searchMs.toFixed(0).padStart(8)} │ ${((avgTimings.searchMs/avgTimings.totalMs)*100).toFixed(1).padStart(7)}% │`)
  console.log(`│ 3. LLM (first token)    │ ${avgTimings.llmFirstTokenMs.toFixed(0).padStart(8)} │ ${((avgTimings.llmFirstTokenMs/avgTimings.totalMs)*100).toFixed(1).padStart(7)}% │`)
  console.log(`│ 3. LLM (total)          │ ${avgTimings.llmTotalMs.toFixed(0).padStart(8)} │ ${((avgTimings.llmTotalMs/avgTimings.totalMs)*100).toFixed(1).padStart(7)}% │`)
  console.log(`│ 4. Overhead/Network     │ ${avgTimings.overheadMs.toFixed(0).padStart(8)} │ ${((avgTimings.overheadMs/avgTimings.totalMs)*100).toFixed(1).padStart(7)}% │`)
  console.log('├─────────────────────────┼──────────┼──────────┤')
  console.log(`│ TOTAL                   │ ${avgTimings.totalMs.toFixed(0).padStart(8)} │   100.0% │`)
  console.log('└─────────────────────────┴──────────┴──────────┘')

  // Breakdown per query
  console.log('\n📋 Per-Query Breakdown:')
  results.forEach((r, i) => {
    console.log(`\n  Query ${i+1}: "${r.query.substring(0, 40)}..."`)
    console.log(`    Embedding: ${r.timings.embeddingMs.toFixed(0)}ms | Search: ${r.timings.searchMs.toFixed(0)}ms | LLM: ${r.timings.llmTotalMs.toFixed(0)}ms | Total: ${r.timings.totalMs.toFixed(0)}ms`)
    console.log(`    Chunks: ${r.chunksRetrieved} | Tokens: ~${r.tokensGenerated}`)
  })

  // Optimization recommendations
  console.log('\n' + '='.repeat(70))
  console.log('💡 OPTIMIZATION ANALYSIS')
  console.log('='.repeat(70))

  const bottleneck = Object.entries({
    'Embedding': avgTimings.embeddingMs,
    'Search': avgTimings.searchMs,
    'LLM': avgTimings.llmTotalMs,
  }).sort((a, b) => b[1] - a[1])[0]

  console.log(`\n  Biggest bottleneck: ${bottleneck[0]} (${bottleneck[1].toFixed(0)}ms)`)

  if (bottleneck[0] === 'LLM') {
    console.log('\n  Recommendations for LLM optimization:')
    console.log('    - Use gpt-4o-mini (already optimal for speed)')
    console.log('    - Reduce max_tokens if shorter responses acceptable')
    console.log('    - Consider caching common responses')
  } else if (bottleneck[0] === 'Search') {
    console.log('\n  Recommendations for Search optimization:')
    console.log('    - Add database indexes on frequently queried columns')
    console.log('    - Consider dedicated vector DB (Qdrant, Pinecone)')
    console.log('    - Reduce match_count if fewer chunks needed')
  } else {
    console.log('\n  Recommendations for Embedding optimization:')
    console.log('    - Cache embeddings for repeated queries')
    console.log('    - Use batch embedding API for multiple queries')
  }

  console.log('\n' + '='.repeat(70))
  console.log('✅ Benchmark Complete!')
  console.log('='.repeat(70))
}

// Run
runBenchmark().catch(console.error)
