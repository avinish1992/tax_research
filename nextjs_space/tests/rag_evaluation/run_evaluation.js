/**
 * Comprehensive RAG Evaluation Script
 *
 * Metrics measured:
 * - Retrieval Quality: Precision@K, Recall, MRR, NDCG
 * - Timing: Query Time, Embedding Time, Search Time, TTFT (estimated)
 * - Relevance: Keyword Hit Rate, Page Accuracy
 * - Cost Analysis: Per-query and projected costs
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') })
const fs = require('fs')
const path = require('path')

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Load test dataset
const datasetPath = path.join(__dirname, 'datasets/uae_corporate_tax_qa.json')
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'))

// User ID from uploaded document
const USER_ID = '0c400d3b-2ebe-466a-8814-5411a24beae7'

// Evaluation configuration
const CONFIG = {
  topK: 5,
  runCount: 1, // Number of times to run each query for timing stability
  generateReport: true,
  reportPath: path.join(__dirname, 'reports')
}

// Metrics storage
const metrics = {
  // Timing metrics (in ms)
  timing: {
    embeddingTimes: [],
    searchTimes: [],
    totalQueryTimes: [],
    ttftEstimates: []
  },
  // Retrieval quality metrics
  retrieval: {
    precisionAtK: [],
    recallScores: [],
    mrrScores: [],
    ndcgScores: [],
    keywordHitRates: [],
    pageAccuracyScores: []
  },
  // Per-question results
  questionResults: [],
  // Summary stats
  summary: {}
}

async function generateEmbedding(text) {
  const startTime = performance.now()

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  const embeddingTime = performance.now() - startTime

  return {
    embedding: data.data[0].embedding,
    embeddingTime,
    tokenUsage: data.usage.total_tokens
  }
}

async function hybridSearch(query, queryEmbedding) {
  const startTime = performance.now()

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/hybrid_search`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query_text: query,
      query_embedding: queryEmbedding,
      match_count: CONFIG.topK,
      p_user_id: USER_ID
    }),
  })

  const searchTime = performance.now() - startTime

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Supabase search error: ${response.status} - ${error}`)
  }

  const results = await response.json()
  return { results, searchTime }
}

function calculatePrecisionAtK(results, expectedKeywords, k = 5) {
  if (results.length === 0) return 0

  const topKResults = results.slice(0, k)
  let relevantCount = 0

  topKResults.forEach(result => {
    const contentLower = result.content.toLowerCase()
    const hasRelevantKeyword = expectedKeywords.some(kw =>
      contentLower.includes(kw.toLowerCase())
    )
    if (hasRelevantKeyword) relevantCount++
  })

  return relevantCount / k
}

function calculateRecall(results, expectedKeywords) {
  if (expectedKeywords.length === 0) return 1

  const allContent = results.map(r => r.content.toLowerCase()).join(' ')
  let foundKeywords = 0

  expectedKeywords.forEach(kw => {
    if (allContent.includes(kw.toLowerCase())) foundKeywords++
  })

  return foundKeywords / expectedKeywords.length
}

function calculateMRR(results, expectedKeywords) {
  for (let i = 0; i < results.length; i++) {
    const contentLower = results[i].content.toLowerCase()
    const hasRelevantKeyword = expectedKeywords.some(kw =>
      contentLower.includes(kw.toLowerCase())
    )
    if (hasRelevantKeyword) {
      return 1 / (i + 1)
    }
  }
  return 0
}

function calculateNDCG(results, expectedKeywords, k = 5) {
  // Calculate DCG
  let dcg = 0
  const topKResults = results.slice(0, k)

  topKResults.forEach((result, i) => {
    const contentLower = result.content.toLowerCase()
    const matchCount = expectedKeywords.filter(kw =>
      contentLower.includes(kw.toLowerCase())
    ).length
    const relevance = matchCount > 0 ? matchCount / expectedKeywords.length : 0
    dcg += relevance / Math.log2(i + 2)
  })

  // Calculate IDCG (ideal DCG - all relevant at top)
  let idcg = 0
  for (let i = 0; i < k; i++) {
    idcg += 1 / Math.log2(i + 2)
  }

  return idcg > 0 ? dcg / idcg : 0
}

function calculateKeywordHitRate(results, expectedKeywords) {
  if (results.length === 0 || expectedKeywords.length === 0) return 0

  const topResult = results[0]
  const contentLower = topResult.content.toLowerCase()

  let hits = 0
  expectedKeywords.forEach(kw => {
    if (contentLower.includes(kw.toLowerCase())) hits++
  })

  return hits / expectedKeywords.length
}

function calculatePageAccuracy(results, expectedPages) {
  if (results.length === 0 || expectedPages.length === 0) return 0

  const retrievedPages = results.map(r => r.page_number).filter(p => p !== null)
  let matches = 0

  expectedPages.forEach(expectedPage => {
    if (retrievedPages.includes(expectedPage)) matches++
  })

  return matches / expectedPages.length
}

async function evaluateQuestion(question, questionIndex, totalQuestions) {
  const startTime = performance.now()

  console.log(`\n[${ questionIndex + 1}/${totalQuestions}] ${question.category.toUpperCase()} (${question.difficulty})`)
  console.log(`   Q: "${question.question.substring(0, 60)}..."`)

  try {
    // Generate embedding
    const { embedding, embeddingTime, tokenUsage } = await generateEmbedding(question.question)

    // Run hybrid search
    const { results, searchTime } = await hybridSearch(question.question, embedding)

    const totalQueryTime = performance.now() - startTime

    // Calculate TTFT estimate (embedding + first chunk retrieval)
    const ttftEstimate = embeddingTime + (searchTime / CONFIG.topK)

    // Calculate retrieval metrics
    const precisionAtK = calculatePrecisionAtK(results, question.keywords)
    const recall = calculateRecall(results, question.keywords)
    const mrr = calculateMRR(results, question.keywords)
    const ndcg = calculateNDCG(results, question.keywords)
    const keywordHitRate = calculateKeywordHitRate(results, question.keywords)
    const pageAccuracy = calculatePageAccuracy(results, question.expected_pages)

    // Store timing metrics
    metrics.timing.embeddingTimes.push(embeddingTime)
    metrics.timing.searchTimes.push(searchTime)
    metrics.timing.totalQueryTimes.push(totalQueryTime)
    metrics.timing.ttftEstimates.push(ttftEstimate)

    // Store retrieval metrics
    metrics.retrieval.precisionAtK.push(precisionAtK)
    metrics.retrieval.recallScores.push(recall)
    metrics.retrieval.mrrScores.push(mrr)
    metrics.retrieval.ndcgScores.push(ndcg)
    metrics.retrieval.keywordHitRates.push(keywordHitRate)
    metrics.retrieval.pageAccuracyScores.push(pageAccuracy)

    // Store per-question result
    const questionResult = {
      id: question.id,
      category: question.category,
      difficulty: question.difficulty,
      question: question.question,
      timing: {
        embeddingTime: Math.round(embeddingTime),
        searchTime: Math.round(searchTime),
        totalTime: Math.round(totalQueryTime),
        ttftEstimate: Math.round(ttftEstimate)
      },
      retrieval: {
        precisionAtK: precisionAtK.toFixed(3),
        recall: recall.toFixed(3),
        mrr: mrr.toFixed(3),
        ndcg: ndcg.toFixed(3),
        keywordHitRate: keywordHitRate.toFixed(3),
        pageAccuracy: pageAccuracy.toFixed(3)
      },
      topResults: results.slice(0, 3).map(r => ({
        page: r.page_number,
        score: r.rrf_score ? r.rrf_score.toFixed(4) : 'N/A',
        preview: r.content.substring(0, 100) + '...'
      })),
      tokenUsage
    }

    metrics.questionResults.push(questionResult)

    console.log(`   ✓ Time: ${Math.round(totalQueryTime)}ms | P@${CONFIG.topK}: ${(precisionAtK*100).toFixed(0)}% | Recall: ${(recall*100).toFixed(0)}% | MRR: ${mrr.toFixed(2)}`)

    return questionResult

  } catch (error) {
    console.error(`   ✗ Error: ${error.message}`)
    return null
  }
}

function calculateSummaryStats() {
  const avg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  const percentile = (arr, p) => {
    const sorted = [...arr].sort((a, b) => a - b)
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  metrics.summary = {
    totalQuestions: metrics.questionResults.length,
    successfulQueries: metrics.questionResults.filter(r => r !== null).length,

    // Timing stats
    timing: {
      avgEmbeddingTime: Math.round(avg(metrics.timing.embeddingTimes)),
      avgSearchTime: Math.round(avg(metrics.timing.searchTimes)),
      avgTotalQueryTime: Math.round(avg(metrics.timing.totalQueryTimes)),
      avgTTFT: Math.round(avg(metrics.timing.ttftEstimates)),
      p50QueryTime: Math.round(percentile(metrics.timing.totalQueryTimes, 50)),
      p95QueryTime: Math.round(percentile(metrics.timing.totalQueryTimes, 95)),
      p99QueryTime: Math.round(percentile(metrics.timing.totalQueryTimes, 99)),
      minQueryTime: Math.round(Math.min(...metrics.timing.totalQueryTimes)),
      maxQueryTime: Math.round(Math.max(...metrics.timing.totalQueryTimes))
    },

    // Retrieval quality stats
    retrieval: {
      avgPrecisionAtK: (avg(metrics.retrieval.precisionAtK) * 100).toFixed(1),
      avgRecall: (avg(metrics.retrieval.recallScores) * 100).toFixed(1),
      avgMRR: avg(metrics.retrieval.mrrScores).toFixed(3),
      avgNDCG: avg(metrics.retrieval.ndcgScores).toFixed(3),
      avgKeywordHitRate: (avg(metrics.retrieval.keywordHitRates) * 100).toFixed(1),
      avgPageAccuracy: (avg(metrics.retrieval.pageAccuracyScores) * 100).toFixed(1)
    },

    // By difficulty breakdown
    byDifficulty: {
      easy: calculateDifficultyStats('easy'),
      medium: calculateDifficultyStats('medium'),
      hard: calculateDifficultyStats('hard')
    },

    // By category breakdown
    byCategory: calculateCategoryStats(),

    // Cost analysis
    cost: {
      totalTokens: metrics.questionResults.reduce((sum, r) => sum + (r ? r.tokenUsage : 0), 0),
      costPerQuery: 0,
      projectedCostPer1000: 0
    }
  }

  // Calculate costs (text-embedding-3-small: $0.02 per 1M tokens)
  const costPer1MTokens = 0.02
  metrics.summary.cost.costPerQuery = ((metrics.summary.cost.totalTokens / 1000000) * costPer1MTokens / metrics.summary.totalQuestions).toFixed(8)
  metrics.summary.cost.projectedCostPer1000 = ((metrics.summary.cost.totalTokens / 1000000) * costPer1MTokens * (1000 / metrics.summary.totalQuestions)).toFixed(4)
}

function calculateDifficultyStats(difficulty) {
  const filtered = metrics.questionResults.filter(r => r && r.difficulty === difficulty)
  if (filtered.length === 0) return null

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length

  return {
    count: filtered.length,
    avgQueryTime: Math.round(avg(filtered.map(r => r.timing.totalTime))),
    avgPrecision: (avg(filtered.map(r => parseFloat(r.retrieval.precisionAtK))) * 100).toFixed(1),
    avgRecall: (avg(filtered.map(r => parseFloat(r.retrieval.recall))) * 100).toFixed(1),
    avgMRR: avg(filtered.map(r => parseFloat(r.retrieval.mrr))).toFixed(3)
  }
}

function calculateCategoryStats() {
  const categories = [...new Set(metrics.questionResults.filter(r => r).map(r => r.category))]
  const stats = {}

  categories.forEach(category => {
    const filtered = metrics.questionResults.filter(r => r && r.category === category)
    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length

    stats[category] = {
      count: filtered.length,
      avgPrecision: (avg(filtered.map(r => parseFloat(r.retrieval.precisionAtK))) * 100).toFixed(1),
      avgRecall: (avg(filtered.map(r => parseFloat(r.retrieval.recall))) * 100).toFixed(1)
    }
  })

  return stats
}

function generateReport() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportFile = path.join(CONFIG.reportPath, `rag_evaluation_${timestamp}.json`)
  const summaryFile = path.join(CONFIG.reportPath, `rag_summary_${timestamp}.txt`)

  // Ensure reports directory exists
  if (!fs.existsSync(CONFIG.reportPath)) {
    fs.mkdirSync(CONFIG.reportPath, { recursive: true })
  }

  // Save full JSON report
  fs.writeFileSync(reportFile, JSON.stringify(metrics, null, 2))

  // Generate human-readable summary
  const summary = `
================================================================================
                    RAG PIPELINE EVALUATION REPORT
================================================================================
Generated: ${new Date().toISOString()}
Dataset: ${dataset.metadata.name}
Document: ${dataset.metadata.document}
Questions Evaluated: ${metrics.summary.totalQuestions}

================================================================================
                         TIMING METRICS
================================================================================
┌─────────────────────────────────┬─────────────────┐
│ Metric                          │ Value           │
├─────────────────────────────────┼─────────────────┤
│ Avg Embedding Time              │ ${String(metrics.summary.timing.avgEmbeddingTime + 'ms').padStart(15)} │
│ Avg Search Time                 │ ${String(metrics.summary.timing.avgSearchTime + 'ms').padStart(15)} │
│ Avg Total Query Time            │ ${String(metrics.summary.timing.avgTotalQueryTime + 'ms').padStart(15)} │
│ Avg TTFT (estimated)            │ ${String(metrics.summary.timing.avgTTFT + 'ms').padStart(15)} │
├─────────────────────────────────┼─────────────────┤
│ P50 Query Time                  │ ${String(metrics.summary.timing.p50QueryTime + 'ms').padStart(15)} │
│ P95 Query Time                  │ ${String(metrics.summary.timing.p95QueryTime + 'ms').padStart(15)} │
│ P99 Query Time                  │ ${String(metrics.summary.timing.p99QueryTime + 'ms').padStart(15)} │
│ Min Query Time                  │ ${String(metrics.summary.timing.minQueryTime + 'ms').padStart(15)} │
│ Max Query Time                  │ ${String(metrics.summary.timing.maxQueryTime + 'ms').padStart(15)} │
└─────────────────────────────────┴─────────────────┘

================================================================================
                      RETRIEVAL QUALITY METRICS
================================================================================
┌─────────────────────────────────┬─────────────────┐
│ Metric                          │ Value           │
├─────────────────────────────────┼─────────────────┤
│ Precision@${CONFIG.topK}                       │ ${String(metrics.summary.retrieval.avgPrecisionAtK + '%').padStart(15)} │
│ Recall                          │ ${String(metrics.summary.retrieval.avgRecall + '%').padStart(15)} │
│ Mean Reciprocal Rank (MRR)      │ ${String(metrics.summary.retrieval.avgMRR).padStart(15)} │
│ NDCG@${CONFIG.topK}                            │ ${String(metrics.summary.retrieval.avgNDCG).padStart(15)} │
│ Keyword Hit Rate (Top-1)        │ ${String(metrics.summary.retrieval.avgKeywordHitRate + '%').padStart(15)} │
│ Page Accuracy                   │ ${String(metrics.summary.retrieval.avgPageAccuracy + '%').padStart(15)} │
└─────────────────────────────────┴─────────────────┘

================================================================================
                        BY DIFFICULTY LEVEL
================================================================================
${Object.entries(metrics.summary.byDifficulty).map(([level, stats]) =>
  stats ? `${level.toUpperCase()} (n=${stats.count}): P@K=${stats.avgPrecision}% | Recall=${stats.avgRecall}% | MRR=${stats.avgMRR} | Time=${stats.avgQueryTime}ms` : ''
).filter(Boolean).join('\n')}

================================================================================
                          BY CATEGORY
================================================================================
${Object.entries(metrics.summary.byCategory).map(([cat, stats]) =>
  `${cat}: P@K=${stats.avgPrecision}% | Recall=${stats.avgRecall}% (n=${stats.count})`
).join('\n')}

================================================================================
                         COST ANALYSIS
================================================================================
Total Tokens Used: ${metrics.summary.cost.totalTokens}
Cost per Query: $${metrics.summary.cost.costPerQuery}
Projected Cost per 1000 Queries: $${metrics.summary.cost.projectedCostPer1000}

================================================================================
                      SYSTEM CONFIGURATION
================================================================================
Embedding Model: text-embedding-3-small (1536 dims)
Search Type: Hybrid (Semantic + Keyword with RRF)
Top-K Results: ${CONFIG.topK}
Database: Supabase (pgvector)

================================================================================
                           END REPORT
================================================================================
`

  fs.writeFileSync(summaryFile, summary)

  return { reportFile, summaryFile, summary }
}

async function runEvaluation() {
  console.log('\n' + '='.repeat(80))
  console.log('           RAG PIPELINE COMPREHENSIVE EVALUATION')
  console.log('='.repeat(80))
  console.log(`\nDataset: ${dataset.metadata.name}`)
  console.log(`Questions: ${dataset.questions.length}`)
  console.log(`Top-K: ${CONFIG.topK}`)
  console.log(`\nStarting evaluation...\n`)

  const startTime = performance.now()

  // Run evaluation for each question
  for (let i = 0; i < dataset.questions.length; i++) {
    await evaluateQuestion(dataset.questions[i], i, dataset.questions.length)

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  const totalTime = performance.now() - startTime

  // Calculate summary statistics
  calculateSummaryStats()

  // Generate report
  if (CONFIG.generateReport) {
    const { reportFile, summaryFile, summary } = generateReport()
    console.log('\n' + summary)
    console.log(`\nReports saved to:`)
    console.log(`  - JSON: ${reportFile}`)
    console.log(`  - Summary: ${summaryFile}`)
  }

  console.log(`\nTotal evaluation time: ${(totalTime / 1000).toFixed(1)}s`)
  console.log('='.repeat(80))
}

// Run the evaluation
runEvaluation().catch(console.error)
