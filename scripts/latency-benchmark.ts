/**
 * Comprehensive Latency Benchmarking Script
 *
 * Measures performance across:
 * - Network connectivity & latency
 * - Embedding generation latency
 * - Vector retrieval latency
 * - LLM generation latency
 * - End-to-end RAG pipeline latency
 *
 * Run with: npx ts-node scripts/latency-benchmark.ts
 */

import * as path from 'path'
import * as fs from 'fs'
import { ProxyAgent, fetch as proxyFetch } from 'undici'

// Configure proxy if available
const HTTPS_PROXY = process.env.https_proxy || process.env.HTTPS_PROXY
let proxyAgent: ProxyAgent | undefined

if (HTTPS_PROXY) {
  proxyAgent = new ProxyAgent(HTTPS_PROXY)
  console.log(`Using proxy: ${HTTPS_PROXY.substring(0, 50)}...`)
}

// Custom fetch that uses proxy when available
async function fetchWithProxy(url: string, options: RequestInit = {}): Promise<Response> {
  if (proxyAgent) {
    return proxyFetch(url, { ...options, dispatcher: proxyAgent } as any) as Promise<Response>
  }
  return fetch(url, options)
}

// Try to load .env from multiple locations
const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../nextjs_space/.env'),
  path.resolve(__dirname, '../nextjs_space/.env.local'),
]

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=')
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim()
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value.replace(/^["']|["']$/g, '')
        }
      }
    })
    console.log(`Loaded env from: ${envPath}`)
    break
  }
}

// Configuration from environment
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const ABACUSAI_API_KEY = process.env.ABACUSAI_API_KEY || ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const USER_ID = process.env.TEST_USER_ID || '5f855b8f-d34d-44dd-96c5-ea2263a6939d'

// Benchmark configuration
const BENCHMARK_CONFIG = {
  warmupRuns: 2,
  testRuns: 5,
  embeddingModel: 'text-embedding-3-small',
  llmModel: 'gpt-4o-mini',
  topK: 20,
  minSimilarity: 0.25,
}

// Test queries for benchmarking
const TEST_QUERIES = [
  "What is the corporate tax rate in UAE?",
  "What are the exemptions under Federal Decree Law No. 60?",
  "How is taxable income calculated for businesses?",
  "What are the transfer pricing requirements?",
  "What penalties apply for non-compliance?",
]

interface LatencyResult {
  min: number
  max: number
  avg: number
  p50: number
  p95: number
  p99: number
  samples: number[]
}

interface NetworkBenchmark {
  endpoint: string
  dnsLookupMs: number
  tcpConnectMs: number
  tlsHandshakeMs: number
  totalLatencyMs: number
  httpStatus: number
  success: boolean
}

interface BenchmarkResults {
  timestamp: string
  config: typeof BENCHMARK_CONFIG
  network: {
    openai: NetworkBenchmark
    supabase: NetworkBenchmark
    abacusai: NetworkBenchmark
  }
  embedding: LatencyResult
  retrieval: LatencyResult
  generation: LatencyResult
  endToEnd: LatencyResult
  summary: {
    totalQueriesTested: number
    avgEndToEndMs: number
    avgEmbeddingMs: number
    avgRetrievalMs: number
    avgGenerationMs: number
    networkHealthy: boolean
  }
}

// Helper: Calculate latency statistics
function calculateLatencyStats(samples: number[]): LatencyResult {
  if (samples.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, samples: [] }
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1],
    p99: sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1],
    samples: sorted,
  }
}

// Helper: Measure network latency to endpoint
async function measureNetworkLatency(url: string, name: string): Promise<NetworkBenchmark> {
  const result: NetworkBenchmark = {
    endpoint: name,
    dnsLookupMs: 0,
    tcpConnectMs: 0,
    tlsHandshakeMs: 0,
    totalLatencyMs: 0,
    httpStatus: 0,
    success: false,
  }

  try {
    const startTime = performance.now()

    const response = await fetchWithProxy(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'LatencyBenchmark/1.0' },
    })

    result.totalLatencyMs = performance.now() - startTime
    result.httpStatus = response.status
    result.success = response.status >= 200 && response.status < 500

    // Estimate breakdown (actual values would need lower-level networking)
    result.tcpConnectMs = result.totalLatencyMs * 0.3
    result.tlsHandshakeMs = result.totalLatencyMs * 0.4
    result.dnsLookupMs = result.totalLatencyMs * 0.1

  } catch (error) {
    result.success = false
    result.totalLatencyMs = -1
  }

  return result
}

// Benchmark: Embedding generation
async function benchmarkEmbedding(text: string): Promise<number> {
  const start = performance.now()

  const response = await fetchWithProxy('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: BENCHMARK_CONFIG.embeddingModel,
      input: text.substring(0, 8000),
    }),
  })

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`)
  }

  await response.json()
  return performance.now() - start
}

// Benchmark: Vector retrieval from Supabase
async function benchmarkRetrieval(embedding: number[]): Promise<{ latency: number; chunks: any[] }> {
  const start = performance.now()

  const response = await fetchWithProxy(`${SUPABASE_URL}/rest/v1/rpc/semantic_search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
    },
    body: JSON.stringify({
      query_embedding: JSON.stringify(embedding),
      p_user_id: USER_ID,
      match_count: BENCHMARK_CONFIG.topK,
      min_similarity: BENCHMARK_CONFIG.minSimilarity,
    }),
  })

  const chunks = response.ok ? await response.json() : []
  return { latency: performance.now() - start, chunks }
}

// Benchmark: LLM generation
async function benchmarkGeneration(query: string, context: string): Promise<{ latency: number; response: string }> {
  const start = performance.now()

  const messages = [
    {
      role: 'system',
      content: 'You are a legal document assistant. Answer based on the provided context.'
    },
    {
      role: 'user',
      content: `Context:\n${context}\n\nQuestion: ${query}\n\nProvide a concise answer based on the context.`
    }
  ]

  const response = await fetchWithProxy('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: BENCHMARK_CONFIG.llmModel,
      messages,
      max_tokens: 500,
      temperature: 0,
    }),
  })

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`)
  }

  const data = await response.json()
  const answer = data?.choices?.[0]?.message?.content || ''

  return { latency: performance.now() - start, response: answer }
}

// Generate embedding for a query
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetchWithProxy('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: BENCHMARK_CONFIG.embeddingModel,
      input: text.substring(0, 8000),
    }),
  })

  const data = await response.json()
  return data?.data?.[0]?.embedding || []
}

// Print progress bar
function printProgress(current: number, total: number, label: string) {
  const width = 30
  const percent = current / total
  const filled = Math.round(width * percent)
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
  process.stdout.write(`\r  ${label}: [${bar}] ${current}/${total}`)
}

// Main benchmark function
async function runBenchmarks(): Promise<BenchmarkResults> {
  console.log('='.repeat(80))
  console.log('COMPREHENSIVE LATENCY BENCHMARK')
  console.log('='.repeat(80))
  console.log(`Started: ${new Date().toISOString()}`)
  console.log(`Warmup runs: ${BENCHMARK_CONFIG.warmupRuns}`)
  console.log(`Test runs: ${BENCHMARK_CONFIG.testRuns}`)
  console.log(`Test queries: ${TEST_QUERIES.length}`)
  console.log('')

  const results: BenchmarkResults = {
    timestamp: new Date().toISOString(),
    config: BENCHMARK_CONFIG,
    network: {
      openai: { endpoint: '', dnsLookupMs: 0, tcpConnectMs: 0, tlsHandshakeMs: 0, totalLatencyMs: 0, httpStatus: 0, success: false },
      supabase: { endpoint: '', dnsLookupMs: 0, tcpConnectMs: 0, tlsHandshakeMs: 0, totalLatencyMs: 0, httpStatus: 0, success: false },
      abacusai: { endpoint: '', dnsLookupMs: 0, tcpConnectMs: 0, tlsHandshakeMs: 0, totalLatencyMs: 0, httpStatus: 0, success: false },
    },
    embedding: { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, samples: [] },
    retrieval: { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, samples: [] },
    generation: { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, samples: [] },
    endToEnd: { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, samples: [] },
    summary: {
      totalQueriesTested: 0,
      avgEndToEndMs: 0,
      avgEmbeddingMs: 0,
      avgRetrievalMs: 0,
      avgGenerationMs: 0,
      networkHealthy: false,
    },
  }

  // ============================================
  // PHASE 1: Network Connectivity Check
  // ============================================
  console.log('PHASE 1: Network Connectivity Check')
  console.log('-'.repeat(40))

  console.log('  Testing OpenAI API...')
  results.network.openai = await measureNetworkLatency('https://api.openai.com/v1/models', 'OpenAI')
  console.log(`    Status: ${results.network.openai.success ? '✓ Connected' : '✗ Failed'} (${results.network.openai.totalLatencyMs.toFixed(0)}ms)`)

  console.log('  Testing Supabase...')
  results.network.supabase = await measureNetworkLatency(`${SUPABASE_URL}/rest/v1/`, 'Supabase')
  console.log(`    Status: ${results.network.supabase.success ? '✓ Connected' : '✗ Failed'} (${results.network.supabase.totalLatencyMs.toFixed(0)}ms)`)

  console.log('  Testing AbacusAI...')
  results.network.abacusai = await measureNetworkLatency('https://apps.abacus.ai/api/v0/', 'AbacusAI')
  console.log(`    Status: ${results.network.abacusai.success ? '✓ Connected' : '✗ Failed'} (${results.network.abacusai.totalLatencyMs.toFixed(0)}ms)`)

  const networkHealthy = results.network.openai.success && results.network.supabase.success
  results.summary.networkHealthy = networkHealthy

  if (!networkHealthy) {
    console.log('\n⚠️  Network connectivity issues detected. Benchmark may fail.')
  } else {
    console.log('\n✓ All network endpoints reachable')
  }

  // ============================================
  // PHASE 2: Warmup
  // ============================================
  console.log('\nPHASE 2: Warmup')
  console.log('-'.repeat(40))

  for (let i = 0; i < BENCHMARK_CONFIG.warmupRuns; i++) {
    process.stdout.write(`  Warmup run ${i + 1}/${BENCHMARK_CONFIG.warmupRuns}...`)
    try {
      const embedding = await generateEmbedding(TEST_QUERIES[0])
      await benchmarkRetrieval(embedding)
      console.log(' done')
    } catch (error) {
      console.log(' failed')
    }
    await new Promise(r => setTimeout(r, 500))
  }
  console.log('  Warmup complete')

  // ============================================
  // PHASE 3: Embedding Benchmark
  // ============================================
  console.log('\nPHASE 3: Embedding Latency Benchmark')
  console.log('-'.repeat(40))

  const embeddingLatencies: number[] = []
  const totalEmbeddingTests = TEST_QUERIES.length * BENCHMARK_CONFIG.testRuns
  let embeddingTestCount = 0

  for (const query of TEST_QUERIES) {
    for (let run = 0; run < BENCHMARK_CONFIG.testRuns; run++) {
      try {
        const latency = await benchmarkEmbedding(query)
        embeddingLatencies.push(latency)
        embeddingTestCount++
        printProgress(embeddingTestCount, totalEmbeddingTests, 'Embedding')
        await new Promise(r => setTimeout(r, 100))
      } catch (error) {
        console.log(`\n  Error: ${error}`)
      }
    }
  }
  console.log('')
  results.embedding = calculateLatencyStats(embeddingLatencies)
  console.log(`  Avg: ${results.embedding.avg.toFixed(0)}ms | P50: ${results.embedding.p50.toFixed(0)}ms | P95: ${results.embedding.p95.toFixed(0)}ms`)

  // ============================================
  // PHASE 4: Retrieval Benchmark
  // ============================================
  console.log('\nPHASE 4: Vector Retrieval Benchmark')
  console.log('-'.repeat(40))

  const retrievalLatencies: number[] = []
  const totalRetrievalTests = TEST_QUERIES.length * BENCHMARK_CONFIG.testRuns
  let retrievalTestCount = 0

  // Pre-generate embeddings
  const queryEmbeddings: Map<string, number[]> = new Map()
  for (const query of TEST_QUERIES) {
    queryEmbeddings.set(query, await generateEmbedding(query))
    await new Promise(r => setTimeout(r, 100))
  }

  for (const query of TEST_QUERIES) {
    const embedding = queryEmbeddings.get(query)!
    for (let run = 0; run < BENCHMARK_CONFIG.testRuns; run++) {
      try {
        const { latency } = await benchmarkRetrieval(embedding)
        retrievalLatencies.push(latency)
        retrievalTestCount++
        printProgress(retrievalTestCount, totalRetrievalTests, 'Retrieval')
        await new Promise(r => setTimeout(r, 50))
      } catch (error) {
        console.log(`\n  Error: ${error}`)
      }
    }
  }
  console.log('')
  results.retrieval = calculateLatencyStats(retrievalLatencies)
  console.log(`  Avg: ${results.retrieval.avg.toFixed(0)}ms | P50: ${results.retrieval.p50.toFixed(0)}ms | P95: ${results.retrieval.p95.toFixed(0)}ms`)

  // ============================================
  // PHASE 5: LLM Generation Benchmark
  // ============================================
  console.log('\nPHASE 5: LLM Generation Benchmark')
  console.log('-'.repeat(40))

  const generationLatencies: number[] = []
  const totalGenerationTests = TEST_QUERIES.length * BENCHMARK_CONFIG.testRuns
  let generationTestCount = 0

  // Sample context for generation tests
  const sampleContext = `
    The UAE Corporate Tax Law establishes a 9% tax rate on taxable income exceeding AED 375,000.
    Small businesses with revenue below AED 3 million may elect for simplified taxation.
    Transfer pricing rules require arm's length pricing for related party transactions.
  `.trim()

  for (const query of TEST_QUERIES) {
    for (let run = 0; run < BENCHMARK_CONFIG.testRuns; run++) {
      try {
        const { latency } = await benchmarkGeneration(query, sampleContext)
        generationLatencies.push(latency)
        generationTestCount++
        printProgress(generationTestCount, totalGenerationTests, 'Generation')
        await new Promise(r => setTimeout(r, 200))
      } catch (error) {
        console.log(`\n  Error: ${error}`)
      }
    }
  }
  console.log('')
  results.generation = calculateLatencyStats(generationLatencies)
  console.log(`  Avg: ${results.generation.avg.toFixed(0)}ms | P50: ${results.generation.p50.toFixed(0)}ms | P95: ${results.generation.p95.toFixed(0)}ms`)

  // ============================================
  // PHASE 6: End-to-End RAG Benchmark
  // ============================================
  console.log('\nPHASE 6: End-to-End RAG Benchmark')
  console.log('-'.repeat(40))

  const e2eLatencies: number[] = []
  const totalE2ETests = TEST_QUERIES.length * BENCHMARK_CONFIG.testRuns
  let e2eTestCount = 0

  for (const query of TEST_QUERIES) {
    for (let run = 0; run < BENCHMARK_CONFIG.testRuns; run++) {
      try {
        const e2eStart = performance.now()

        // Step 1: Generate embedding
        const embedding = await generateEmbedding(query)

        // Step 2: Retrieve chunks
        const { chunks } = await benchmarkRetrieval(embedding)
        const context = chunks.slice(0, 5).map((c: any) => c.content).join('\n\n---\n\n')

        // Step 3: Generate response
        await benchmarkGeneration(query, context || sampleContext)

        const e2eLatency = performance.now() - e2eStart
        e2eLatencies.push(e2eLatency)
        e2eTestCount++
        printProgress(e2eTestCount, totalE2ETests, 'E2E RAG')
        await new Promise(r => setTimeout(r, 300))
      } catch (error) {
        console.log(`\n  Error: ${error}`)
      }
    }
  }
  console.log('')
  results.endToEnd = calculateLatencyStats(e2eLatencies)
  console.log(`  Avg: ${results.endToEnd.avg.toFixed(0)}ms | P50: ${results.endToEnd.p50.toFixed(0)}ms | P95: ${results.endToEnd.p95.toFixed(0)}ms`)

  // ============================================
  // Summary
  // ============================================
  results.summary = {
    totalQueriesTested: TEST_QUERIES.length * BENCHMARK_CONFIG.testRuns,
    avgEndToEndMs: results.endToEnd.avg,
    avgEmbeddingMs: results.embedding.avg,
    avgRetrievalMs: results.retrieval.avg,
    avgGenerationMs: results.generation.avg,
    networkHealthy,
  }

  return results
}

// Network-only benchmark (when API keys missing)
async function runNetworkOnlyBenchmark(): Promise<void> {
  console.log('='.repeat(80))
  console.log('NETWORK CONNECTIVITY BENCHMARK')
  console.log('='.repeat(80))
  console.log(`Started: ${new Date().toISOString()}\n`)

  const endpoints = [
    { name: 'OpenAI API', url: 'https://api.openai.com/v1/models' },
    { name: 'Supabase', url: 'https://sjdaemlbjntadadggenr.supabase.co/rest/v1/' },
    { name: 'AbacusAI', url: 'https://apps.abacus.ai/api/v0/' },
    { name: 'Anthropic API', url: 'https://api.anthropic.com/' },
    { name: 'Google', url: 'https://www.google.com/' },
  ]

  console.log('Testing network endpoints...\n')

  const results: NetworkBenchmark[] = []

  for (const endpoint of endpoints) {
    process.stdout.write(`  ${endpoint.name.padEnd(20)}`)

    // Run multiple samples
    const samples: number[] = []
    for (let i = 0; i < 3; i++) {
      const result = await measureNetworkLatency(endpoint.url, endpoint.name)
      if (result.success && result.totalLatencyMs > 0) {
        samples.push(result.totalLatencyMs)
      }
      await new Promise(r => setTimeout(r, 100))
    }

    if (samples.length > 0) {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length
      console.log(`✓ ${avg.toFixed(0)}ms avg (${samples.length} samples)`)
      results.push({
        endpoint: endpoint.name,
        dnsLookupMs: 0,
        tcpConnectMs: 0,
        tlsHandshakeMs: 0,
        totalLatencyMs: avg,
        httpStatus: 200,
        success: true,
      })
    } else {
      console.log('✗ Failed')
      results.push({
        endpoint: endpoint.name,
        dnsLookupMs: 0,
        tcpConnectMs: 0,
        tlsHandshakeMs: 0,
        totalLatencyMs: -1,
        httpStatus: 0,
        success: false,
      })
    }
  }

  // Summary
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  console.log('\n' + '='.repeat(80))
  console.log('SUMMARY')
  console.log('='.repeat(80))
  console.log(`Endpoints tested: ${results.length}`)
  console.log(`Successful: ${successful.length}`)
  console.log(`Failed: ${failed.length}`)

  if (successful.length > 0) {
    const avgLatency = successful.reduce((sum, r) => sum + r.totalLatencyMs, 0) / successful.length
    console.log(`Average latency: ${avgLatency.toFixed(0)}ms`)
  }

  console.log('\nNETWORK STATUS: ' + (failed.length === 0 ? '✓ All endpoints reachable' : '⚠ Some endpoints unreachable'))
  console.log('\n' + '='.repeat(80))
}

// Print final report
function printReport(results: BenchmarkResults) {
  console.log('\n' + '='.repeat(80))
  console.log('BENCHMARK RESULTS')
  console.log('='.repeat(80))

  console.log('\nNETWORK LATENCY:')
  console.log(`  OpenAI:    ${results.network.openai.totalLatencyMs.toFixed(0)}ms ${results.network.openai.success ? '✓' : '✗'}`)
  console.log(`  Supabase:  ${results.network.supabase.totalLatencyMs.toFixed(0)}ms ${results.network.supabase.success ? '✓' : '✗'}`)
  console.log(`  AbacusAI:  ${results.network.abacusai.totalLatencyMs.toFixed(0)}ms ${results.network.abacusai.success ? '✓' : '✗'}`)

  console.log('\nCOMPONENT LATENCIES:')
  console.log('┌─────────────────┬─────────┬─────────┬─────────┬─────────┬─────────┐')
  console.log('│ Component       │   Min   │   Avg   │   P50   │   P95   │   Max   │')
  console.log('├─────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤')
  console.log(`│ Embedding       │ ${results.embedding.min.toFixed(0).padStart(5)}ms │ ${results.embedding.avg.toFixed(0).padStart(5)}ms │ ${results.embedding.p50.toFixed(0).padStart(5)}ms │ ${results.embedding.p95.toFixed(0).padStart(5)}ms │ ${results.embedding.max.toFixed(0).padStart(5)}ms │`)
  console.log(`│ Retrieval       │ ${results.retrieval.min.toFixed(0).padStart(5)}ms │ ${results.retrieval.avg.toFixed(0).padStart(5)}ms │ ${results.retrieval.p50.toFixed(0).padStart(5)}ms │ ${results.retrieval.p95.toFixed(0).padStart(5)}ms │ ${results.retrieval.max.toFixed(0).padStart(5)}ms │`)
  console.log(`│ LLM Generation  │ ${results.generation.min.toFixed(0).padStart(5)}ms │ ${results.generation.avg.toFixed(0).padStart(5)}ms │ ${results.generation.p50.toFixed(0).padStart(5)}ms │ ${results.generation.p95.toFixed(0).padStart(5)}ms │ ${results.generation.max.toFixed(0).padStart(5)}ms │`)
  console.log('├─────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┤')
  console.log(`│ E2E RAG         │ ${results.endToEnd.min.toFixed(0).padStart(5)}ms │ ${results.endToEnd.avg.toFixed(0).padStart(5)}ms │ ${results.endToEnd.p50.toFixed(0).padStart(5)}ms │ ${results.endToEnd.p95.toFixed(0).padStart(5)}ms │ ${results.endToEnd.max.toFixed(0).padStart(5)}ms │`)
  console.log('└─────────────────┴─────────┴─────────┴─────────┴─────────┴─────────┘')

  console.log('\nLATENCY BREAKDOWN (% of E2E):')
  const e2eAvg = results.endToEnd.avg
  console.log(`  Embedding:   ${((results.embedding.avg / e2eAvg) * 100).toFixed(1)}%`)
  console.log(`  Retrieval:   ${((results.retrieval.avg / e2eAvg) * 100).toFixed(1)}%`)
  console.log(`  Generation:  ${((results.generation.avg / e2eAvg) * 100).toFixed(1)}%`)
  console.log(`  Overhead:    ${((1 - (results.embedding.avg + results.retrieval.avg + results.generation.avg) / e2eAvg) * 100).toFixed(1)}%`)

  console.log('\nPERFORMANCE ASSESSMENT:')

  if (results.endToEnd.avg < 2000) {
    console.log('  ✓ E2E latency is GOOD (<2s)')
  } else if (results.endToEnd.avg < 4000) {
    console.log('  ⚠ E2E latency is ACCEPTABLE (2-4s)')
  } else {
    console.log('  ✗ E2E latency is SLOW (>4s) - optimization needed')
  }

  if (results.retrieval.avg < 500) {
    console.log('  ✓ Retrieval is FAST (<500ms)')
  } else if (results.retrieval.avg < 1000) {
    console.log('  ⚠ Retrieval is ACCEPTABLE (500-1000ms)')
  } else {
    console.log('  ✗ Retrieval is SLOW (>1s) - consider caching or index optimization')
  }

  if (results.generation.avg < 2000) {
    console.log('  ✓ LLM generation is FAST (<2s)')
  } else {
    console.log('  ⚠ LLM generation is SLOW - consider smaller model or streaming')
  }

  console.log('\nOPTIMIZATION RECOMMENDATIONS:')

  const bottleneck = [
    { name: 'Embedding', value: results.embedding.avg },
    { name: 'Retrieval', value: results.retrieval.avg },
    { name: 'Generation', value: results.generation.avg },
  ].sort((a, b) => b.value - a.value)[0]

  console.log(`  Primary bottleneck: ${bottleneck.name} (${bottleneck.value.toFixed(0)}ms avg)`)

  if (bottleneck.name === 'Generation') {
    console.log('  - Consider using streaming for perceived latency improvement')
    console.log('  - Try gpt-4o-mini for faster responses')
    console.log('  - Reduce max_tokens if full responses not needed')
  } else if (bottleneck.name === 'Retrieval') {
    console.log('  - Add caching layer for frequent queries')
    console.log('  - Optimize pgvector index (ivfflat -> hnsw)')
    console.log('  - Consider dedicated vector DB (Qdrant, Pinecone)')
  } else {
    console.log('  - Cache embeddings for common queries')
    console.log('  - Consider local embedding model for lower latency')
  }

  console.log('\n' + '='.repeat(80))
  console.log('Benchmark completed at:', new Date().toISOString())
  console.log('='.repeat(80))
}

// Main execution
async function main() {
  try {
    // Check for required environment variables
    const missingVars: string[] = []
    if (!OPENAI_API_KEY) missingVars.push('OPENAI_API_KEY')
    if (!SUPABASE_URL) missingVars.push('NEXT_PUBLIC_SUPABASE_URL')
    if (!SUPABASE_KEY) missingVars.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')

    if (missingVars.length > 0) {
      console.log('\n' + '='.repeat(80))
      console.log('ENVIRONMENT CONFIGURATION')
      console.log('='.repeat(80))
      console.log(`\nMissing environment variables: ${missingVars.join(', ')}`)
      console.log('\nTo run the full benchmark, set the following in .env:')
      console.log('  OPENAI_API_KEY=your-openai-key')
      console.log('  NEXT_PUBLIC_SUPABASE_URL=your-supabase-url')
      console.log('  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-key')
      console.log('\nRunning network connectivity test only...\n')

      // Run network test only
      const results = await runNetworkOnlyBenchmark()
      return
    }

    const results = await runBenchmarks()
    printReport(results)

    // Save results to file
    const resultsPath = path.resolve(__dirname, '../benchmark-results.json')
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2))
    console.log(`\nResults saved to: ${resultsPath}`)

  } catch (error) {
    console.error('Benchmark failed:', error)
    process.exit(1)
  }
}

main()
