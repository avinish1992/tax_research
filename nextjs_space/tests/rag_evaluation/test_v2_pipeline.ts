/**
 * RAG Pipeline V2 Evaluation Test (Self-contained)
 *
 * This script:
 * 1. Re-indexes the UAE Corporate Tax document using V2 pipeline
 * 2. Runs comprehensive evaluation against the Q&A dataset
 * 3. Compares metrics with baseline (V1)
 *
 * Run: npx tsx tests/rag_evaluation/test_v2_pipeline.ts
 * Skip re-index: npx tsx tests/rag_evaluation/test_v2_pipeline.ts --skip-reindex
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { extractText } from 'unpdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

// Load environment variables
import 'dotenv/config'

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Supabase
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,

  // OpenAI
  openaiKey: process.env.OPENAI_API_KEY!,
  embeddingModel: 'text-embedding-3-small',
  rerankModel: 'gpt-4o-mini',

  // Document
  documentId: '8f88fffd-77a6-4953-96ed-4b73ddbe05be',
  testUserId: '0c400d3b-2ebe-466a-8814-5411a24beae7',  // Actual user who owns the document

  // Chunking
  chunkSize: 1000,
  chunkOverlap: 150,

  // Search
  topK: 5,
  initialTopK: 15,  // For re-ranking
  enableReranking: true,
  semanticWeight: 0.6,
  keywordWeight: 0.4,
  rrfK: 60
}

// ============================================================================
// Types
// ============================================================================

interface PageText {
  pageNumber: number
  text: string
}

interface EnhancedChunk {
  content: string
  contextualHeader: string
  pageNumber: number
  chunkIndex: number
  section: any
  metadata: any
}

interface Question {
  id: string
  category: string
  difficulty: 'easy' | 'medium' | 'hard'
  question: string
  expected_answer: string
  expected_pages: number[]
  keywords: string[]
}

interface SearchResult {
  content: string
  fileName: string
  score: number
  chunkIndex: number
  pageNumber: number | null
  source: string
  metadata: any
}

interface EvaluationResult {
  questionId: string
  question: string
  difficulty: string
  category: string
  retrievedPages: number[]
  expectedPages: number[]
  pageHit: boolean
  pageAccuracy: number
  keywordsFound: string[]
  keywordRecall: number
  topResultScore: number
  firstRelevantRank: number | null
  reciprocalRank: number
  searchTimeMs: number
}

// ============================================================================
// Supabase Client
// ============================================================================

const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey)

// ============================================================================
// Section Detection
// ============================================================================

const SECTION_PATTERNS = {
  article: /^(?:Article|ARTICLE)\s+(\d+)[\s:\-]*(.*)$/m,
  chapter: /^(?:Chapter|CHAPTER)\s+(\d+)[\s:\-]*(.*)$/m,
  section: /^(?:Section|SECTION)\s+(\d+(?:\.\d+)?)[\s:\-]*(.*)$/m,
}

function detectSection(text: string, previousHierarchy: string[] = []) {
  const firstLine = text.split('\n')[0].trim()

  for (const [type, pattern] of Object.entries(SECTION_PATTERNS)) {
    const match = firstLine.match(pattern)
    if (match) {
      const number = match[1] || null
      const title = match[2]?.trim() || null
      const hierarchy = [...previousHierarchy]
      const label = `${type.charAt(0).toUpperCase() + type.slice(1)} ${number || ''}`.trim()

      if (type === 'chapter') {
        hierarchy.length = 0
        hierarchy.push(label)
      } else if (type === 'article') {
        while (hierarchy.length > 1) hierarchy.pop()
        hierarchy.push(label)
      } else {
        hierarchy.push(label)
      }

      return { type, number, title, hierarchy }
    }
  }
  return null
}

function generateContextualHeader(section: any, pageNumber: number, documentTitle: string): string {
  const parts = [`Document: ${documentTitle}`, `Page: ${pageNumber}`]
  if (section?.hierarchy?.length > 0) {
    parts.push(`Location: ${section.hierarchy.join(' > ')}`)
  }
  return parts.join(' | ')
}

// ============================================================================
// PDF Extraction & Chunking
// ============================================================================

async function extractAndChunkPDF(buffer: Buffer, documentTitle: string): Promise<EnhancedChunk[]> {
  console.log('\n📄 Extracting text from PDF...')

  const uint8Array = new Uint8Array(buffer)
  const { text, totalPages } = await extractText(uint8Array, { mergePages: false })

  const pages: PageText[] = []
  if (Array.isArray(text)) {
    text.forEach((pageText, index) => {
      if (pageText?.trim()) {
        pages.push({ pageNumber: index + 1, text: pageText.trim() })
      }
    })
  }

  console.log(`✓ Extracted ${pages.length}/${totalPages} pages`)

  // Chunk with semantic awareness
  console.log('\n✂️ Chunking with semantic awareness...')

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CONFIG.chunkSize,
    chunkOverlap: CONFIG.chunkOverlap,
    separators: ['\n\nArticle', '\n\nChapter', '\n\n\n', '\n\n', '\n', '. ', ' ', ''],
  })

  const chunks: EnhancedChunk[] = []
  let globalIndex = 0
  let currentHierarchy: string[] = []

  for (const page of pages) {
    const pageChunks = await splitter.splitText(page.text)

    for (const content of pageChunks) {
      if (content.length < 100) continue

      const section = detectSection(content, currentHierarchy)
      if (section) currentHierarchy = section.hierarchy

      const contextualHeader = generateContextualHeader(
        section || { hierarchy: currentHierarchy },
        page.pageNumber,
        documentTitle
      )

      chunks.push({
        content,
        contextualHeader,
        pageNumber: page.pageNumber,
        chunkIndex: globalIndex++,
        section: section || { hierarchy: [...currentHierarchy] },
        metadata: {
          charCount: content.length,
          wordCount: content.split(/\s+/).length,
          hasDefinition: /[""][^""]+[""]\s+(?:means|shall mean)/i.test(content),
          hasReference: /(?:Article|Section|Chapter)\s+\d+/i.test(content),
        }
      })
    }
  }

  console.log(`✓ Created ${chunks.length} chunks`)
  return chunks
}

// ============================================================================
// Embedding Generation
// ============================================================================

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.openaiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.embeddingModel,
      input: text.substring(0, 8000 * 4),  // Truncate if too long
    }),
  })

  if (!response.ok) {
    throw new Error(`Embedding error: ${await response.text()}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

// ============================================================================
// Query Expansion
// ============================================================================

function expandLegalQuery(query: string): string {
  let expanded = query

  // Chapter/Article cross-reference
  const chapterMatches = [...query.matchAll(/chapter\s+(\d+)/gi)]
  chapterMatches.forEach(m => { expanded += ` Article ${m[1]}` })

  const articleMatches = [...query.matchAll(/article\s+(\d+)/gi)]
  articleMatches.forEach(m => { expanded += ` Chapter ${m[1]}` })

  return expanded
}

// ============================================================================
// Re-ranking
// ============================================================================

async function rerankResults(query: string, results: SearchResult[]): Promise<SearchResult[]> {
  if (results.length <= CONFIG.topK || !CONFIG.enableReranking) {
    return results.slice(0, CONFIG.topK)
  }

  console.log(`   🔄 Re-ranking ${results.length} results...`)

  const prompt = `Score each document's relevance to the query (0-10). Return ONLY a JSON array of numbers.

Query: "${query}"

Documents:
${results.map((r, i) => `[${i}] ${r.content.substring(0, 300)}...`).join('\n\n')}

Return: [score1, score2, ...]`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.openaiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.rerankModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    })

    if (!response.ok) throw new Error('Re-rank failed')

    const data = await response.json()
    const scoresText = data.choices[0]?.message?.content?.trim()
    const scores = JSON.parse(scoresText) as number[]

    if (scores.length !== results.length) {
      return results.slice(0, CONFIG.topK)
    }

    const reranked = results.map((r, i) => ({ ...r, score: scores[i] / 10 }))
    reranked.sort((a, b) => b.score - a.score)

    return reranked.slice(0, CONFIG.topK)
  } catch (e) {
    console.log(`   ⚠️ Re-ranking failed, using original order`)
    return results.slice(0, CONFIG.topK)
  }
}

// ============================================================================
// Hybrid Search
// ============================================================================

async function hybridSearch(query: string, userId: string): Promise<SearchResult[]> {
  const expandedQuery = expandLegalQuery(query)
  const embedding = await generateEmbedding(expandedQuery)

  const { data, error } = await supabase.rpc('hybrid_search', {
    query_text: expandedQuery,
    query_embedding: JSON.stringify(embedding),
    p_user_id: userId,
    match_count: CONFIG.initialTopK,
    semantic_weight: CONFIG.semanticWeight,
    keyword_weight: CONFIG.keywordWeight,
    rrf_k: CONFIG.rrfK
  })

  if (error) {
    // Fallback to semantic search
    const { data: semanticData } = await supabase.rpc('semantic_search', {
      query_embedding: JSON.stringify(embedding),
      p_user_id: userId,
      match_count: CONFIG.initialTopK,
      min_similarity: 0.3
    })

    return (semanticData || []).map((r: any) => ({
      content: r.content,
      fileName: r.file_name,
      score: r.similarity,
      chunkIndex: r.chunk_index,
      pageNumber: r.page_number,
      source: 'semantic',
      metadata: r.metadata
    }))
  }

  let results: SearchResult[] = (data || []).map((r: any) => ({
    content: r.content,
    fileName: r.file_name,
    score: r.rrf_score,
    chunkIndex: r.chunk_index,
    pageNumber: r.page_number,
    source: r.search_type,
    metadata: r.metadata
  }))

  // Re-rank
  if (CONFIG.enableReranking && results.length > CONFIG.topK) {
    results = await rerankResults(query, results)
  }

  return results.slice(0, CONFIG.topK)
}

// ============================================================================
// Re-indexing
// ============================================================================

async function reindexDocument(): Promise<{ chunks: number; timeMs: number }> {
  console.log('\n' + '='.repeat(60))
  console.log('📚 RE-INDEXING WITH V2 PIPELINE')
  console.log('='.repeat(60))

  const startTime = Date.now()

  // Get document - use maybeSingle to handle RLS
  const { data: docs, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', CONFIG.documentId)

  if (docError) {
    throw new Error(`Document query error: ${docError.message}`)
  }

  const doc = docs?.[0]
  if (!doc) {
    throw new Error(`Document not found with id: ${CONFIG.documentId}`)
  }

  console.log(`\nDocument: ${doc.file_name}`)

  // Download PDF
  console.log('📥 Downloading PDF...')
  const { data: fileData, error: dlError } = await supabase
    .storage.from('documents').download(doc.storage_path)

  if (dlError || !fileData) {
    throw new Error(`Download failed: ${dlError?.message}`)
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  console.log(`✓ Downloaded ${Math.round(buffer.length / 1024)}KB`)

  // Delete existing chunks
  console.log('\n🗑️ Deleting existing chunks...')
  await supabase.from('document_chunks').delete().eq('document_id', CONFIG.documentId)

  // Extract and chunk
  const chunks = await extractAndChunkPDF(buffer, doc.file_name)

  // Generate embeddings and store
  console.log(`\n🔮 Generating embeddings and storing ${chunks.length} chunks...`)

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const textForEmbedding = `${chunk.contextualHeader}\n\n${chunk.content}`
    const embedding = await generateEmbedding(textForEmbedding)

    await supabase.from('document_chunks').insert({
      document_id: CONFIG.documentId,
      content: chunk.content,
      embedding: JSON.stringify(embedding),
      chunk_index: chunk.chunkIndex,
      page_number: chunk.pageNumber,
      metadata: {
        contextual_header: chunk.contextualHeader,
        section: chunk.section,
        ...chunk.metadata
      }
    })

    if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
      process.stdout.write(`\r   Progress: ${i + 1}/${chunks.length}`)
    }
  }

  // Update document
  await supabase.from('documents').update({
    status: 'completed',
    chunk_count: chunks.length,
    processed_at: new Date().toISOString()
  }).eq('id', CONFIG.documentId)

  const elapsed = Date.now() - startTime
  console.log(`\n✓ Re-indexed ${chunks.length} chunks in ${elapsed}ms`)

  return { chunks: chunks.length, timeMs: elapsed }
}

// ============================================================================
// Evaluation
// ============================================================================

async function evaluateQuestion(q: Question): Promise<EvaluationResult> {
  const startTime = Date.now()

  const results = await hybridSearch(q.question, CONFIG.testUserId)
  const searchTime = Date.now() - startTime

  const retrievedPages = [...new Set(results.map(r => r.pageNumber).filter(p => p !== null))] as number[]
  const pageHit = retrievedPages.some(p => q.expected_pages.includes(p))
  const correctPages = retrievedPages.filter(p => q.expected_pages.includes(p))
  const pageAccuracy = retrievedPages.length > 0 ? correctPages.length / retrievedPages.length : 0

  const allContent = results.map(r => r.content.toLowerCase()).join(' ')
  const keywordsFound = q.keywords.filter(k => allContent.includes(k.toLowerCase()))
  const keywordRecall = keywordsFound.length / q.keywords.length

  let firstRelevantRank: number | null = null
  for (let i = 0; i < results.length; i++) {
    if (results[i].pageNumber && q.expected_pages.includes(results[i].pageNumber!)) {
      firstRelevantRank = i + 1
      break
    }
  }

  return {
    questionId: q.id,
    question: q.question,
    difficulty: q.difficulty,
    category: q.category,
    retrievedPages,
    expectedPages: q.expected_pages,
    pageHit,
    pageAccuracy,
    keywordsFound,
    keywordRecall,
    topResultScore: results[0]?.score || 0,
    firstRelevantRank,
    reciprocalRank: firstRelevantRank ? 1 / firstRelevantRank : 0,
    searchTimeMs: searchTime
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(70))
  console.log('🧪 RAG PIPELINE V2 EVALUATION')
  console.log('='.repeat(70))

  // Re-index unless skipped
  if (!process.argv.includes('--skip-reindex')) {
    await reindexDocument()
  } else {
    console.log('\n⏭️ Skipping re-indexing')
  }

  // Load dataset
  const datasetPath = path.join(__dirname, 'datasets/uae_corporate_tax_qa.json')
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'))
  const questions: Question[] = dataset.questions

  console.log(`\n📝 Evaluating ${questions.length} questions...`)

  // Evaluate
  const results: EvaluationResult[] = []

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    console.log(`\n[${i + 1}/${questions.length}] ${q.question.substring(0, 50)}...`)

    try {
      const result = await evaluateQuestion(q)
      results.push(result)

      console.log(`   ✓ Pages: ${result.retrievedPages.join(',')} (exp: ${result.expectedPages.join(',')}) | Hit: ${result.pageHit ? 'YES' : 'NO'}`)
      console.log(`   ✓ Keywords: ${(result.keywordRecall * 100).toFixed(0)}% | MRR: ${result.reciprocalRank.toFixed(2)} | ${result.searchTimeMs}ms`)
    } catch (e) {
      console.log(`   ❌ Error: ${e}`)
    }
  }

  // Calculate metrics
  const hitRate = results.filter(r => r.pageHit).length / results.length
  const avgPageAccuracy = results.reduce((s, r) => s + r.pageAccuracy, 0) / results.length
  const avgKeywordRecall = results.reduce((s, r) => s + r.keywordRecall, 0) / results.length
  const mrr = results.reduce((s, r) => s + r.reciprocalRank, 0) / results.length
  const f1 = avgPageAccuracy + avgKeywordRecall > 0
    ? 2 * (avgPageAccuracy * avgKeywordRecall) / (avgPageAccuracy + avgKeywordRecall) : 0

  const times = results.map(r => r.searchTimeMs).sort((a, b) => a - b)
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length
  const p95Time = times[Math.floor(times.length * 0.95)]

  // Print results
  console.log('\n' + '='.repeat(70))
  console.log('📊 V2 PIPELINE RESULTS')
  console.log('='.repeat(70))

  console.log(`\n📈 Retrieval Metrics:`)
  console.log(`   Hit Rate:       ${(hitRate * 100).toFixed(1)}%`)
  console.log(`   Page Accuracy:  ${(avgPageAccuracy * 100).toFixed(1)}%`)
  console.log(`   Keyword Recall: ${(avgKeywordRecall * 100).toFixed(1)}%`)
  console.log(`   F1 Score:       ${(f1 * 100).toFixed(1)}%`)
  console.log(`   MRR:            ${mrr.toFixed(3)}`)

  console.log(`\n⏱️ Timing:`)
  console.log(`   Avg Time:       ${avgTime.toFixed(0)}ms`)
  console.log(`   P95 Time:       ${p95Time.toFixed(0)}ms`)

  // Baseline comparison
  const baseline = {
    hitRate: 1.0,
    pageAccuracy: 0.287,
    recall: 0.710,
    mrr: 0.943,
    avgTime: 1783
  }

  console.log('\n📊 vs Baseline (V1):')
  console.log(`   Hit Rate:       ${(hitRate * 100).toFixed(1)}% vs ${(baseline.hitRate * 100).toFixed(1)}%`)
  console.log(`   Page Accuracy:  ${(avgPageAccuracy * 100).toFixed(1)}% vs ${(baseline.pageAccuracy * 100).toFixed(1)}% ${avgPageAccuracy > baseline.pageAccuracy ? '📈' : '📉'}`)
  console.log(`   Recall:         ${(avgKeywordRecall * 100).toFixed(1)}% vs ${(baseline.recall * 100).toFixed(1)}% ${avgKeywordRecall > baseline.recall ? '📈' : '📉'}`)
  console.log(`   MRR:            ${mrr.toFixed(3)} vs ${baseline.mrr.toFixed(3)} ${mrr > baseline.mrr ? '📈' : '📉'}`)
  console.log(`   Avg Time:       ${avgTime.toFixed(0)}ms vs ${baseline.avgTime}ms ${avgTime < baseline.avgTime ? '📈' : '📉'}`)

  // Save report
  const reportPath = path.join(__dirname, 'reports/v2_evaluation_results.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    pipeline: 'v2',
    metrics: { hitRate, pageAccuracy: avgPageAccuracy, keywordRecall: avgKeywordRecall, f1, mrr, avgTime, p95Time },
    baseline,
    results
  }, null, 2))

  console.log(`\n💾 Saved: ${reportPath}`)
  console.log('\n✅ EVALUATION COMPLETE')
}

main().catch(console.error)
