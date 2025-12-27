/**
 * Latency Testing Script for Legal AI Assistant
 *
 * Tests the /api/test/latency endpoint which handles auth internally
 */

const BASE_URL = process.env.API_URL || 'https://taxsavant.netlify.app'
const API_KEY = process.env.TEST_API_KEY || 'latency-test-key-2024'

interface LatencyTestResult {
  success: boolean
  error?: string
  testId: string
  timestamp: string
  authTimeMs: number
  sessionTimeMs: number
  sessionId: string
  ttftMs: number
  streamDurationMs: number
  totalLlmTimeMs: number
  tokenCount: number
  tokensPerSecond: number
  responseCharCount: number
  sourceCount: number
  totalRequestTimeMs: number
  query: string
  model: string
}

async function runLatencyTest(query: string, model: string = 'gpt-4o-mini'): Promise<LatencyTestResult> {
  console.log(`\n📤 Testing: "${query.substring(0, 50)}..."`)

  const response = await fetch(`${BASE_URL}/api/test/latency`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify({ query, model }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API error ${response.status}: ${error}`)
  }

  return response.json()
}

function printReport(results: LatencyTestResult[]) {
  console.log('\n' + '='.repeat(80))
  console.log('📊 LATENCY TEST REPORT')
  console.log('='.repeat(80))
  console.log(`Target: ${BASE_URL}`)
  console.log(`Tests:  ${results.length}`)
  console.log('')

  // Individual results
  console.log('📋 Individual Results:')
  console.log('-'.repeat(80))

  results.forEach((r, i) => {
    console.log(`\n[${i + 1}] ${r.query.substring(0, 40)}...`)
    if (r.success) {
      console.log(`    ⚡ TTFT:          ${r.ttftMs}ms`)
      console.log(`    🔄 Stream:        ${r.streamDurationMs}ms`)
      console.log(`    ⏱️  Total LLM:     ${r.totalLlmTimeMs}ms`)
      console.log(`    🎯 Total Request: ${r.totalRequestTimeMs}ms`)
      console.log(`    📊 Tokens:        ${r.tokenCount} (${r.tokensPerSecond?.toFixed(1)} tok/s)`)
      console.log(`    📚 Sources:       ${r.sourceCount}`)
    } else {
      console.log(`    ❌ Error: ${r.error}`)
    }
  })

  // Aggregate stats
  const successful = results.filter(r => r.success)
  if (successful.length === 0) {
    console.log('\n❌ No successful tests to analyze')
    return
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
  const min = (arr: number[]) => Math.min(...arr)
  const max = (arr: number[]) => Math.max(...arr)
  const p50 = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  const ttfts = successful.map(r => r.ttftMs)
  const totals = successful.map(r => r.totalRequestTimeMs)
  const llmTotals = successful.map(r => r.totalLlmTimeMs)

  console.log('\n' + '='.repeat(80))
  console.log('📈 AGGREGATE STATISTICS')
  console.log('='.repeat(80))

  console.log('\n⚡ Time To First Token (TTFT):')
  console.log(`   Min:  ${min(ttfts)}ms`)
  console.log(`   Avg:  ${avg(ttfts).toFixed(0)}ms`)
  console.log(`   P50:  ${p50(ttfts)}ms`)
  console.log(`   Max:  ${max(ttfts)}ms`)

  console.log('\n🤖 Total LLM Time:')
  console.log(`   Min:  ${min(llmTotals)}ms`)
  console.log(`   Avg:  ${avg(llmTotals).toFixed(0)}ms`)
  console.log(`   P50:  ${p50(llmTotals)}ms`)
  console.log(`   Max:  ${max(llmTotals)}ms`)

  console.log('\n⏱️  Total Request Time:')
  console.log(`   Min:  ${min(totals)}ms`)
  console.log(`   Avg:  ${avg(totals).toFixed(0)}ms`)
  console.log(`   P50:  ${p50(totals)}ms`)
  console.log(`   Max:  ${max(totals)}ms`)

  console.log('\n' + '='.repeat(80))
}

async function main() {
  console.log('🚀 Legal AI Assistant - Latency Testing')
  console.log(`   Target: ${BASE_URL}`)
  console.log('='.repeat(80))

  const testQueries = [
    // Simple greeting (no RAG needed)
    'Hello, are you there?',

    // General question (may trigger RAG)
    'What documents do I have uploaded?',

    // Legal question (should trigger RAG if docs exist)
    'What is the corporate tax rate mentioned in my documents?',

    // Complex legal question
    'Can you summarize the key compliance requirements?',
  ]

  const results: LatencyTestResult[] = []

  for (const query of testQueries) {
    try {
      const result = await runLatencyTest(query)
      results.push(result)

      if (result.success) {
        console.log(`   ✅ TTFT: ${result.ttftMs}ms, Total: ${result.totalRequestTimeMs}ms`)
      } else {
        console.log(`   ❌ ${result.error}`)
      }
    } catch (error) {
      console.log(`   ❌ ${error instanceof Error ? error.message : 'Unknown error'}`)
      results.push({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        testId: 'error',
        timestamp: new Date().toISOString(),
        query,
        model: 'gpt-4o-mini',
      } as LatencyTestResult)
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  printReport(results)

  // Output JSON for programmatic use
  console.log('\n📄 Raw JSON:')
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2))
}

main().catch(console.error)
