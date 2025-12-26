/**
 * Reranking Comparison Test: No Reranking vs LLM Reranking
 * Tests if LLM-based reranking improves retrieval quality
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
const INITIAL_TOP_K = 50  // Retrieve top-50 (matching production)
const RERANK_TOP_K = 20   // Rerank to top-20
const FINAL_TOP_K = 10    // Final results after reranking

interface RerankDocument {
  content: string
  fileName: string
  score: number
  chunkIndex: number
  pageNumber: number | null
  source: string
  chunkId: string
}

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
  mode: 'no_rerank' | 'llm_rerank'
  chunkSpan: number
  chunkFound: boolean
  chunkRank: number | null
  docFound: boolean
  responseTimeMs: number
  topScore: number
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

// LLM Reranking (from reranker.ts)
async function rerankWithLLM(
  query: string,
  documents: RerankDocument[],
  topN: number = 10
): Promise<RerankDocument[]> {
  if (documents.length === 0) return []

  // Limit to 50 to stay within context window (each doc ~400 chars = ~100 tokens)
  const docsToRerank = documents.slice(0, 50)

  try {
    const prompt = `You are a legal document relevance scorer. Score each document's relevance to the query on a scale of 0-10.

Query: "${query}"

Documents to score:
${docsToRerank.map((doc, i) => `[${i}] ${doc.content.slice(0, 400)}...`).join('\n\n')}

Instructions:
- Score 9-10: Directly answers the query with specific information
- Score 7-8: Contains relevant information but not a direct answer
- Score 4-6: Tangentially related to the query topic
- Score 1-3: Barely relevant or off-topic
- Score 0: Completely irrelevant

Return ONLY a JSON array of scores in order, like: [8, 5, 9, ...]
No explanation, just the array:`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 500  // Increased for 50 document scores
      })
    })

    const data = await response.json()
    let scores: number[]

    try {
      let content = data.choices[0].message.content.trim()
      if (content.includes('```')) {
        content = content.split('```')[1].replace('json', '').trim()
      }
      scores = JSON.parse(content)
    } catch {
      // If parsing fails, return original order
      return docsToRerank.slice(0, topN)
    }

    // Create scored documents and sort
    const scoredDocs = docsToRerank.map((doc, idx) => ({
      doc,
      llmScore: (scores[idx] ?? 5) / 10
    }))

    scoredDocs.sort((a, b) => b.llmScore - a.llmScore)

    return scoredDocs.slice(0, topN).map(s => ({
      ...s.doc,
      score: s.llmScore  // Replace original score with LLM score
    }))
  } catch (error) {
    console.error('LLM reranking failed:', error)
    return docsToRerank.slice(0, topN)
  }
}

// Retrieve chunks
async function retrieveChunks(embedding: number[], topK: number): Promise<RerankDocument[]> {
  const { data: chunks, error } = await supabase.rpc('semantic_search', {
    query_embedding: JSON.stringify(embedding),
    p_user_id: USER_ID,
    match_count: topK,
    min_similarity: MIN_SIMILARITY,
  })

  if (error || !chunks) return []

  return chunks.map((c: any) => ({
    content: c.content,
    fileName: c.file_name,
    score: c.similarity,
    chunkIndex: c.chunk_index,
    pageNumber: c.page_number,
    source: 'semantic',
    chunkId: c.chunk_id
  }))
}

// Test a question
async function testQuestion(
  q: QAPair,
  embedding: number[],
  mode: 'no_rerank' | 'llm_rerank'
): Promise<TestResult> {
  const startTime = Date.now()

  // Retrieve initial chunks
  let chunks = await retrieveChunks(embedding, INITIAL_TOP_K)

  // Apply reranking if enabled
  if (mode === 'llm_rerank' && chunks.length > 0) {
    // Rerank top-50 to top-20, then take top-10
    chunks = await rerankWithLLM(q.question, chunks, RERANK_TOP_K)
    chunks = chunks.slice(0, FINAL_TOP_K)
  } else {
    // No reranking: just take top-10 from top-50
    chunks = chunks.slice(0, FINAL_TOP_K)
  }

  const responseTimeMs = Date.now() - startTime

  // Check if source chunk was found
  let chunkFound = false
  let chunkRank: number | null = null
  for (let i = 0; i < chunks.length; i++) {
    if (q.source_chunk_ids.includes(chunks[i].chunkId)) {
      chunkFound = true
      chunkRank = i + 1
      break
    }
  }

  // Check if source document was found
  const retrievedDocs = chunks.map(c => c.fileName.toLowerCase())
  const expectedDocs = q.source_documents.map(d => d.toLowerCase().replace('.pdf', ''))
  const docFound = expectedDocs.some(exp =>
    retrievedDocs.some(ret => ret.includes(exp) || exp.includes(ret.replace('.pdf', '')))
  )

  return {
    mode,
    chunkSpan: q.chunk_span,
    chunkFound,
    chunkRank,
    docFound,
    responseTimeMs,
    topScore: chunks.length > 0 ? chunks[0].score : 0
  }
}

async function main() {
  console.log('='.repeat(80))
  console.log('RERANKING COMPARISON TEST: No Reranking vs LLM Reranking')
  console.log('='.repeat(80))

  const allQuestions = loadQuestions()
  const questions = sampleQuestions(allQuestions, 50)

  console.log(`Testing ${questions.length} questions`)
  console.log(`Initial retrieval: top-${INITIAL_TOP_K}, Final: top-${FINAL_TOP_K}`)
  console.log(`Similarity threshold: ${MIN_SIMILARITY}\n`)

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
  const results: Record<string, Record<number, TestResult[]>> = {
    no_rerank: {},
    llm_rerank: {}
  }

  // Run tests
  console.log('Running comparison tests...\n')
  console.log('ID           | Span | NoRerank Chunk | LLM Chunk    | NoRerank Doc | LLM Doc | Time')
  console.log('-'.repeat(85))

  for (const q of questions) {
    const embedding = embeddings.get(q.id)!
    const resultsByMode: Record<string, TestResult> = {}

    // Test without reranking
    const noRerankResult = await testQuestion(q, embedding, 'no_rerank')
    resultsByMode['no_rerank'] = noRerankResult
    if (!results.no_rerank[q.chunk_span]) results.no_rerank[q.chunk_span] = []
    results.no_rerank[q.chunk_span].push(noRerankResult)

    await new Promise(r => setTimeout(r, 50))

    // Test with LLM reranking
    const llmResult = await testQuestion(q, embedding, 'llm_rerank')
    resultsByMode['llm_rerank'] = llmResult
    if (!results.llm_rerank[q.chunk_span]) results.llm_rerank[q.chunk_span] = []
    results.llm_rerank[q.chunk_span].push(llmResult)

    await new Promise(r => setTimeout(r, 100))

    // Print row
    const nr = resultsByMode.no_rerank
    const lr = resultsByMode.llm_rerank
    const improved = !nr.chunkFound && lr.chunkFound ? ' ⬆️' : ''
    const degraded = nr.chunkFound && !lr.chunkFound ? ' ⬇️' : ''
    console.log(
      `${q.id.padEnd(12)} | ` +
      `${q.chunk_span.toString().padStart(4)} | ` +
      `${nr.chunkFound ? `✓ rank=${nr.chunkRank}`.padEnd(14) : '✗'.padEnd(14)} | ` +
      `${lr.chunkFound ? `✓ rank=${lr.chunkRank}`.padEnd(12) : '✗'.padEnd(12)} | ` +
      `${nr.docFound ? '✓'.padEnd(12) : '✗'.padEnd(12)} | ` +
      `${lr.docFound ? '✓' : '✗'.padEnd(7)} | ` +
      `${lr.responseTimeMs}ms${improved}${degraded}`
    )
  }

  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('SUMMARY BY CHUNK SPAN')
  console.log('='.repeat(80))
  console.log('Span | NoRerank Chunk% | LLM Chunk% | Improvement | NoRerank Doc% | LLM Doc%')
  console.log('-'.repeat(85))

  const spans = [...new Set(questions.map(q => q.chunk_span))].sort((a, b) => a - b)

  for (const span of spans) {
    const nr = results.no_rerank[span] || []
    const lr = results.llm_rerank[span] || []

    const chunkFoundNR = nr.filter(r => r.chunkFound).length / nr.length * 100
    const chunkFoundLR = lr.filter(r => r.chunkFound).length / lr.length * 100
    const docFoundNR = nr.filter(r => r.docFound).length / nr.length * 100
    const docFoundLR = lr.filter(r => r.docFound).length / lr.length * 100

    const improvement = chunkFoundLR - chunkFoundNR

    console.log(
      `${span.toString().padStart(4)} | ` +
      `${chunkFoundNR.toFixed(0).padStart(15)}% | ` +
      `${chunkFoundLR.toFixed(0).padStart(10)}% | ` +
      `${improvement > 0 ? '+' : ''}${improvement.toFixed(0).padStart(10)}% | ` +
      `${docFoundNR.toFixed(0).padStart(13)}% | ` +
      `${docFoundLR.toFixed(0).padStart(8)}%`
    )
  }

  // Overall
  const allNR = Object.values(results.no_rerank).flat()
  const allLR = Object.values(results.llm_rerank).flat()
  const overallChunkNR = allNR.filter(r => r.chunkFound).length / allNR.length * 100
  const overallChunkLR = allLR.filter(r => r.chunkFound).length / allLR.length * 100
  const overallDocNR = allNR.filter(r => r.docFound).length / allNR.length * 100
  const overallDocLR = allLR.filter(r => r.docFound).length / allLR.length * 100

  console.log('-'.repeat(85))
  console.log(
    `ALL  | ` +
    `${overallChunkNR.toFixed(0).padStart(15)}% | ` +
    `${overallChunkLR.toFixed(0).padStart(10)}% | ` +
    `${(overallChunkLR - overallChunkNR) > 0 ? '+' : ''}${(overallChunkLR - overallChunkNR).toFixed(0).padStart(10)}% | ` +
    `${overallDocNR.toFixed(0).padStart(13)}% | ` +
    `${overallDocLR.toFixed(0).padStart(8)}%`
  )

  // Latency analysis
  console.log('\n' + '='.repeat(80))
  console.log('LATENCY ANALYSIS')
  console.log('='.repeat(80))
  const avgLatencyNR = allNR.reduce((sum, r) => sum + r.responseTimeMs, 0) / allNR.length
  const avgLatencyLR = allLR.reduce((sum, r) => sum + r.responseTimeMs, 0) / allLR.length
  console.log(`Average latency (no rerank): ${avgLatencyNR.toFixed(0)}ms`)
  console.log(`Average latency (LLM rerank): ${avgLatencyLR.toFixed(0)}ms`)
  console.log(`Latency increase: +${(avgLatencyLR - avgLatencyNR).toFixed(0)}ms (+${((avgLatencyLR - avgLatencyNR) / avgLatencyNR * 100).toFixed(0)}%)`)

  // Rank improvement analysis
  console.log('\n' + '='.repeat(80))
  console.log('RANK IMPROVEMENT ANALYSIS')
  console.log('='.repeat(80))

  let rankImproved = 0
  let rankDegraded = 0
  let newlyFound = 0
  let newlyLost = 0

  for (const span of spans) {
    const nrResults = results.no_rerank[span] || []
    const lrResults = results.llm_rerank[span] || []

    for (let i = 0; i < nrResults.length; i++) {
      const nr = nrResults[i]
      const lr = lrResults[i]

      if (!nr.chunkFound && lr.chunkFound) {
        newlyFound++
      } else if (nr.chunkFound && !lr.chunkFound) {
        newlyLost++
      } else if (nr.chunkFound && lr.chunkFound) {
        if (lr.chunkRank! < nr.chunkRank!) rankImproved++
        else if (lr.chunkRank! > nr.chunkRank!) rankDegraded++
      }
    }
  }

  console.log(`Chunks newly found by reranking: ${newlyFound}`)
  console.log(`Chunks lost by reranking: ${newlyLost}`)
  console.log(`Rank improved (moved up): ${rankImproved}`)
  console.log(`Rank degraded (moved down): ${rankDegraded}`)
  console.log(`Net chunk improvement: ${newlyFound - newlyLost}`)

  // Recommendations
  console.log('\n' + '='.repeat(80))
  console.log('RECOMMENDATIONS')
  console.log('='.repeat(80))

  const chunkImprovement = overallChunkLR - overallChunkNR

  if (chunkImprovement > 5) {
    console.log(`✅ LLM reranking improves chunk retrieval by ${chunkImprovement.toFixed(0)}%`)
    console.log('   Recommendation: Enable LLM reranking in production')
    console.log(`   Trade-off: +${(avgLatencyLR - avgLatencyNR).toFixed(0)}ms latency, ~$0.001/query cost`)
  } else if (chunkImprovement > 0) {
    console.log(`⚠️  LLM reranking provides marginal improvement (+${chunkImprovement.toFixed(0)}%)`)
    console.log('   Consider: Use heuristic reranking (free, faster) instead')
  } else if (chunkImprovement < -5) {
    console.log(`❌ LLM reranking DEGRADES performance by ${Math.abs(chunkImprovement).toFixed(0)}%`)
    console.log('   Recommendation: Do NOT enable reranking')
  } else {
    console.log('ℹ️  LLM reranking shows no significant impact')
    console.log('   The issue may be in retrieval, not ranking')
  }

  console.log('\n=== TEST COMPLETE ===')
}

main().catch(console.error)
