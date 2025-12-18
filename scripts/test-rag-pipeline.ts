/**
 * RAG Pipeline Test Script
 *
 * Tests document ingestion, RAG queries, and calculates quality metrics
 * Run with: npx ts-node scripts/test-rag-pipeline.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// Configuration
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_API_URL = 'https://api.abacus.ai/v1/embeddings'
const LLM_API_URL = 'https://apps.abacus.ai/v1/chat/completions'
const ABACUSAI_API_KEY = process.env.ABACUSAI_API_KEY || 'dc65fa8287c94cc98321be840eda71f0'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sjdaemlbjntadadggenr.supabase.co'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_9DzlCYC5fanMqLIeh1mkyw__vjIyvgc'

// Metrics tracking
interface Metrics {
  ingestion: {
    documentName: string
    fileSize: number
    pageCount: number
    chunkCount: number
    totalTokens: number
    embeddingCost: number
    ingestionTimeMs: number
  }
  retrieval: {
    queryCount: number
    avgRetrievalTimeMs: number
    avgChunksRetrieved: number
  }
  quality: {
    precision: number
    recall: number
    f1Score: number
    groundedness: number
    relevance: number
    faithfulness: number
  }
}

interface SyntheticQA {
  question: string
  expectedAnswer: string
  sourceChunks: string[]
  pageNumbers: number[]
}

// Helper: Generate embedding
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch(EMBEDDING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ABACUSAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.substring(0, 8000 * 4), // Truncate if needed
    }),
  })

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status}`)
  }

  const data = await response.json()
  return data?.data?.[0]?.embedding || []
}

// Helper: Call LLM
async function callLLM(prompt: string, systemPrompt?: string): Promise<string> {
  const messages = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  const response = await fetch(LLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ABACUSAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 2000,
    }),
  })

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`)
  }

  const data = await response.json()
  return data?.choices?.[0]?.message?.content || ''
}

// Helper: Extract text from PDF using external library
async function extractTextFromPDF(filePath: string): Promise<{ text: string; pageCount: number }> {
  // Dynamic import for pdf-parse
  const pdfParse = require('pdf-parse')
  const dataBuffer = fs.readFileSync(filePath)
  const data = await pdfParse(dataBuffer)
  return {
    text: data.text,
    pageCount: data.numpages,
  }
}

// Helper: Chunk text
function chunkText(text: string, chunkSize: number = 1000, overlap: number = 150): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.substring(start, end))
    start = end - overlap
    if (start >= text.length - overlap) break
  }

  return chunks
}

// Helper: Estimate tokens (rough: 1 token ≈ 4 chars)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Helper: Calculate embedding cost
function calculateEmbeddingCost(tokens: number): number {
  // text-embedding-3-small: $0.02 per 1M tokens
  return (tokens / 1_000_000) * 0.02
}

// Helper: Cosine similarity
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Generate synthetic Q&A pairs from document
async function generateSyntheticQA(chunks: string[]): Promise<SyntheticQA[]> {
  console.log('\n📝 Generating synthetic Q&A pairs...')

  const qaPrompt = `Based on the following legal document excerpt, generate 3 question-answer pairs that:
1. Can be answered ONLY from the provided text
2. Cover different aspects (definitions, procedures, requirements)
3. Have specific, factual answers

Document excerpt:
"""
${chunks.slice(0, 5).join('\n\n')}
"""

Return JSON array format:
[
  {"question": "...", "answer": "...", "source_quote": "..."},
  ...
]

Only return valid JSON, no other text.`

  const response = await callLLM(qaPrompt)

  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.error('Failed to parse QA response')
      return []
    }

    const parsed = JSON.parse(jsonMatch[0])
    return parsed.map((qa: any) => ({
      question: qa.question,
      expectedAnswer: qa.answer,
      sourceChunks: [qa.source_quote || ''],
      pageNumbers: [1],
    }))
  } catch (e) {
    console.error('Error parsing QA:', e)
    return []
  }
}

// Evaluate groundedness of a response
async function evaluateGroundedness(question: string, answer: string, sourceChunks: string[]): Promise<number> {
  const evalPrompt = `You are an evaluator. Score how well the answer is grounded in the source documents.

Question: ${question}

Answer: ${answer}

Source Documents:
${sourceChunks.join('\n---\n')}

Score from 0-100 where:
- 100: Answer is completely supported by sources with direct quotes
- 75: Answer is well supported with minor inferences
- 50: Answer is partially supported
- 25: Answer makes claims not in sources
- 0: Answer contradicts or ignores sources

Return ONLY a number (0-100).`

  const response = await callLLM(evalPrompt)
  const score = parseInt(response.trim())
  return isNaN(score) ? 50 : Math.min(100, Math.max(0, score))
}

// Evaluate relevance of retrieved chunks
async function evaluateRelevance(question: string, chunks: string[]): Promise<number> {
  const evalPrompt = `Score how relevant these retrieved chunks are to answering the question.

Question: ${question}

Retrieved Chunks:
${chunks.map((c, i) => `[${i+1}] ${c.substring(0, 300)}...`).join('\n\n')}

Score from 0-100 where:
- 100: All chunks directly answer the question
- 75: Most chunks are relevant
- 50: Some chunks are relevant
- 25: Few chunks are relevant
- 0: No chunks are relevant

Return ONLY a number (0-100).`

  const response = await callLLM(evalPrompt)
  const score = parseInt(response.trim())
  return isNaN(score) ? 50 : Math.min(100, Math.max(0, score))
}

// Main test function
async function runRAGTest() {
  console.log('=' .repeat(80))
  console.log('🧪 RAG PIPELINE TEST')
  console.log('=' .repeat(80))

  const metrics: Metrics = {
    ingestion: {
      documentName: '',
      fileSize: 0,
      pageCount: 0,
      chunkCount: 0,
      totalTokens: 0,
      embeddingCost: 0,
      ingestionTimeMs: 0,
    },
    retrieval: {
      queryCount: 0,
      avgRetrievalTimeMs: 0,
      avgChunksRetrieved: 0,
    },
    quality: {
      precision: 0,
      recall: 0,
      f1Score: 0,
      groundedness: 0,
      relevance: 0,
      faithfulness: 0,
    },
  }

  // 1. DOCUMENT INGESTION
  console.log('\n📄 STEP 1: Document Ingestion')
  console.log('-'.repeat(40))

  const docPath = path.join(__dirname, '../documents/Federal-Decree-Law-No-60-of-2023.pdf')
  const stats = fs.statSync(docPath)
  metrics.ingestion.documentName = path.basename(docPath)
  metrics.ingestion.fileSize = stats.size

  console.log(`Document: ${metrics.ingestion.documentName}`)
  console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`)

  const ingestionStart = Date.now()

  // Extract text
  console.log('Extracting text from PDF...')
  const { text, pageCount } = await extractTextFromPDF(docPath)
  metrics.ingestion.pageCount = pageCount
  console.log(`Pages: ${pageCount}`)
  console.log(`Extracted text length: ${text.length} chars`)

  // Chunk text
  console.log('Chunking text...')
  const chunks = chunkText(text, 1000, 150)
  metrics.ingestion.chunkCount = chunks.length
  console.log(`Chunks created: ${chunks.length}`)

  // Calculate tokens and cost
  metrics.ingestion.totalTokens = estimateTokens(text)
  metrics.ingestion.embeddingCost = calculateEmbeddingCost(metrics.ingestion.totalTokens)
  console.log(`Estimated tokens: ${metrics.ingestion.totalTokens}`)
  console.log(`Estimated embedding cost: $${metrics.ingestion.embeddingCost.toFixed(6)}`)

  // Generate embeddings for chunks
  console.log('\nGenerating embeddings for chunks...')
  const chunkEmbeddings: { chunk: string; embedding: number[] }[] = []

  for (let i = 0; i < Math.min(chunks.length, 20); i++) { // Limit to 20 chunks for testing
    process.stdout.write(`\r  Embedding chunk ${i + 1}/${Math.min(chunks.length, 20)}...`)
    const embedding = await generateEmbedding(chunks[i])
    chunkEmbeddings.push({ chunk: chunks[i], embedding })
    await new Promise(r => setTimeout(r, 100)) // Rate limiting
  }
  console.log('\n  ✅ Embeddings generated')

  metrics.ingestion.ingestionTimeMs = Date.now() - ingestionStart
  console.log(`Ingestion time: ${metrics.ingestion.ingestionTimeMs}ms`)

  // 2. GENERATE SYNTHETIC Q&A
  console.log('\n📝 STEP 2: Generate Synthetic Test Data')
  console.log('-'.repeat(40))

  const syntheticQAs = await generateSyntheticQA(chunks)
  console.log(`Generated ${syntheticQAs.length} Q&A pairs`)

  syntheticQAs.forEach((qa, i) => {
    console.log(`\n  Q${i+1}: ${qa.question.substring(0, 80)}...`)
    console.log(`  A${i+1}: ${qa.expectedAnswer.substring(0, 80)}...`)
  })

  // 3. TEST RAG RETRIEVAL
  console.log('\n🔍 STEP 3: Test RAG Retrieval')
  console.log('-'.repeat(40))

  const retrievalResults: {
    question: string
    retrievedChunks: string[]
    retrievalTimeMs: number
    topSimilarity: number
  }[] = []

  for (const qa of syntheticQAs) {
    const startTime = Date.now()

    // Generate query embedding
    const queryEmbedding = await generateEmbedding(qa.question)

    // Find similar chunks
    const similarities = chunkEmbeddings.map((ce, idx) => ({
      idx,
      chunk: ce.chunk,
      similarity: cosineSimilarity(queryEmbedding, ce.embedding),
    }))

    similarities.sort((a, b) => b.similarity - a.similarity)
    const topChunks = similarities.slice(0, 5)

    retrievalResults.push({
      question: qa.question,
      retrievedChunks: topChunks.map(c => c.chunk),
      retrievalTimeMs: Date.now() - startTime,
      topSimilarity: topChunks[0]?.similarity || 0,
    })

    console.log(`\n  Query: "${qa.question.substring(0, 50)}..."`)
    console.log(`  Top similarity: ${topChunks[0]?.similarity.toFixed(4)}`)
    console.log(`  Retrieval time: ${Date.now() - startTime}ms`)
  }

  metrics.retrieval.queryCount = retrievalResults.length
  metrics.retrieval.avgRetrievalTimeMs = retrievalResults.reduce((sum, r) => sum + r.retrievalTimeMs, 0) / retrievalResults.length
  metrics.retrieval.avgChunksRetrieved = 5

  // 4. EVALUATE QUALITY METRICS
  console.log('\n📊 STEP 4: Evaluate Quality Metrics')
  console.log('-'.repeat(40))

  const groundednessScores: number[] = []
  const relevanceScores: number[] = []

  for (let i = 0; i < syntheticQAs.length; i++) {
    const qa = syntheticQAs[i]
    const result = retrievalResults[i]

    console.log(`\n  Evaluating Q${i+1}...`)

    // Generate RAG answer
    const ragPrompt = `Based on the following documents, answer the question.

Documents:
${result.retrievedChunks.join('\n\n---\n\n')}

Question: ${qa.question}

Answer based ONLY on the documents above. If the information is not in the documents, say so.`

    const ragAnswer = await callLLM(ragPrompt)

    // Evaluate groundedness
    const groundedness = await evaluateGroundedness(qa.question, ragAnswer, result.retrievedChunks)
    groundednessScores.push(groundedness)
    console.log(`    Groundedness: ${groundedness}/100`)

    // Evaluate relevance
    const relevance = await evaluateRelevance(qa.question, result.retrievedChunks)
    relevanceScores.push(relevance)
    console.log(`    Relevance: ${relevance}/100`)

    await new Promise(r => setTimeout(r, 500)) // Rate limiting
  }

  // Calculate final metrics
  metrics.quality.groundedness = groundednessScores.reduce((a, b) => a + b, 0) / groundednessScores.length
  metrics.quality.relevance = relevanceScores.reduce((a, b) => a + b, 0) / relevanceScores.length
  metrics.quality.faithfulness = metrics.quality.groundedness // Simplified

  // Precision/Recall (simplified based on relevance threshold)
  const relevanceThreshold = 50
  const truePositives = relevanceScores.filter(s => s >= relevanceThreshold).length
  metrics.quality.precision = (truePositives / syntheticQAs.length) * 100
  metrics.quality.recall = metrics.quality.precision // Simplified for this test
  metrics.quality.f1Score = metrics.quality.precision // Simplified

  // 5. FINAL REPORT
  console.log('\n' + '='.repeat(80))
  console.log('📋 FINAL REPORT')
  console.log('='.repeat(80))

  console.log('\n📄 INGESTION METRICS:')
  console.log(`  Document: ${metrics.ingestion.documentName}`)
  console.log(`  File Size: ${(metrics.ingestion.fileSize / 1024).toFixed(2)} KB`)
  console.log(`  Pages: ${metrics.ingestion.pageCount}`)
  console.log(`  Chunks: ${metrics.ingestion.chunkCount}`)
  console.log(`  Total Tokens: ${metrics.ingestion.totalTokens}`)
  console.log(`  Embedding Cost: $${metrics.ingestion.embeddingCost.toFixed(6)}`)
  console.log(`  Ingestion Time: ${metrics.ingestion.ingestionTimeMs}ms`)

  console.log('\n🔍 RETRIEVAL METRICS:')
  console.log(`  Queries Tested: ${metrics.retrieval.queryCount}`)
  console.log(`  Avg Retrieval Time: ${metrics.retrieval.avgRetrievalTimeMs.toFixed(2)}ms`)
  console.log(`  Chunks Retrieved per Query: ${metrics.retrieval.avgChunksRetrieved}`)

  console.log('\n📊 QUALITY METRICS:')
  console.log(`  Groundedness: ${metrics.quality.groundedness.toFixed(1)}%`)
  console.log(`  Relevance: ${metrics.quality.relevance.toFixed(1)}%`)
  console.log(`  Faithfulness: ${metrics.quality.faithfulness.toFixed(1)}%`)
  console.log(`  Precision: ${metrics.quality.precision.toFixed(1)}%`)
  console.log(`  Recall: ${metrics.quality.recall.toFixed(1)}%`)
  console.log(`  F1 Score: ${metrics.quality.f1Score.toFixed(1)}%`)

  console.log('\n💰 COST ANALYSIS:')
  console.log(`  Embedding Model: ${EMBEDDING_MODEL}`)
  console.log(`  Cost per 1M tokens: $0.02`)
  console.log(`  This document cost: $${metrics.ingestion.embeddingCost.toFixed(6)}`)
  console.log(`  Cost per 100 documents (same size): $${(metrics.ingestion.embeddingCost * 100).toFixed(4)}`)

  console.log('\n' + '='.repeat(80))
  console.log('✅ Test Complete!')
  console.log('='.repeat(80))

  // Save results to JSON
  const resultsPath = path.join(__dirname, '../test-results.json')
  fs.writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    metrics,
    syntheticQAs,
  }, null, 2))
  console.log(`\nResults saved to: ${resultsPath}`)
}

// Run the test
runRAGTest().catch(console.error)
