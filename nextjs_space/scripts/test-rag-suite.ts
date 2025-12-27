/**
 * Comprehensive RAG Test Suite
 * Tests multiple queries in parallel and measures metrics
 */

interface TestQuery {
  id: string
  query: string
  expectedKeywords: string[] // Keywords expected in good results
  category: 'article' | 'concept' | 'general'
}

interface TestResult {
  queryId: string
  query: string
  success: boolean
  metrics: {
    totalTimeMs: number
    embeddingTimeMs: number
    searchTimeMs: number
    llmTimeMs: number
    chunksRetrieved: number
    relevantChunks: number // Chunks containing expected keywords
    hasReferences: boolean
  }
  topSources: string[]
  error?: string
}

const TEST_QUERIES: TestQuery[] = [
  {
    id: 'Q1',
    query: 'What is Article 50 of UAE CT Law?',
    expectedKeywords: ['Article 50', 'anti-abuse', 'General Anti-abuse Rule'],
    category: 'article'
  },
  {
    id: 'Q2',
    query: 'What are GAAR provisions under UAE CT Law?',
    expectedKeywords: ['GAAR', 'General Anti-abuse', 'Article 50'],
    category: 'concept'
  },
  {
    id: 'Q3',
    query: 'What is the corporate tax rate in UAE?',
    expectedKeywords: ['9%', 'tax rate', '375,000', 'AED'],
    category: 'general'
  },
  {
    id: 'Q4',
    query: 'Explain Article 14 permanent establishment rules',
    expectedKeywords: ['Article 14', 'permanent establishment', 'Non-Resident'],
    category: 'article'
  },
  {
    id: 'Q5',
    query: 'What are the transfer pricing rules under UAE CT?',
    expectedKeywords: ['transfer pricing', 'arm\'s length', 'Related Party'],
    category: 'concept'
  },
  {
    id: 'Q6',
    query: 'What is withholding tax under Federal Decree Law 47?',
    expectedKeywords: ['withholding', 'Withholding Tax', 'Article 45'],
    category: 'concept'
  },
  {
    id: 'Q7',
    query: 'What are Free Zone benefits for corporate tax?',
    expectedKeywords: ['Free Zone', 'Qualifying Income', '0%'],
    category: 'general'
  },
  {
    id: 'Q8',
    query: 'Can you find Article 50 in Federal Decree Law 47 of 2022?',
    expectedKeywords: ['Federal Decree-Law No. 47', 'Article 50', 'anti-abuse'],
    category: 'article'
  }
]

async function runTest(baseUrl: string, sessionId: string, testQuery: TestQuery): Promise<TestResult> {
  const startTime = Date.now()

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatSessionId: sessionId,
        message: testQuery.query,
        model: 'gpt-4o-mini'
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    // Read streaming response
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    let fullResponse = ''
    let sources: any[] = []
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            if (data.sources) {
              sources = data.sources
            } else if (data.choices?.[0]?.delta?.content) {
              fullResponse += data.choices[0].delta.content
            }
          } catch {}
        }
      }
    }

    const totalTime = Date.now() - startTime

    // Check if results contain expected keywords
    const relevantChunks = sources.filter(s =>
      testQuery.expectedKeywords.some(kw =>
        s.content?.toLowerCase().includes(kw.toLowerCase()) ||
        s.fileName?.toLowerCase().includes(kw.toLowerCase())
      )
    ).length

    return {
      queryId: testQuery.id,
      query: testQuery.query,
      success: relevantChunks > 0 || sources.length > 0,
      metrics: {
        totalTimeMs: totalTime,
        embeddingTimeMs: 0, // Would need server logs
        searchTimeMs: 0,
        llmTimeMs: 0,
        chunksRetrieved: sources.length,
        relevantChunks,
        hasReferences: sources.length > 0
      },
      topSources: sources.slice(0, 3).map(s => s.fileName || 'Unknown')
    }

  } catch (error) {
    return {
      queryId: testQuery.id,
      query: testQuery.query,
      success: false,
      metrics: {
        totalTimeMs: Date.now() - startTime,
        embeddingTimeMs: 0,
        searchTimeMs: 0,
        llmTimeMs: 0,
        chunksRetrieved: 0,
        relevantChunks: 0,
        hasReferences: false
      },
      topSources: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function createTestSession(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/chat-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `RAG Test ${new Date().toISOString()}` })
  })

  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`)
  }

  const data = await response.json()
  return data.id
}

async function main() {
  const baseUrl = process.env.TEST_URL || 'http://localhost:3000'

  console.log('=' .repeat(80))
  console.log('RAG TEST SUITE - Comprehensive Retrieval Quality Analysis')
  console.log('=' .repeat(80))
  console.log(`Base URL: ${baseUrl}`)
  console.log(`Queries: ${TEST_QUERIES.length}`)
  console.log('')

  // Run tests in parallel (batches of 4)
  const batchSize = 4
  const results: TestResult[] = []

  for (let i = 0; i < TEST_QUERIES.length; i += batchSize) {
    const batch = TEST_QUERIES.slice(i, i + batchSize)
    console.log(`Running batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(TEST_QUERIES.length/batchSize)}...`)

    const batchPromises = batch.map(async (q) => {
      // Each query gets its own session to avoid context mixing
      try {
        const sessionId = await createTestSession(baseUrl)
        return runTest(baseUrl, sessionId, q)
      } catch (e) {
        return {
          queryId: q.id,
          query: q.query,
          success: false,
          metrics: { totalTimeMs: 0, embeddingTimeMs: 0, searchTimeMs: 0, llmTimeMs: 0, chunksRetrieved: 0, relevantChunks: 0, hasReferences: false },
          topSources: [],
          error: e instanceof Error ? e.message : String(e)
        } as TestResult
      }
    })

    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)
  }

  // Print results
  console.log('\n' + '=' .repeat(80))
  console.log('RESULTS')
  console.log('=' .repeat(80))

  for (const r of results) {
    const status = r.success ? '✅' : '❌'
    console.log(`\n${status} ${r.queryId}: ${r.query.substring(0, 50)}...`)
    console.log(`   Time: ${r.metrics.totalTimeMs}ms | Chunks: ${r.metrics.chunksRetrieved} | Relevant: ${r.metrics.relevantChunks}`)
    if (r.topSources.length > 0) {
      console.log(`   Sources: ${r.topSources.join(', ')}`)
    }
    if (r.error) {
      console.log(`   Error: ${r.error}`)
    }
  }

  // Summary metrics
  const successCount = results.filter(r => r.success).length
  const avgTime = results.reduce((sum, r) => sum + r.metrics.totalTimeMs, 0) / results.length
  const avgChunks = results.reduce((sum, r) => sum + r.metrics.chunksRetrieved, 0) / results.length
  const avgRelevant = results.reduce((sum, r) => sum + r.metrics.relevantChunks, 0) / results.length
  const withRefs = results.filter(r => r.metrics.hasReferences).length

  console.log('\n' + '=' .repeat(80))
  console.log('SUMMARY')
  console.log('=' .repeat(80))
  console.log(`Success Rate:     ${successCount}/${results.length} (${(successCount/results.length*100).toFixed(1)}%)`)
  console.log(`With References:  ${withRefs}/${results.length} (${(withRefs/results.length*100).toFixed(1)}%)`)
  console.log(`Avg Response Time: ${avgTime.toFixed(0)}ms`)
  console.log(`Avg Chunks/Query: ${avgChunks.toFixed(1)}`)
  console.log(`Avg Relevant:     ${avgRelevant.toFixed(1)}`)
  console.log('')

  // Category breakdown
  const categories = ['article', 'concept', 'general'] as const
  for (const cat of categories) {
    const catResults = results.filter(r =>
      TEST_QUERIES.find(q => q.id === r.queryId)?.category === cat
    )
    const catSuccess = catResults.filter(r => r.success).length
    console.log(`${cat.padEnd(10)}: ${catSuccess}/${catResults.length} success`)
  }
}

main().catch(console.error)
