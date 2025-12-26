/**
 * Top-K Comparison Test: 10 vs 20
 * Tests if retrieving more chunks improves multi-document question performance
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!

const USER_ID = '5f855b8f-d34d-44dd-96c5-ea2263a6939d'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const MIN_SIMILARITY = 0.25
const TOP_K_VALUES = [10, 20]

interface QAPair {
  id: string
  question: string
  answer: string
  chunk_span: number
  source_chunk_ids: string[]
  source_documents: string[]
  topic: string
  complexity: string
}

interface TestResult {
  topK: number
  chunkSpan: number
  chunkFound: boolean
  chunkRank: number | null
  docFound: boolean
  responseTimeMs: number
}

// Load questions
function loadQuestions(): QAPair[] {
  const dataPath = path.resolve(__dirname, 'eval_results/qa_pairs_dataset_v2.json')
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
  return data.qa_pairs
}

// Sample questions evenly by chunk_span
function sampleQuestions(questions: QAPair[], count: number): QAPair[] {
  const bySpan: Record<number, QAPair[]> = {}
  for (const q of questions) {
    if (!bySpan[q.chunk_span]) bySpan[q.chunk_span] = []
    bySpan[q.chunk_span].push(q)
  }

  const spans = Object.keys(bySpan).map(Number).sort((a, b) => a - b)
  const sampled: QAPair[] = []
  const perSpan = Math.ceil(count / spans.length)

  for (const span of spans) {
    const shuffled = bySpan[span].sort(() => Math.random() - 0.5)
    sampled.push(...shuffled.slice(0, perSpan))
  }

  return sampled.slice(0, count)
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

// Test a question with specific top-k
async function testQuestion(q: QAPair, topK: number, embedding: number[]): Promise<TestResult> {
  const startTime = Date.now()

  const { data: chunks, error } = await supabase.rpc('semantic_search', {
    query_embedding: JSON.stringify(embedding),
    p_user_id: USER_ID,
    match_count: topK,
    min_similarity: MIN_SIMILARITY,
  })

  const responseTimeMs = Date.now() - startTime

  if (error || !chunks) {
    return {
      topK,
      chunkSpan: q.chunk_span,
      chunkFound: false,
      chunkRank: null,
      docFound: false,
      responseTimeMs,
    }
  }

  // Check if source chunk was found
  let chunkFound = false
  let chunkRank: number | null = null
  for (let i = 0; i < chunks.length; i++) {
    if (q.source_chunk_ids.includes(chunks[i].chunk_id)) {
      chunkFound = true
      chunkRank = i + 1
      break
    }
  }

  // Check if source document was found
  const retrievedDocs = chunks.map((c: any) => c.file_name.toLowerCase())
  const expectedDocs = q.source_documents.map(d => d.toLowerCase().replace('.pdf', ''))
  const docFound = expectedDocs.some(exp =>
    retrievedDocs.some((ret: string) => ret.includes(exp) || exp.includes(ret.replace('.pdf', '')))
  )

  return {
    topK,
    chunkSpan: q.chunk_span,
    chunkFound,
    chunkRank,
    docFound,
    responseTimeMs,
  }
}

async function main() {
  console.log('=' .repeat(80))
  console.log('TOP-K COMPARISON TEST: 10 vs 20')
  console.log('=' .repeat(80))

  const allQuestions = loadQuestions()
  const questions = sampleQuestions(allQuestions, 50)

  console.log(`Testing ${questions.length} questions with top-k = ${TOP_K_VALUES.join(', ')}`)
  console.log(`Threshold: ${MIN_SIMILARITY}\n`)

  // Pre-generate embeddings
  console.log('Generating embeddings...')
  const embeddings: Map<string, number[]> = new Map()
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    embeddings.set(q.id, await generateEmbedding(q.question))
    if ((i + 1) % 10 === 0) console.log(`  Embedded ${i + 1}/${questions.length}`)
    await new Promise(r => setTimeout(r, 100))
  }
  console.log('Embeddings complete.\n')

  // Results storage
  const results: Record<number, Record<number, TestResult[]>> = {}
  for (const topK of TOP_K_VALUES) {
    results[topK] = {}
  }

  // Run tests
  console.log('Running comparison tests...\n')
  console.log('ID           | Span | K=10 Chunk | K=20 Chunk | K=10 Doc | K=20 Doc')
  console.log('-'.repeat(70))

  for (const q of questions) {
    const embedding = embeddings.get(q.id)!
    const resultsByK: Record<number, TestResult> = {}

    for (const topK of TOP_K_VALUES) {
      const result = await testQuestion(q, topK, embedding)
      resultsByK[topK] = result

      if (!results[topK][q.chunk_span]) {
        results[topK][q.chunk_span] = []
      }
      results[topK][q.chunk_span].push(result)

      await new Promise(r => setTimeout(r, 50))
    }

    // Print row
    const r10 = resultsByK[10]
    const r20 = resultsByK[20]
    const improved = !r10.chunkFound && r20.chunkFound ? ' ⬆️' : ''
    console.log(
      `${q.id.padEnd(12)} | ` +
      `${q.chunk_span.toString().padStart(4)} | ` +
      `${r10.chunkFound ? `✓ rank=${r10.chunkRank}` : '✗'.padEnd(10)} | ` +
      `${r20.chunkFound ? `✓ rank=${r20.chunkRank}` : '✗'.padEnd(10)} | ` +
      `${r10.docFound ? '✓' : '✗'.padEnd(8)} | ` +
      `${r20.docFound ? '✓' : '✗'}${improved}`
    )
  }

  // Summary
  console.log('\n' + '=' .repeat(80))
  console.log('SUMMARY BY CHUNK SPAN')
  console.log('=' .repeat(80))
  console.log('Span | K=10 Chunk% | K=20 Chunk% | Improvement | K=10 Doc% | K=20 Doc%')
  console.log('-'.repeat(80))

  const spans = [...new Set(questions.map(q => q.chunk_span))].sort((a, b) => a - b)
  let totalImprovement = 0
  let totalQuestions = 0

  for (const span of spans) {
    const r10 = results[10][span] || []
    const r20 = results[20][span] || []

    const chunkFound10 = r10.filter(r => r.chunkFound).length / r10.length * 100
    const chunkFound20 = r20.filter(r => r.chunkFound).length / r20.length * 100
    const docFound10 = r10.filter(r => r.docFound).length / r10.length * 100
    const docFound20 = r20.filter(r => r.docFound).length / r20.length * 100

    const improvement = chunkFound20 - chunkFound10
    totalImprovement += improvement * r10.length
    totalQuestions += r10.length

    console.log(
      `${span.toString().padStart(4)} | ` +
      `${chunkFound10.toFixed(0).padStart(11)}% | ` +
      `${chunkFound20.toFixed(0).padStart(11)}% | ` +
      `${improvement > 0 ? '+' : ''}${improvement.toFixed(0).padStart(10)}% | ` +
      `${docFound10.toFixed(0).padStart(9)}% | ` +
      `${docFound20.toFixed(0).padStart(9)}%`
    )
  }

  // Overall
  const all10 = Object.values(results[10]).flat()
  const all20 = Object.values(results[20]).flat()
  const overallChunk10 = all10.filter(r => r.chunkFound).length / all10.length * 100
  const overallChunk20 = all20.filter(r => r.chunkFound).length / all20.length * 100
  const overallDoc10 = all10.filter(r => r.docFound).length / all10.length * 100
  const overallDoc20 = all20.filter(r => r.docFound).length / all20.length * 100

  console.log('-'.repeat(80))
  console.log(
    `ALL  | ` +
    `${overallChunk10.toFixed(0).padStart(11)}% | ` +
    `${overallChunk20.toFixed(0).padStart(11)}% | ` +
    `${(overallChunk20 - overallChunk10) > 0 ? '+' : ''}${(overallChunk20 - overallChunk10).toFixed(0).padStart(10)}% | ` +
    `${overallDoc10.toFixed(0).padStart(9)}% | ` +
    `${overallDoc20.toFixed(0).padStart(9)}%`
  )

  // Recommendations
  console.log('\n' + '=' .repeat(80))
  console.log('ANALYSIS')
  console.log('=' .repeat(80))

  if (overallChunk20 > overallChunk10 + 5) {
    console.log(`✅ top-k=20 improves chunk retrieval by ${(overallChunk20 - overallChunk10).toFixed(0)}%`)
    console.log('   Recommendation: Increase FINAL_TOP_K to 20 in production')
  } else if (overallChunk20 > overallChunk10) {
    console.log(`⚠️  top-k=20 provides marginal improvement (+${(overallChunk20 - overallChunk10).toFixed(0)}%)`)
    console.log('   Consider: Keep k=10 but add reranking for better precision')
  } else {
    console.log('ℹ️  top-k=20 shows no significant improvement')
    console.log('   The issue may be embedding quality, not retrieval depth')
  }

  // Multi-doc specific analysis
  const multiDocSpans = spans.filter(s => s > 1)
  if (multiDocSpans.length > 0) {
    const multiDoc10 = multiDocSpans.flatMap(s => results[10][s] || [])
    const multiDoc20 = multiDocSpans.flatMap(s => results[20][s] || [])
    const multi10Rate = multiDoc10.filter(r => r.chunkFound).length / multiDoc10.length * 100
    const multi20Rate = multiDoc20.filter(r => r.chunkFound).length / multiDoc20.length * 100

    console.log(`\nMulti-document questions (span > 1):`)
    console.log(`  K=10: ${multi10Rate.toFixed(0)}% chunk found`)
    console.log(`  K=20: ${multi20Rate.toFixed(0)}% chunk found`)
    console.log(`  Improvement: ${(multi20Rate - multi10Rate).toFixed(0)}%`)
  }

  console.log('\n=== TEST COMPLETE ===')
}

main().catch(console.error)
