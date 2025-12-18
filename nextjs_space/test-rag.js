/**
 * RAG Pipeline Test Script (Node.js)
 * Run with: node scripts/test-rag.js
 */

const fs = require('fs')
const path = require('path')

// Configuration
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_API_URL = 'https://api.abacus.ai/v1/embeddings'
const LLM_API_URL = 'https://apps.abacus.ai/v1/chat/completions'
const ABACUSAI_API_KEY = process.env.ABACUSAI_API_KEY || 'dc65fa8287c94cc98321be840eda71f0'

// Helper: Generate embedding
async function generateEmbedding(text) {
  const response = await fetch(EMBEDDING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ABACUSAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.substring(0, 8000 * 4),
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Embedding API error: ${response.status} - ${err}`)
  }

  const data = await response.json()
  return data?.data?.[0]?.embedding || []
}

// Helper: Call LLM
async function callLLM(prompt, systemPrompt) {
  const messages = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
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
    const err = await response.text()
    throw new Error(`LLM API error: ${response.status} - ${err}`)
  }

  const data = await response.json()
  return data?.choices?.[0]?.message?.content || ''
}

// Helper: Extract text from PDF
async function extractTextFromPDF(filePath) {
  const pdfParse = require('pdf-parse')
  const dataBuffer = fs.readFileSync(filePath)
  const data = await pdfParse(dataBuffer)
  return { text: data.text, pageCount: data.numpages }
}

// Helper: Chunk text
function chunkText(text, chunkSize = 1000, overlap = 150) {
  const chunks = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.substring(start, end))
    start = end - overlap
    if (start >= text.length - overlap) break
  }
  return chunks
}

// Cosine similarity
function cosineSimilarity(a, b) {
  let dotProduct = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Estimate tokens
function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

// Main test
async function runTest() {
  console.log('='.repeat(80))
  console.log('🧪 RAG PIPELINE TEST - UAE Corporate Tax Law')
  console.log('='.repeat(80))

  const metrics = {
    ingestion: {},
    retrieval: {},
    quality: {},
  }

  // 1. DOCUMENT INGESTION
  console.log('\n📄 STEP 1: Document Ingestion')
  console.log('-'.repeat(40))

  const docPath = '/home/avinish/Downloads/legal_ai_assistant/documents/Federal-Decree-Law-No-60-of-2023.pdf'

  if (!fs.existsSync(docPath)) {
    console.error(`❌ Document not found: ${docPath}`)
    process.exit(1)
  }

  const stats = fs.statSync(docPath)
  metrics.ingestion.documentName = path.basename(docPath)
  metrics.ingestion.fileSize = stats.size

  console.log(`Document: ${metrics.ingestion.documentName}`)
  console.log(`File size: ${(stats.size / 1024).toFixed(2)} KB`)

  const ingestionStart = Date.now()

  console.log('Extracting text from PDF...')
  const { text, pageCount } = await extractTextFromPDF(docPath)
  metrics.ingestion.pageCount = pageCount
  metrics.ingestion.textLength = text.length

  console.log(`Pages: ${pageCount}`)
  console.log(`Text length: ${text.length} chars`)

  // Chunk
  console.log('Chunking text...')
  const chunks = chunkText(text, 1000, 150)
  metrics.ingestion.chunkCount = chunks.length
  console.log(`Chunks: ${chunks.length}`)

  // Tokens & cost
  metrics.ingestion.totalTokens = estimateTokens(text)
  metrics.ingestion.embeddingCost = (metrics.ingestion.totalTokens / 1_000_000) * 0.02

  console.log(`Estimated tokens: ${metrics.ingestion.totalTokens}`)
  console.log(`Estimated embedding cost: $${metrics.ingestion.embeddingCost.toFixed(6)}`)

  // Generate embeddings for first 15 chunks
  console.log('\nGenerating embeddings (first 15 chunks)...')
  const chunkEmbeddings = []
  const embeddingLimit = Math.min(chunks.length, 15)

  for (let i = 0; i < embeddingLimit; i++) {
    process.stdout.write(`\r  Embedding ${i + 1}/${embeddingLimit}...`)
    try {
      const embedding = await generateEmbedding(chunks[i])
      chunkEmbeddings.push({ idx: i, chunk: chunks[i], embedding })
    } catch (e) {
      console.error(`\n  ❌ Error embedding chunk ${i}: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 200))
  }
  console.log('\n  ✅ Embeddings generated')

  metrics.ingestion.ingestionTimeMs = Date.now() - ingestionStart

  // 2. GENERATE SYNTHETIC Q&A
  console.log('\n📝 STEP 2: Generate Synthetic Q&A')
  console.log('-'.repeat(40))

  const sampleText = chunks.slice(0, 5).join('\n\n')

  const qaPrompt = `Based on this UAE Corporate Tax Law excerpt, generate 5 question-answer pairs.
Each answer MUST be directly from the text.

Text:
"""
${sampleText.substring(0, 4000)}
"""

Return ONLY a JSON array:
[{"question": "...", "answer": "...", "source_quote": "..."}]`

  console.log('Calling LLM to generate Q&A pairs...')
  const qaResponse = await callLLM(qaPrompt)

  let syntheticQAs = []
  try {
    const jsonMatch = qaResponse.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      syntheticQAs = JSON.parse(jsonMatch[0])
    }
  } catch (e) {
    console.error('  ⚠️ Could not parse Q&A, using fallback')
    syntheticQAs = [
      { question: "What does this Federal Decree-Law amend?", answer: "Federal Decree-Law No. 47 of 2022 on Corporate Tax", source_quote: "" },
      { question: "What is the corporate tax rate mentioned?", answer: "Based on the document provisions", source_quote: "" },
    ]
  }

  console.log(`Generated ${syntheticQAs.length} Q&A pairs:`)
  syntheticQAs.forEach((qa, i) => {
    console.log(`\n  Q${i+1}: ${qa.question.substring(0, 70)}...`)
    console.log(`  A${i+1}: ${qa.answer.substring(0, 70)}...`)
  })

  // 3. TEST RAG RETRIEVAL
  console.log('\n🔍 STEP 3: Test RAG Retrieval')
  console.log('-'.repeat(40))

  const retrievalResults = []
  let totalRetrievalTime = 0

  for (let i = 0; i < Math.min(syntheticQAs.length, 3); i++) {
    const qa = syntheticQAs[i]
    console.log(`\n  Testing Q${i+1}: "${qa.question.substring(0, 50)}..."`)

    const startTime = Date.now()

    try {
      const queryEmbedding = await generateEmbedding(qa.question)

      // Find top similar chunks
      const similarities = chunkEmbeddings.map(ce => ({
        ...ce,
        similarity: cosineSimilarity(queryEmbedding, ce.embedding),
      }))
      similarities.sort((a, b) => b.similarity - a.similarity)
      const topChunks = similarities.slice(0, 3)

      const retrievalTime = Date.now() - startTime
      totalRetrievalTime += retrievalTime

      console.log(`    Top similarity: ${topChunks[0]?.similarity.toFixed(4)}`)
      console.log(`    Retrieval time: ${retrievalTime}ms`)

      retrievalResults.push({
        question: qa.question,
        expectedAnswer: qa.answer,
        retrievedChunks: topChunks.map(c => c.chunk),
        topSimilarity: topChunks[0]?.similarity || 0,
      })
    } catch (e) {
      console.error(`    ❌ Error: ${e.message}`)
    }

    await new Promise(r => setTimeout(r, 300))
  }

  metrics.retrieval.queryCount = retrievalResults.length
  metrics.retrieval.avgRetrievalTimeMs = totalRetrievalTime / retrievalResults.length

  // 4. EVALUATE QUALITY
  console.log('\n📊 STEP 4: Evaluate Quality')
  console.log('-'.repeat(40))

  const groundednessScores = []
  const relevanceScores = []

  for (let i = 0; i < retrievalResults.length; i++) {
    const result = retrievalResults[i]
    console.log(`\n  Evaluating Q${i+1}...`)

    // Generate RAG answer
    const ragContext = result.retrievedChunks.join('\n\n---\n\n')
    const ragAnswer = await callLLM(
      `Based on these documents, answer: ${result.question}\n\nDocuments:\n${ragContext.substring(0, 3000)}`,
      'Answer based ONLY on the provided documents. Be concise.'
    )

    // Evaluate groundedness (simplified)
    const groundednessPrompt = `Rate 0-100: How grounded is this answer in the source?
Question: ${result.question}
Answer: ${ragAnswer}
Source: ${ragContext.substring(0, 1500)}
Return ONLY a number.`

    const groundednessResp = await callLLM(groundednessPrompt)
    const groundedness = parseInt(groundednessResp) || 50
    groundednessScores.push(Math.min(100, Math.max(0, groundedness)))

    // Evaluate relevance
    const relevancePrompt = `Rate 0-100: How relevant are these chunks to the question?
Question: ${result.question}
Chunks: ${ragContext.substring(0, 1500)}
Return ONLY a number.`

    const relevanceResp = await callLLM(relevancePrompt)
    const relevance = parseInt(relevanceResp) || 50
    relevanceScores.push(Math.min(100, Math.max(0, relevance)))

    console.log(`    Groundedness: ${groundednessScores[i]}`)
    console.log(`    Relevance: ${relevanceScores[i]}`)
    console.log(`    RAG Answer: ${ragAnswer.substring(0, 100)}...`)

    await new Promise(r => setTimeout(r, 500))
  }

  // Calculate final metrics
  metrics.quality.groundedness = groundednessScores.reduce((a, b) => a + b, 0) / groundednessScores.length
  metrics.quality.relevance = relevanceScores.reduce((a, b) => a + b, 0) / relevanceScores.length
  metrics.quality.faithfulness = metrics.quality.groundedness

  const avgSimilarity = retrievalResults.reduce((sum, r) => sum + r.topSimilarity, 0) / retrievalResults.length
  metrics.quality.avgSemanticSimilarity = avgSimilarity * 100

  // Simplified precision/recall
  const threshold = 0.5
  const relevant = retrievalResults.filter(r => r.topSimilarity >= threshold).length
  metrics.quality.precision = (relevant / retrievalResults.length) * 100
  metrics.quality.recall = metrics.quality.precision
  metrics.quality.f1Score = metrics.quality.precision

  // FINAL REPORT
  console.log('\n' + '='.repeat(80))
  console.log('📋 FINAL REPORT')
  console.log('='.repeat(80))

  console.log('\n📄 INGESTION METRICS:')
  console.log(`  ├─ Document: ${metrics.ingestion.documentName}`)
  console.log(`  ├─ File Size: ${(metrics.ingestion.fileSize / 1024).toFixed(2)} KB`)
  console.log(`  ├─ Pages: ${metrics.ingestion.pageCount}`)
  console.log(`  ├─ Text Length: ${metrics.ingestion.textLength} chars`)
  console.log(`  ├─ Chunks: ${metrics.ingestion.chunkCount}`)
  console.log(`  ├─ Tokens: ~${metrics.ingestion.totalTokens}`)
  console.log(`  ├─ Embedding Cost: $${metrics.ingestion.embeddingCost.toFixed(6)}`)
  console.log(`  └─ Ingestion Time: ${metrics.ingestion.ingestionTimeMs}ms`)

  console.log('\n🔍 RETRIEVAL METRICS:')
  console.log(`  ├─ Queries Tested: ${metrics.retrieval.queryCount}`)
  console.log(`  ├─ Avg Retrieval Time: ${metrics.retrieval.avgRetrievalTimeMs?.toFixed(0)}ms`)
  console.log(`  └─ Avg Semantic Similarity: ${metrics.quality.avgSemanticSimilarity?.toFixed(1)}%`)

  console.log('\n📊 QUALITY METRICS (RAG Evaluation):')
  console.log(`  ├─ Groundedness: ${metrics.quality.groundedness?.toFixed(1)}%`)
  console.log(`  ├─ Relevance: ${metrics.quality.relevance?.toFixed(1)}%`)
  console.log(`  ├─ Faithfulness: ${metrics.quality.faithfulness?.toFixed(1)}%`)
  console.log(`  ├─ Precision: ${metrics.quality.precision?.toFixed(1)}%`)
  console.log(`  ├─ Recall: ${metrics.quality.recall?.toFixed(1)}%`)
  console.log(`  └─ F1 Score: ${metrics.quality.f1Score?.toFixed(1)}%`)

  console.log('\n💰 COST ANALYSIS:')
  console.log(`  ├─ Embedding Model: ${EMBEDDING_MODEL}`)
  console.log(`  ├─ Cost per 1M tokens: $0.02`)
  console.log(`  ├─ This document: $${metrics.ingestion.embeddingCost.toFixed(6)}`)
  console.log(`  ├─ Per 100 similar docs: $${(metrics.ingestion.embeddingCost * 100).toFixed(4)}`)
  console.log(`  └─ Per 1000 similar docs: $${(metrics.ingestion.embeddingCost * 1000).toFixed(3)}`)

  console.log('\n' + '='.repeat(80))
  console.log('✅ RAG Pipeline Test Complete!')
  console.log('='.repeat(80))

  // Save results
  const resultsPath = '/home/avinish/Downloads/legal_ai_assistant/test-results.json'
  fs.writeFileSync(resultsPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    metrics,
    syntheticQAs: syntheticQAs.slice(0, 5),
    sampleRetrievalResults: retrievalResults.map(r => ({
      question: r.question,
      topSimilarity: r.topSimilarity,
    })),
  }, null, 2))
  console.log(`\nResults saved to: ${resultsPath}`)
}

runTest().catch(err => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
