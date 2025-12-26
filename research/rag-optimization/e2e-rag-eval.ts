/**
 * E2E RAG Evaluation - Tests questions through the actual RAG pipeline
 * Uses chandra user credentials
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!

// Chandra user credentials
const USER_ID = '5f855b8f-d34d-44dd-96c5-ea2263a6939d'
const USER_EMAIL = 'chandra.4@iitj.ac.in'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Test configuration
const MAX_QUESTIONS = parseInt(process.env.E2E_MAX_QUESTIONS || '50')
const MIN_SIMILARITY = 0.25 // Optimized threshold
const RESULTS_DIR = path.resolve(__dirname, 'eval_results')

interface QAPair {
  id: string
  question: string
  answer: string
  chunk_span: number
  source_chunk_ids: string[]
  source_documents: string[]
  source_content: string
  topic: string
  complexity: string
}

interface TestResult {
  id: string
  question: string
  expectedAnswer: string
  chunk_span: number
  topic: string
  complexity: string
  source_documents: string[]
  responseTimeMs: number
  retrievedDocuments: string[]
  retrievedChunkIds: string[]
  semanticSimilarity: number
  documentRecall: number
  chunkFound: boolean
  topChunkRank: number | null
}

interface EvaluationReport {
  config: {
    userId: string
    userEmail: string
    minSimilarity: number
    totalQuestions: number
    timestamp: string
  }
  summary: {
    avgResponseTimeMs: number
    avgSemanticSimilarity: number
    avgDocumentRecall: number
    chunkFoundRate: number
    avgTopChunkRank: number
  }
  byChunkSpan: Record<number, ChunkSpanStats>
  byTopic: Record<string, TopicStats>
  byComplexity: Record<string, ComplexityStats>
  results: TestResult[]
}

interface ChunkSpanStats {
  count: number
  avgSimilarity: number
  avgDocRecall: number
  chunkFoundRate: number
  avgResponseTime: number
}

interface TopicStats {
  count: number
  avgSimilarity: number
  avgDocRecall: number
  chunkFoundRate: number
}

interface ComplexityStats {
  count: number
  avgSimilarity: number
  avgDocRecall: number
  chunkFoundRate: number
}

// Load questions from dataset
function loadQuestions(): QAPair[] {
  const dataPath = path.resolve(__dirname, 'eval_results/qa_pairs_dataset_v2.json')
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
  return data.qa_pairs
}

// Sample questions by chunk_span distribution
function sampleQuestions(questions: QAPair[], maxCount: number): QAPair[] {
  const bySpan: Record<number, QAPair[]> = {}
  for (const q of questions) {
    if (!bySpan[q.chunk_span]) bySpan[q.chunk_span] = []
    bySpan[q.chunk_span].push(q)
  }

  const spans = Object.keys(bySpan).map(Number).sort((a, b) => a - b)
  const sampled: QAPair[] = []
  const perSpan = Math.ceil(maxCount / spans.length)

  for (const span of spans) {
    const available = bySpan[span]
    const toTake = Math.min(perSpan, available.length, maxCount - sampled.length)
    const shuffled = available.sort(() => Math.random() - 0.5)
    sampled.push(...shuffled.slice(0, toTake))
  }

  return sampled.slice(0, maxCount)
}

// Generate embedding
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.substring(0, 8000),
    }),
  })
  const data = await response.json()
  return data?.data?.[0]?.embedding || []
}

// Calculate cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Calculate document recall
function calculateDocumentRecall(expected: string[], retrieved: string[]): number {
  if (expected.length === 0) return 0
  if (retrieved.length === 0) return 0

  const expectedNorm = expected.map(d => d.toLowerCase().replace('.pdf', ''))
  const retrievedNorm = retrieved.map(d => d.toLowerCase().replace('.pdf', ''))

  let matches = 0
  for (const exp of expectedNorm) {
    for (const ret of retrievedNorm) {
      if (exp.includes(ret) || ret.includes(exp)) {
        matches++
        break
      }
    }
  }

  return matches / expected.length
}

// Run test for a single question
async function testQuestion(q: QAPair): Promise<TestResult> {
  const startTime = Date.now()

  const result: TestResult = {
    id: q.id,
    question: q.question,
    expectedAnswer: q.answer,
    chunk_span: q.chunk_span,
    topic: q.topic,
    complexity: q.complexity,
    source_documents: q.source_documents,
    responseTimeMs: 0,
    retrievedDocuments: [],
    retrievedChunkIds: [],
    semanticSimilarity: 0,
    documentRecall: 0,
    chunkFound: false,
    topChunkRank: null,
  }

  try {
    // Generate embedding for question
    const embedding = await generateEmbedding(q.question)

    // Search using semantic_search RPC
    const { data: chunks, error } = await supabase.rpc('semantic_search', {
      query_embedding: JSON.stringify(embedding),
      p_user_id: USER_ID,
      match_count: 10,
      min_similarity: MIN_SIMILARITY,
    })

    result.responseTimeMs = Date.now() - startTime

    if (error) throw error

    if (chunks && chunks.length > 0) {
      result.retrievedChunkIds = chunks.map((c: any) => c.chunk_id)
      result.retrievedDocuments = [...new Set(chunks.map((c: any) => c.file_name))]

      // Check if source chunk was found
      for (let i = 0; i < chunks.length; i++) {
        if (q.source_chunk_ids.includes(chunks[i].chunk_id)) {
          result.chunkFound = true
          result.topChunkRank = i + 1
          break
        }
      }

      // Calculate document recall
      result.documentRecall = calculateDocumentRecall(q.source_documents, result.retrievedDocuments)

      // Calculate semantic similarity between expected answer and retrieved content
      const retrievedContent = chunks.map((c: any) => c.content).join('\n\n').substring(0, 3000)
      const [expectedEmb, retrievedEmb] = await Promise.all([
        generateEmbedding(q.answer),
        generateEmbedding(retrievedContent),
      ])
      result.semanticSimilarity = cosineSimilarity(expectedEmb, retrievedEmb)
    }
  } catch (err: any) {
    console.error(`  Error: ${err.message}`)
    result.responseTimeMs = Date.now() - startTime
  }

  return result
}

// Generate report from results
function generateReport(results: TestResult[]): EvaluationReport {
  const successful = results.filter(r => r.responseTimeMs > 0)

  // Summary metrics
  const avgResponseTime = successful.reduce((sum, r) => sum + r.responseTimeMs, 0) / successful.length
  const avgSimilarity = successful.reduce((sum, r) => sum + r.semanticSimilarity, 0) / successful.length
  const avgDocRecall = successful.reduce((sum, r) => sum + r.documentRecall, 0) / successful.length
  const chunkFoundRate = successful.filter(r => r.chunkFound).length / successful.length
  const rankedResults = successful.filter(r => r.topChunkRank !== null)
  const avgTopChunkRank = rankedResults.length > 0
    ? rankedResults.reduce((sum, r) => sum + (r.topChunkRank || 0), 0) / rankedResults.length
    : 999

  // Group by chunk_span
  const byChunkSpan: Record<number, ChunkSpanStats> = {}
  for (const r of successful) {
    if (!byChunkSpan[r.chunk_span]) {
      byChunkSpan[r.chunk_span] = { count: 0, avgSimilarity: 0, avgDocRecall: 0, chunkFoundRate: 0, avgResponseTime: 0 }
    }
    const s = byChunkSpan[r.chunk_span]
    s.count++
    s.avgSimilarity += r.semanticSimilarity
    s.avgDocRecall += r.documentRecall
    s.chunkFoundRate += r.chunkFound ? 1 : 0
    s.avgResponseTime += r.responseTimeMs
  }
  for (const span of Object.keys(byChunkSpan)) {
    const s = byChunkSpan[Number(span)]
    s.avgSimilarity /= s.count
    s.avgDocRecall /= s.count
    s.chunkFoundRate /= s.count
    s.avgResponseTime /= s.count
  }

  // Group by topic
  const byTopic: Record<string, TopicStats> = {}
  for (const r of successful) {
    if (!byTopic[r.topic]) {
      byTopic[r.topic] = { count: 0, avgSimilarity: 0, avgDocRecall: 0, chunkFoundRate: 0 }
    }
    const t = byTopic[r.topic]
    t.count++
    t.avgSimilarity += r.semanticSimilarity
    t.avgDocRecall += r.documentRecall
    t.chunkFoundRate += r.chunkFound ? 1 : 0
  }
  for (const topic of Object.keys(byTopic)) {
    const t = byTopic[topic]
    t.avgSimilarity /= t.count
    t.avgDocRecall /= t.count
    t.chunkFoundRate /= t.count
  }

  // Group by complexity
  const byComplexity: Record<string, ComplexityStats> = {}
  for (const r of successful) {
    if (!byComplexity[r.complexity]) {
      byComplexity[r.complexity] = { count: 0, avgSimilarity: 0, avgDocRecall: 0, chunkFoundRate: 0 }
    }
    const c = byComplexity[r.complexity]
    c.count++
    c.avgSimilarity += r.semanticSimilarity
    c.avgDocRecall += r.documentRecall
    c.chunkFoundRate += r.chunkFound ? 1 : 0
  }
  for (const complexity of Object.keys(byComplexity)) {
    const c = byComplexity[complexity]
    c.avgSimilarity /= c.count
    c.avgDocRecall /= c.count
    c.chunkFoundRate /= c.count
  }

  return {
    config: {
      userId: USER_ID,
      userEmail: USER_EMAIL,
      minSimilarity: MIN_SIMILARITY,
      totalQuestions: results.length,
      timestamp: new Date().toISOString(),
    },
    summary: {
      avgResponseTimeMs: avgResponseTime,
      avgSemanticSimilarity: avgSimilarity,
      avgDocumentRecall: avgDocRecall,
      chunkFoundRate: chunkFoundRate,
      avgTopChunkRank: avgTopChunkRank,
    },
    byChunkSpan,
    byTopic,
    byComplexity,
    results,
  }
}

// Print report
function printReport(report: EvaluationReport) {
  console.log('\n' + '='.repeat(80))
  console.log('E2E RAG EVALUATION REPORT')
  console.log('='.repeat(80))
  console.log(`User: ${report.config.userEmail}`)
  console.log(`Threshold: ${report.config.minSimilarity}`)
  console.log(`Questions: ${report.config.totalQuestions}`)

  console.log('\n📊 SUMMARY')
  console.log('-'.repeat(50))
  console.log(`Avg Response Time:     ${report.summary.avgResponseTimeMs.toFixed(0)}ms`)
  console.log(`Avg Semantic Similarity: ${(report.summary.avgSemanticSimilarity * 100).toFixed(1)}%`)
  console.log(`Avg Document Recall:   ${(report.summary.avgDocumentRecall * 100).toFixed(1)}%`)
  console.log(`Chunk Found Rate:      ${(report.summary.chunkFoundRate * 100).toFixed(1)}%`)
  console.log(`Avg Chunk Rank:        ${report.summary.avgTopChunkRank.toFixed(2)}`)

  console.log('\n📈 BY CHUNK SPAN (Single vs Multi-Document)')
  console.log('-'.repeat(70))
  console.log('Span | Count | Similarity | Doc Recall | Chunk Found | Avg Time')
  console.log('-'.repeat(70))
  for (const [span, stats] of Object.entries(report.byChunkSpan).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(
      `${span.padStart(4)} | ` +
      `${stats.count.toString().padStart(5)} | ` +
      `${(stats.avgSimilarity * 100).toFixed(1).padStart(10)}% | ` +
      `${(stats.avgDocRecall * 100).toFixed(1).padStart(10)}% | ` +
      `${(stats.chunkFoundRate * 100).toFixed(1).padStart(11)}% | ` +
      `${stats.avgResponseTime.toFixed(0).padStart(7)}ms`
    )
  }

  console.log('\n📚 BY TOPIC')
  console.log('-'.repeat(70))
  console.log('Topic                          | Count | Similarity | Doc Recall | Chunk Found')
  console.log('-'.repeat(70))
  for (const [topic, stats] of Object.entries(report.byTopic).sort((a, b) => b[1].count - a[1].count)) {
    console.log(
      `${topic.substring(0, 30).padEnd(30)} | ` +
      `${stats.count.toString().padStart(5)} | ` +
      `${(stats.avgSimilarity * 100).toFixed(1).padStart(10)}% | ` +
      `${(stats.avgDocRecall * 100).toFixed(1).padStart(10)}% | ` +
      `${(stats.chunkFoundRate * 100).toFixed(1).padStart(11)}%`
    )
  }

  console.log('\n🎯 BY COMPLEXITY')
  console.log('-'.repeat(60))
  console.log('Complexity   | Count | Similarity | Doc Recall | Chunk Found')
  console.log('-'.repeat(60))
  for (const [complexity, stats] of Object.entries(report.byComplexity)) {
    console.log(
      `${complexity.padEnd(12)} | ` +
      `${stats.count.toString().padStart(5)} | ` +
      `${(stats.avgSimilarity * 100).toFixed(1).padStart(10)}% | ` +
      `${(stats.avgDocRecall * 100).toFixed(1).padStart(10)}% | ` +
      `${(stats.chunkFoundRate * 100).toFixed(1).padStart(11)}%`
    )
  }

  // Recommendations
  console.log('\n💡 RECOMMENDATIONS')
  console.log('-'.repeat(50))

  if (report.summary.avgDocumentRecall < 0.8) {
    console.log('⚠️  Document recall < 80% - consider:')
    console.log('    - Increasing top-k')
    console.log('    - Query expansion')
    console.log('    - Hybrid search with keywords')
  }

  if (report.summary.chunkFoundRate < 0.7) {
    console.log('⚠️  Chunk found rate < 70% - consider:')
    console.log('    - Lowering similarity threshold')
    console.log('    - Better chunking strategy')
    console.log('    - Reranking')
  }

  // Check multi-document performance
  const multiDocSpans = Object.entries(report.byChunkSpan).filter(([span]) => Number(span) > 1)
  if (multiDocSpans.length > 0) {
    const avgMultiDocRecall = multiDocSpans.reduce((sum, [, stats]) => sum + stats.avgDocRecall, 0) / multiDocSpans.length
    if (avgMultiDocRecall < 0.5) {
      console.log('⚠️  Multi-document questions perform poorly:')
      console.log('    - Consider document-level retrieval')
      console.log('    - Add diversity to results')
    }
  }
}

// Main
async function main() {
  console.log('=' .repeat(80))
  console.log('E2E RAG EVALUATION')
  console.log('=' .repeat(80))
  console.log(`User: ${USER_EMAIL} (${USER_ID})`)
  console.log(`Threshold: ${MIN_SIMILARITY}`)
  console.log(`Max Questions: ${MAX_QUESTIONS}`)

  // Load and sample questions
  const allQuestions = loadQuestions()
  const questions = sampleQuestions(allQuestions, MAX_QUESTIONS)

  console.log(`\nLoaded ${allQuestions.length} questions, testing ${questions.length}`)

  // Distribution
  const spanCounts: Record<number, number> = {}
  for (const q of questions) {
    spanCounts[q.chunk_span] = (spanCounts[q.chunk_span] || 0) + 1
  }
  console.log('Distribution:')
  for (const [span, count] of Object.entries(spanCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  chunk_span=${span}: ${count} questions`)
  }

  // Run tests
  console.log('\nRunning tests...\n')
  const results: TestResult[] = []

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    process.stdout.write(`[${(i + 1).toString().padStart(3)}/${questions.length}] ${q.id.padEnd(12)} `)

    const result = await testQuestion(q)
    results.push(result)

    const status = result.chunkFound ? '✓' : '✗'
    console.log(
      `${status} sim=${(result.semanticSimilarity * 100).toFixed(0).padStart(3)}% ` +
      `doc=${(result.documentRecall * 100).toFixed(0).padStart(3)}% ` +
      `rank=${result.topChunkRank || '-'} ` +
      `${result.responseTimeMs}ms`
    )

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 150))
  }

  // Generate and print report
  const report = generateReport(results)
  printReport(report)

  // Save results
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true })
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const resultsPath = path.join(RESULTS_DIR, `e2e_eval_${timestamp}.json`)
  fs.writeFileSync(resultsPath, JSON.stringify(report, null, 2))
  console.log(`\n✅ Results saved to: ${resultsPath}`)
}

main().catch(console.error)
