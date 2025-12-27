/**
 * Comprehensive RAG Pipeline Benchmark
 *
 * Compares 4 configurations:
 * 1. OpenAI Embeddings + Hybrid Search (current production)
 * 2. OpenAI Embeddings + Semantic-only Search
 * 3. Local Embeddings + Hybrid Search
 * 4. Local Embeddings + Semantic-only Search (fastest)
 *
 * Uses local Postgres with pgvector for accurate DB timing
 */

import { Pool } from 'pg'
import { generateLocalEmbedding, preloadEmbeddingModel } from '../lib/local-embeddings'

// Database connection (local Docker)
const LOCAL_DB_URL = 'postgresql://postgres:postgres@localhost:5433/rag_test'

// OpenAI API (for comparison - may fail if key expired)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

// Sample legal documents for testing
const SAMPLE_DOCUMENTS = [
  {
    fileName: 'UAE_Corporate_Tax_Guide.pdf',
    chunks: [
      { content: 'The standard corporate tax rate in the UAE is 9% for taxable income exceeding AED 375,000. Small businesses and startups with income below this threshold are exempt from corporate tax. The tax applies to all business activities conducted in the UAE, including mainland and free zone companies.', pageNumber: 1 },
      { content: 'Free Zone Companies may be eligible for a 0% corporate tax rate on qualifying income. This includes income from transactions with other free zone entities and income from certain foreign source activities. To qualify, companies must maintain adequate substance in the UAE.', pageNumber: 5 },
      { content: 'Small Business Relief is available for businesses with revenue not exceeding AED 3 million. This relief simplifies tax compliance requirements and may be renewed annually. Eligible businesses can elect this relief during the first few years of operation.', pageNumber: 12 },
      { content: 'Transfer Pricing Rules require related party transactions to be conducted at arm\'s length prices. Documentation requirements apply for transactions exceeding AED 200 million. The UAE follows OECD transfer pricing guidelines for multinational enterprises.', pageNumber: 18 },
    ]
  },
  {
    fileName: 'Tax_Compliance_Manual.pdf',
    chunks: [
      { content: 'Tax Registration is mandatory for all taxable entities. Businesses must register with the Federal Tax Authority (FTA) within the prescribed timeframe. Late registration penalties range from AED 10,000 to AED 20,000 depending on the delay period.', pageNumber: 3 },
      { content: 'Tax Returns must be filed within 9 months of the end of the relevant tax period. Electronic filing through the FTA portal is mandatory. Late filing penalties apply at AED 500 for the first month and AED 1,000 for each subsequent month.', pageNumber: 7 },
      { content: 'Tax Payments are due by the return filing deadline. Payment methods include bank transfer, credit card, and e-Dirham. Late payment attracts a penalty of 14% per annum on the outstanding tax amount.', pageNumber: 11 },
      { content: 'Record Keeping requirements mandate businesses to maintain financial records for at least 7 years. Records must be kept in Arabic or English and be available for inspection by the FTA upon request.', pageNumber: 15 },
    ]
  },
  {
    fileName: 'VAT_Guidelines.pdf',
    chunks: [
      { content: 'Value Added Tax (VAT) in the UAE is levied at a standard rate of 5%. Certain supplies are zero-rated including exports, international transportation, and supplies of certain sea, air, and land means of transport.', pageNumber: 2 },
      { content: 'VAT Registration is required for businesses with taxable supplies exceeding AED 375,000 annually. Voluntary registration is available for businesses with supplies or expenses exceeding AED 187,500.', pageNumber: 6 },
      { content: 'Input Tax Recovery allows registered businesses to claim back VAT paid on business expenses. Proper tax invoices must be obtained and retained to support input tax claims.', pageNumber: 10 },
    ]
  }
]

// Test queries
const TEST_QUERIES = [
  'What is the corporate tax rate in UAE?',
  'How do free zone companies pay taxes?',
  'What are the penalties for late filing?',
  'Tell me about transfer pricing requirements',
  'When must businesses register for tax?',
  'What is the VAT rate?',
  'How long must records be kept?',
  'What is small business relief?',
]

interface BenchmarkResult {
  config: string
  embeddingType: 'openai' | 'local'
  searchType: 'semantic' | 'hybrid'

  // Timing metrics (all in ms)
  avgEmbeddingTime: number
  avgSearchTime: number
  avgTotalTime: number

  // Quality metrics
  avgTopScore: number
  avgResultCount: number

  // Individual query results
  queryResults: Array<{
    query: string
    embeddingTime: number
    searchTime: number
    totalTime: number
    topScore: number
    resultCount: number
  }>
}

async function generateOpenAIEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null

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

    if (!response.ok) return null
    const data = await response.json()
    return data.data[0].embedding
  } catch {
    return null
  }
}

async function indexDocuments(pool: Pool) {
  console.log('\n📚 Indexing documents...')

  // Clear existing data
  await pool.query('TRUNCATE test_chunks CASCADE')
  await pool.query('TRUNCATE test_documents CASCADE')

  let totalChunks = 0
  const indexingTimes: { local: number[], openai: number[] } = { local: [], openai: [] }

  for (const doc of SAMPLE_DOCUMENTS) {
    // Insert document
    const docResult = await pool.query(
      'INSERT INTO test_documents (file_name) VALUES ($1) RETURNING id',
      [doc.fileName]
    )
    const docId = docResult.rows[0].id

    for (const chunk of doc.chunks) {
      // Generate local embedding
      const localStart = Date.now()
      const localEmbedding = await generateLocalEmbedding(chunk.content)
      indexingTimes.local.push(Date.now() - localStart)

      // Generate OpenAI embedding (if available)
      let openaiEmbedding: number[] | null = null
      const openaiStart = Date.now()
      openaiEmbedding = await generateOpenAIEmbedding(chunk.content)
      if (openaiEmbedding) {
        indexingTimes.openai.push(Date.now() - openaiStart)
      }

      // Generate tsvector for keyword search
      const contentTokens = chunk.content.toLowerCase()

      // Insert chunk with both embeddings
      await pool.query(
        `INSERT INTO test_chunks
         (document_id, content, page_number, embedding_local, embedding_openai, content_tokens)
         VALUES ($1, $2, $3, $4, $5, to_tsvector('english', $6))`,
        [
          docId,
          chunk.content,
          chunk.pageNumber,
          `[${localEmbedding.join(',')}]`,
          openaiEmbedding ? `[${openaiEmbedding.join(',')}]` : null,
          contentTokens,
        ]
      )

      totalChunks++
      process.stdout.write(`\r   Indexed ${totalChunks} chunks...`)
    }
  }

  const avgLocal = indexingTimes.local.reduce((a, b) => a + b, 0) / indexingTimes.local.length
  const avgOpenai = indexingTimes.openai.length > 0
    ? indexingTimes.openai.reduce((a, b) => a + b, 0) / indexingTimes.openai.length
    : null

  console.log(`\n   ✅ Indexed ${totalChunks} chunks`)
  console.log(`   Local embedding avg: ${avgLocal.toFixed(0)}ms`)
  if (avgOpenai) {
    console.log(`   OpenAI embedding avg: ${avgOpenai.toFixed(0)}ms`)
  } else {
    console.log(`   OpenAI embedding: N/A (API unavailable)`)
  }
}

async function runBenchmark(
  pool: Pool,
  embeddingType: 'local' | 'openai',
  searchType: 'semantic' | 'hybrid'
): Promise<BenchmarkResult> {
  const config = `${embeddingType === 'local' ? 'Local' : 'OpenAI'} + ${searchType === 'semantic' ? 'Semantic' : 'Hybrid'}`
  console.log(`\n🔬 Testing: ${config}`)

  const queryResults: BenchmarkResult['queryResults'] = []

  for (const query of TEST_QUERIES) {
    // Generate embedding
    const embStart = Date.now()
    let embedding: number[]

    if (embeddingType === 'local') {
      embedding = await generateLocalEmbedding(query)
    } else {
      const openaiEmb = await generateOpenAIEmbedding(query)
      if (!openaiEmb) {
        console.log(`   Skipping OpenAI test (API unavailable)`)
        return {
          config,
          embeddingType,
          searchType,
          avgEmbeddingTime: 0,
          avgSearchTime: 0,
          avgTotalTime: 0,
          avgTopScore: 0,
          avgResultCount: 0,
          queryResults: [],
        }
      }
      embedding = openaiEmb
    }
    const embTime = Date.now() - embStart

    // Run search
    const searchStart = Date.now()
    let results: any[]

    if (searchType === 'semantic') {
      const funcName = embeddingType === 'local' ? 'search_semantic_local' : 'search_semantic_openai'
      const res = await pool.query(
        `SELECT * FROM ${funcName}($1, 5)`,
        [`[${embedding.join(',')}]`]
      )
      results = res.rows
    } else {
      // Hybrid search (only for local embeddings in this test)
      const res = await pool.query(
        `SELECT * FROM search_hybrid_local($1, $2, 5)`,
        [`[${embedding.join(',')}]`, query]
      )
      results = res.rows
    }
    const searchTime = Date.now() - searchStart

    queryResults.push({
      query,
      embeddingTime: embTime,
      searchTime,
      totalTime: embTime + searchTime,
      topScore: results[0]?.similarity || results[0]?.rrf_score || 0,
      resultCount: results.length,
    })

    process.stdout.write('.')
  }

  console.log(' Done')

  // Calculate averages
  const avgEmbeddingTime = queryResults.reduce((a, b) => a + b.embeddingTime, 0) / queryResults.length
  const avgSearchTime = queryResults.reduce((a, b) => a + b.searchTime, 0) / queryResults.length
  const avgTotalTime = queryResults.reduce((a, b) => a + b.totalTime, 0) / queryResults.length
  const avgTopScore = queryResults.reduce((a, b) => a + b.topScore, 0) / queryResults.length
  const avgResultCount = queryResults.reduce((a, b) => a + b.resultCount, 0) / queryResults.length

  return {
    config,
    embeddingType,
    searchType,
    avgEmbeddingTime,
    avgSearchTime,
    avgTotalTime,
    avgTopScore,
    avgResultCount,
    queryResults,
  }
}

function printResults(results: BenchmarkResult[]) {
  console.log('\n' + '═'.repeat(80))
  console.log('📊 BENCHMARK RESULTS')
  console.log('═'.repeat(80))

  // Summary table
  console.log('\n┌─────────────────────────────────┬────────────┬────────────┬────────────┬──────────┐')
  console.log('│ Configuration                   │ Embedding  │ Search     │ Total      │ Quality  │')
  console.log('├─────────────────────────────────┼────────────┼────────────┼────────────┼──────────┤')

  for (const r of results) {
    if (r.queryResults.length === 0) continue
    const name = r.config.padEnd(31)
    const emb = `${r.avgEmbeddingTime.toFixed(0)}ms`.padStart(8)
    const search = `${r.avgSearchTime.toFixed(0)}ms`.padStart(8)
    const total = `${r.avgTotalTime.toFixed(0)}ms`.padStart(8)
    const quality = `${(r.avgTopScore * 100).toFixed(1)}%`.padStart(6)
    console.log(`│ ${name} │ ${emb}   │ ${search}   │ ${total}   │ ${quality}   │`)
  }

  console.log('└─────────────────────────────────┴────────────┴────────────┴────────────┴──────────┘')

  // Find best config
  const validResults = results.filter(r => r.queryResults.length > 0)
  if (validResults.length > 0) {
    const fastest = validResults.reduce((a, b) => a.avgTotalTime < b.avgTotalTime ? a : b)
    const slowest = validResults.reduce((a, b) => a.avgTotalTime > b.avgTotalTime ? a : b)

    console.log('\n⚡ SPEEDUP ANALYSIS:')
    console.log(`   Fastest: ${fastest.config} (${fastest.avgTotalTime.toFixed(0)}ms)`)
    console.log(`   Slowest: ${slowest.config} (${slowest.avgTotalTime.toFixed(0)}ms)`)
    console.log(`   Speedup: ${(slowest.avgTotalTime / fastest.avgTotalTime).toFixed(1)}x faster`)
    console.log(`   Time saved: ${(slowest.avgTotalTime - fastest.avgTotalTime).toFixed(0)}ms per query`)
  }

  // Detailed breakdown
  console.log('\n' + '─'.repeat(80))
  console.log('📋 DETAILED QUERY RESULTS')
  console.log('─'.repeat(80))

  for (const r of validResults) {
    console.log(`\n${r.config}:`)
    for (const q of r.queryResults.slice(0, 3)) { // Show first 3 queries
      console.log(`   "${q.query.substring(0, 35)}..." → ${q.totalTime}ms (emb: ${q.embeddingTime}ms, search: ${q.searchTime}ms)`)
    }
  }
}

async function main() {
  console.log('🚀 RAG PIPELINE BENCHMARK')
  console.log('═'.repeat(80))
  console.log('Testing 4 configurations against local Postgres + pgvector')
  console.log('')

  // Preload local model
  console.log('📦 Loading local embedding model...')
  await preloadEmbeddingModel()

  // Connect to local database
  console.log('🔌 Connecting to local Postgres...')
  const pool = new Pool({ connectionString: LOCAL_DB_URL })

  try {
    // Test connection
    await pool.query('SELECT 1')
    console.log('   ✅ Connected to local Postgres')

    // Index documents
    await indexDocuments(pool)

    // Run benchmarks
    const results: BenchmarkResult[] = []

    // 1. Local + Semantic (expected fastest)
    results.push(await runBenchmark(pool, 'local', 'semantic'))

    // 2. Local + Hybrid
    results.push(await runBenchmark(pool, 'local', 'hybrid'))

    // 3. OpenAI + Semantic (if API available)
    results.push(await runBenchmark(pool, 'openai', 'semantic'))

    // 4. OpenAI + Hybrid would need OpenAI embeddings in hybrid search
    // Skipping as hybrid function uses local embeddings

    // Print results
    printResults(results)

    // Compare with production estimates
    console.log('\n' + '═'.repeat(80))
    console.log('📈 PRODUCTION IMPACT ESTIMATE')
    console.log('═'.repeat(80))

    const localSemantic = results.find(r => r.embeddingType === 'local' && r.searchType === 'semantic')
    if (localSemantic && localSemantic.queryResults.length > 0) {
      const currentRag = 3900 + 2600 // Current: OpenAI embedding + hybrid search
      const optimizedRag = localSemantic.avgTotalTime

      console.log(`\nRAG Pipeline Comparison:`)
      console.log(`   Current (OpenAI + Hybrid):     ~${currentRag}ms`)
      console.log(`   Optimized (Local + Semantic):  ~${optimizedRag.toFixed(0)}ms`)
      console.log(`   Improvement:                   ${(currentRag / optimizedRag).toFixed(0)}x faster`)
      console.log(`   Time saved per query:          ${(currentRag - optimizedRag).toFixed(0)}ms`)

      console.log(`\nProjected TTFT Impact:`)
      console.log(`   Current TTFT:     ~10,000ms`)
      console.log(`   Projected TTFT:   ~${10000 - currentRag + optimizedRag}ms`)
      console.log(`   User experience:  ${((currentRag - optimizedRag) / 1000).toFixed(1)}s faster response`)
    }

  } finally {
    await pool.end()
  }
}

main().catch(console.error)
