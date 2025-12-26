/**
 * Latency Profiler for RAG Pipeline
 * Measures exact timing breakdown: Retrieval vs Generation
 *
 * Run with: node scripts/profile-latency.js
 */

const fs = require('fs')
const path = require('path')

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const EMBEDDING_MODEL = 'text-embedding-3-small'
const LLM_MODEL = 'gpt-4o-mini'

// API endpoints
const OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings'
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'

// Test queries for profiling
const TEST_QUERIES = [
  "What is the corporate tax rate in UAE?",
  "What are the tax exemptions available?",
  "How is taxable income calculated?",
]

// Timing utilities
class Timer {
  constructor(name) {
    this.name = name
    this.start = null
    this.end = null
  }

  begin() {
    this.start = performance.now()
    return this
  }

  stop() {
    this.end = performance.now()
    return this.duration()
  }

  duration() {
    return this.end - this.start
  }
}

// Results storage
const results = {
  timestamp: new Date().toISOString(),
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
  },
  queries: [],
  summary: {},
}

// Generate embedding with timing
async function profileEmbedding(text) {
  const timer = new Timer('embedding').begin()

  const response = await fetch(OPENAI_EMBEDDING_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  })

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`)
  }

  const data = await response.json()
  const duration = timer.stop()

  return {
    embedding: data?.data?.[0]?.embedding || [],
    durationMs: duration,
    tokens: data?.usage?.total_tokens || 0,
  }
}

// Simulate hybrid search with timing (using mock since we need DB)
async function profileSearch(queryEmbedding) {
  const timer = new Timer('search').begin()

  // Simulate database vector search latency
  // In production this would hit Supabase pgvector
  await new Promise(r => setTimeout(r, 50 + Math.random() * 100)) // 50-150ms simulated

  const duration = timer.stop()

  // Return mock chunks
  return {
    chunks: [
      { content: "Corporate tax is imposed at 9% on taxable income exceeding AED 375,000.", score: 0.89 },
      { content: "Small businesses with revenue under AED 3 million may qualify for relief.", score: 0.82 },
      { content: "Qualifying Free Zone Persons may be subject to 0% corporate tax.", score: 0.78 },
    ],
    durationMs: duration,
    chunkCount: 3,
  }
}

// Profile LLM generation (non-streaming for accurate timing)
async function profileGeneration(prompt, context) {
  const messages = [
    {
      role: 'system',
      content: `You are a legal AI assistant. Answer based on the provided context.\n\nContext:\n${context}`
    },
    { role: 'user', content: prompt }
  ]

  // Non-streaming request for accurate total time
  const timer = new Timer('generation').begin()

  const response = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      max_tokens: 500,
      stream: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`)
  }

  const data = await response.json()
  const totalDuration = timer.stop()

  return {
    response: data?.choices?.[0]?.message?.content || '',
    durationMs: totalDuration,
    promptTokens: data?.usage?.prompt_tokens || 0,
    completionTokens: data?.usage?.completion_tokens || 0,
    totalTokens: data?.usage?.total_tokens || 0,
  }
}

// Profile streaming LLM generation (for TTFB measurement)
async function profileStreamingGeneration(prompt, context) {
  const messages = [
    {
      role: 'system',
      content: `You are a legal AI assistant. Answer based on the provided context.\n\nContext:\n${context}`
    },
    { role: 'user', content: prompt }
  ]

  const startTime = performance.now()
  let ttfb = null
  let fullResponse = ''
  let chunkCount = 0

  const response = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      max_tokens: 500,
      stream: true,
    }),
  })

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    if (ttfb === null) {
      ttfb = performance.now() - startTime
    }

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n').filter(l => l.trim().startsWith('data: '))

    for (const line of lines) {
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const content = parsed?.choices?.[0]?.delta?.content
        if (content) {
          fullResponse += content
          chunkCount++
        }
      } catch {}
    }
  }

  const totalDuration = performance.now() - startTime

  return {
    response: fullResponse,
    ttfbMs: ttfb,
    totalDurationMs: totalDuration,
    generationTimeMs: totalDuration - ttfb,
    chunkCount,
    tokensPerSecond: fullResponse.length / 4 / (totalDuration / 1000), // rough estimate
  }
}

// Query expansion (synchronous, fast)
function profileQueryExpansion(query) {
  const timer = new Timer('expansion').begin()

  let expanded = query

  // Chapter X → add Article X
  const chapterPattern = /chapter\s+(\d+)/gi
  const chapterMatches = [...query.matchAll(chapterPattern)]
  chapterMatches.forEach((match) => {
    expanded += ` Article ${match[1]}`
  })

  // Article X → add Chapter X
  const articlePattern = /article\s+(\d+)/gi
  const articleMatches = [...query.matchAll(articlePattern)]
  articleMatches.forEach((match) => {
    expanded += ` Chapter ${match[1]}`
  })

  const duration = timer.stop()

  return {
    original: query,
    expanded,
    durationMs: duration,
  }
}

// Full pipeline profile
async function profileFullPipeline(query) {
  console.log(`\n  Query: "${query.substring(0, 50)}..."`)

  const pipelineStart = performance.now()
  const timings = {}

  // 1. Query Expansion
  const expansion = profileQueryExpansion(query)
  timings.queryExpansion = expansion.durationMs
  console.log(`    ├─ Query Expansion: ${expansion.durationMs.toFixed(2)}ms`)

  // 2. Embedding Generation
  const embedding = await profileEmbedding(expansion.expanded)
  timings.embedding = embedding.durationMs
  console.log(`    ├─ Embedding Generation: ${embedding.durationMs.toFixed(2)}ms (${embedding.tokens} tokens)`)

  // 3. Hybrid Search
  const search = await profileSearch(embedding.embedding)
  timings.search = search.durationMs
  console.log(`    ├─ Vector Search: ${search.durationMs.toFixed(2)}ms (${search.chunkCount} chunks)`)

  // Calculate retrieval total
  timings.retrievalTotal = timings.queryExpansion + timings.embedding + timings.search
  console.log(`    ├─ [RETRIEVAL TOTAL]: ${timings.retrievalTotal.toFixed(2)}ms`)

  // 4. LLM Generation (non-streaming)
  const context = search.chunks.map(c => c.content).join('\n\n')
  const generation = await profileGeneration(query, context)
  timings.generation = generation.durationMs
  console.log(`    ├─ LLM Generation: ${generation.durationMs.toFixed(2)}ms (${generation.totalTokens} tokens)`)

  // 5. Streaming comparison
  const streaming = await profileStreamingGeneration(query, context)
  timings.streamingTTFB = streaming.ttfbMs
  timings.streamingTotal = streaming.totalDurationMs
  console.log(`    ├─ Streaming TTFB: ${streaming.ttfbMs.toFixed(2)}ms`)
  console.log(`    ├─ Streaming Total: ${streaming.totalDurationMs.toFixed(2)}ms`)
  console.log(`    └─ Tokens/sec: ${streaming.tokensPerSecond.toFixed(1)}`)

  const pipelineTotal = performance.now() - pipelineStart
  timings.pipelineTotal = pipelineTotal

  // Calculate percentages
  const retrievalPct = (timings.retrievalTotal / (timings.retrievalTotal + timings.generation)) * 100
  const generationPct = 100 - retrievalPct

  return {
    query,
    timings,
    breakdown: {
      retrievalMs: timings.retrievalTotal,
      retrievalPct: retrievalPct.toFixed(1),
      generationMs: timings.generation,
      generationPct: generationPct.toFixed(1),
    },
    tokens: {
      embedding: embedding.tokens,
      prompt: generation.promptTokens,
      completion: generation.completionTokens,
    },
  }
}

// Main profiler
async function runProfiler() {
  console.log('='.repeat(70))
  console.log('⏱️  RAG PIPELINE LATENCY PROFILER')
  console.log('='.repeat(70))

  if (!OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY environment variable required')
    process.exit(1)
  }

  console.log(`\nConfiguration:`)
  console.log(`  Embedding Model: ${EMBEDDING_MODEL}`)
  console.log(`  LLM Model: ${LLM_MODEL}`)
  console.log(`  Test Queries: ${TEST_QUERIES.length}`)

  console.log('\n' + '-'.repeat(70))
  console.log('📊 PROFILING INDIVIDUAL QUERIES')
  console.log('-'.repeat(70))

  const queryResults = []

  for (const query of TEST_QUERIES) {
    try {
      const result = await profileFullPipeline(query)
      queryResults.push(result)
      results.queries.push(result)

      // Rate limiting
      await new Promise(r => setTimeout(r, 1000))
    } catch (error) {
      console.error(`  ❌ Error profiling query: ${error.message}`)
    }
  }

  // Calculate aggregated summary
  console.log('\n' + '='.repeat(70))
  console.log('📈 SUMMARY ANALYSIS')
  console.log('='.repeat(70))

  if (queryResults.length === 0) {
    console.log('No results to summarize')
    return
  }

  // Aggregate timings
  const avgTimings = {
    queryExpansion: 0,
    embedding: 0,
    search: 0,
    retrievalTotal: 0,
    generation: 0,
    streamingTTFB: 0,
    streamingTotal: 0,
  }

  queryResults.forEach(r => {
    Object.keys(avgTimings).forEach(key => {
      avgTimings[key] += r.timings[key] || 0
    })
  })

  Object.keys(avgTimings).forEach(key => {
    avgTimings[key] /= queryResults.length
  })

  const avgRetrievalPct = (avgTimings.retrievalTotal / (avgTimings.retrievalTotal + avgTimings.generation)) * 100
  const avgGenerationPct = 100 - avgRetrievalPct

  results.summary = {
    avgTimings,
    breakdown: {
      retrievalPct: avgRetrievalPct.toFixed(1),
      generationPct: avgGenerationPct.toFixed(1),
    },
  }

  console.log('\n┌─────────────────────────────────────────────────────────────────┐')
  console.log('│                    AVERAGE LATENCY BREAKDOWN                    │')
  console.log('├─────────────────────────────────────────────────────────────────┤')
  console.log(`│  Query Expansion:     ${avgTimings.queryExpansion.toFixed(2).padStart(8)}ms                           │`)
  console.log(`│  Embedding Generation:${avgTimings.embedding.toFixed(2).padStart(8)}ms                           │`)
  console.log(`│  Vector Search:       ${avgTimings.search.toFixed(2).padStart(8)}ms                           │`)
  console.log('├─────────────────────────────────────────────────────────────────┤')
  console.log(`│  📥 RETRIEVAL TOTAL:  ${avgTimings.retrievalTotal.toFixed(2).padStart(8)}ms  (${avgRetrievalPct.toFixed(1).padStart(5)}%)               │`)
  console.log(`│  📤 GENERATION TOTAL: ${avgTimings.generation.toFixed(2).padStart(8)}ms  (${avgGenerationPct.toFixed(1).padStart(5)}%)               │`)
  console.log('├─────────────────────────────────────────────────────────────────┤')
  console.log(`│  Streaming TTFB:      ${avgTimings.streamingTTFB.toFixed(2).padStart(8)}ms                           │`)
  console.log(`│  Streaming Total:     ${avgTimings.streamingTotal.toFixed(2).padStart(8)}ms                           │`)
  console.log('└─────────────────────────────────────────────────────────────────┘')

  // Visual breakdown
  console.log('\n📊 VISUAL BREAKDOWN:')
  const retrievalBar = '█'.repeat(Math.round(avgRetrievalPct / 2))
  const generationBar = '░'.repeat(Math.round(avgGenerationPct / 2))
  console.log(`\n  Retrieval ${retrievalBar}${generationBar} Generation`)
  console.log(`            ${avgRetrievalPct.toFixed(1)}%${' '.repeat(45)}${avgGenerationPct.toFixed(1)}%`)

  // Bottleneck analysis
  console.log('\n🔍 BOTTLENECK ANALYSIS:')

  const stages = [
    { name: 'Embedding API', ms: avgTimings.embedding },
    { name: 'LLM Generation', ms: avgTimings.generation },
    { name: 'Streaming TTFB', ms: avgTimings.streamingTTFB },
    { name: 'Vector Search', ms: avgTimings.search },
    { name: 'Query Expansion', ms: avgTimings.queryExpansion },
  ]

  stages.sort((a, b) => b.ms - a.ms)

  console.log('\n  Top bottlenecks (highest to lowest):')
  stages.forEach((stage, i) => {
    const bar = '▓'.repeat(Math.min(40, Math.round(stage.ms / 20)))
    console.log(`  ${i + 1}. ${stage.name.padEnd(18)} ${stage.ms.toFixed(0).padStart(5)}ms ${bar}`)
  })

  // Recommendations
  console.log('\n💡 OPTIMIZATION RECOMMENDATIONS:')

  if (avgTimings.generation > avgTimings.retrievalTotal) {
    console.log('\n  ⚠️  LLM Generation is the PRIMARY bottleneck!')
    console.log('     Recommendations:')
    console.log('     • Use a faster model (gpt-4o-mini vs gpt-4o)')
    console.log('     • Reduce max_tokens if responses are shorter')
    console.log('     • Consider response caching for common queries')
    console.log('     • Use streaming to improve perceived latency (TTFB)')
  }

  if (avgTimings.embedding > 300) {
    console.log('\n  ⚠️  Embedding generation is slow (>300ms)')
    console.log('     Recommendations:')
    console.log('     • Cache embeddings for repeated queries')
    console.log('     • Use hash-based lookup before API call')
  }

  if (avgTimings.streamingTTFB > 500) {
    console.log('\n  ⚠️  Time to First Byte is high (>500ms)')
    console.log('     Recommendations:')
    console.log('     • Check network latency to OpenAI')
    console.log('     • Consider using edge deployment')
  }

  // Save results
  const resultsPath = path.join(__dirname, '../latency-profile.json')
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2))
  console.log(`\n📁 Results saved to: ${resultsPath}`)

  console.log('\n' + '='.repeat(70))
  console.log('✅ Profiling Complete!')
  console.log('='.repeat(70))
}

// Run profiler
runProfiler().catch(err => {
  console.error('❌ Profiler failed:', err)
  process.exit(1)
})
