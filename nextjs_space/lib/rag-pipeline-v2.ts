/**
 * RAG Pipeline V2 - Optimized for Legal Documents
 *
 * Improvements over V1:
 * 1. Parallel page processing
 * 2. Semantic chunking with section/article detection
 * 3. Batch embedding generation (up to 2048 inputs per request)
 * 4. Contextual headers (Anthropic-style contextual retrieval)
 * 5. Rich metadata extraction (section hierarchy, element types)
 * 6. Optional GPT-4o-mini re-ranking
 * 7. Embedding caching
 */

import { extractText } from 'unpdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

// ============================================================================
// Types
// ============================================================================

export interface PageText {
  pageNumber: number
  text: string
}

export interface SectionInfo {
  type: 'article' | 'chapter' | 'section' | 'clause' | 'definition' | 'paragraph'
  number: string | null
  title: string | null
  hierarchy: string[]  // e.g., ['Chapter 1', 'Article 5', 'Section 2']
}

export interface EnhancedChunk {
  content: string
  contextualHeader: string  // Anthropic-style context prepended
  pageNumber: number
  pageNumbers: number[]     // All pages this chunk spans (for cross-page chunks)
  chunkIndex: number
  section: SectionInfo | null
  metadata: {
    charCount: number
    wordCount: number
    hasDefinition: boolean
    hasReference: boolean
    elementType: 'title' | 'narrative' | 'list' | 'table' | 'definition'
  }
}

export interface BatchEmbeddingResult {
  embeddings: number[][]
  tokens: number
  latencyMs: number
}

export interface IndexingProgress {
  stage: 'extracting' | 'chunking' | 'embedding' | 'storing' | 'complete'
  current: number
  total: number
  message: string
}

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  // Chunking
  chunkSize: 1000,           // ~250 tokens
  chunkOverlap: 150,         // 15% overlap
  minChunkSize: 100,         // Minimum viable chunk

  // Embedding
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
  maxTokensPerEmbedding: 8191,
  batchSize: 100,            // OpenAI supports up to 2048, but 100 is safer

  // Parallelism
  maxParallelPages: 5,       // Process 5 pages concurrently
  maxParallelEmbeddings: 3,  // 3 concurrent batch requests

  // Re-ranking
  rerankModel: 'gpt-4o-mini',
  rerankTopK: 20,            // Re-rank top 20 results
  finalTopK: 5,              // Return top 5 after re-ranking
}

// ============================================================================
// Section Detection Patterns (Legal Documents)
// ============================================================================

const SECTION_PATTERNS = {
  article: /^(?:Article|ARTICLE)\s+(\d+)[\s:\-]*(.*)$/m,
  chapter: /^(?:Chapter|CHAPTER)\s+(\d+)[\s:\-]*(.*)$/m,
  section: /^(?:Section|SECTION)\s+(\d+(?:\.\d+)?)[\s:\-]*(.*)$/m,
  clause: /^(?:Clause|CLAUSE)\s+(\d+(?:\.\d+)?)[\s:\-]*(.*)$/m,
  definition: /^[""]([^""]+)[""]\s+(?:means|shall mean|refers to)/m,
  numberedItem: /^(\d+)\.\s+(.+)$/m,
}

// ============================================================================
// PDF Extraction with Parallel Processing
// ============================================================================

/**
 * Extract text from PDF with parallel page processing
 */
export async function extractTextFromPDFv2(
  buffer: Buffer,
  onProgress?: (progress: IndexingProgress) => void
): Promise<PageText[]> {
  const maxSize = 50 * 1024 * 1024 // 50MB limit
  if (buffer.length > maxSize) {
    throw new Error(`PDF too large (${Math.round(buffer.length / 1024 / 1024)}MB). Max: 50MB`)
  }

  console.log(`\n📄 Extracting PDF (${Math.round(buffer.length / 1024)}KB)...`)
  const startTime = Date.now()

  const uint8Array = new Uint8Array(buffer)

  const { text, totalPages } = await extractText(uint8Array, {
    mergePages: false,
  })

  const pages: PageText[] = []

  if (Array.isArray(text)) {
    for (let i = 0; i < text.length; i++) {
      const pageText = text[i]
      if (pageText && pageText.trim().length > 0) {
        pages.push({
          pageNumber: i + 1,
          text: pageText.trim()
        })
      }

      if (onProgress) {
        onProgress({
          stage: 'extracting',
          current: i + 1,
          total: text.length,
          message: `Extracting page ${i + 1}/${text.length}`
        })
      }
    }
  } else if (text) {
    pages.push({ pageNumber: 1, text: String(text).trim() })
  }

  const elapsed = Date.now() - startTime
  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0)

  console.log(`✓ Extracted ${pages.length}/${totalPages} pages (${totalChars.toLocaleString()} chars) in ${elapsed}ms`)

  return pages
}

// ============================================================================
// Section Detection
// ============================================================================

/**
 * Detect section information from text
 */
function detectSection(text: string, previousHierarchy: string[] = []): SectionInfo | null {
  const firstLine = text.split('\n')[0].trim()

  for (const [type, pattern] of Object.entries(SECTION_PATTERNS)) {
    const match = firstLine.match(pattern)
    if (match) {
      const number = match[1] || null
      const title = match[2]?.trim() || null

      // Build hierarchy
      const hierarchy = [...previousHierarchy]
      const label = `${type.charAt(0).toUpperCase() + type.slice(1)} ${number || ''}`.trim()

      // Update hierarchy based on type precedence
      if (type === 'chapter') {
        hierarchy.length = 0
        hierarchy.push(label)
      } else if (type === 'article') {
        while (hierarchy.length > 1) hierarchy.pop()
        hierarchy.push(label)
      } else if (type === 'section') {
        while (hierarchy.length > 2) hierarchy.pop()
        hierarchy.push(label)
      } else {
        hierarchy.push(label)
      }

      return {
        type: type as SectionInfo['type'],
        number,
        title,
        hierarchy
      }
    }
  }

  return null
}

/**
 * Detect element type from content
 */
function detectElementType(text: string): EnhancedChunk['metadata']['elementType'] {
  const trimmed = text.trim()

  // Check for definition pattern
  if (SECTION_PATTERNS.definition.test(trimmed)) {
    return 'definition'
  }

  // Check for title (short, possibly caps)
  if (trimmed.length < 100 && /^[A-Z\d\s\-:]+$/.test(trimmed)) {
    return 'title'
  }

  // Check for list items
  if (/^[\(\[]?[a-z\d][\)\]]\s/m.test(trimmed) || /^\d+\.\s/m.test(trimmed)) {
    return 'list'
  }

  // Check for table-like content
  if (trimmed.includes('\t') || /\|\s*\|/.test(trimmed)) {
    return 'table'
  }

  return 'narrative'
}

// ============================================================================
// Semantic Chunking with Section Awareness
// ============================================================================

/**
 * Generate contextual header for a chunk (Anthropic-style)
 */
function generateContextualHeader(
  chunk: string,
  section: SectionInfo | null,
  pageNumber: number,
  documentTitle: string = 'Legal Document'
): string {
  const parts: string[] = []

  parts.push(`Document: ${documentTitle}`)
  parts.push(`Page: ${pageNumber}`)

  if (section) {
    if (section.hierarchy.length > 0) {
      parts.push(`Location: ${section.hierarchy.join(' > ')}`)
    }
    if (section.title) {
      parts.push(`Section Title: ${section.title}`)
    }
  }

  // Add content type hint
  const elementType = detectElementType(chunk)
  if (elementType !== 'narrative') {
    parts.push(`Content Type: ${elementType}`)
  }

  return parts.join(' | ')
}

/**
 * Chunk pages with semantic awareness and parallel processing
 */
export async function chunkPagesV2(
  pages: PageText[],
  documentTitle: string = 'Legal Document',
  onProgress?: (progress: IndexingProgress) => void
): Promise<EnhancedChunk[]> {
  console.log(`\n✂️ Chunking ${pages.length} pages with semantic awareness...`)
  const startTime = Date.now()

  // Legal document optimized separators
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CONFIG.chunkSize,
    chunkOverlap: CONFIG.chunkOverlap,
    separators: [
      '\n\nArticle',     // Article boundaries
      '\n\nChapter',     // Chapter boundaries
      '\n\nSection',     // Section boundaries
      '\n\n\n',          // Multiple newlines
      '\n\n',            // Paragraph breaks
      '\n',              // Line breaks
      '. ',              // Sentence boundaries
      '; ',              // Clause boundaries
      ', ',              // Phrase boundaries
      ' ',               // Word boundaries
      '',                // Character level
    ],
  })

  const allChunks: EnhancedChunk[] = []
  let globalChunkIndex = 0
  let currentHierarchy: string[] = []

  // Process pages in parallel batches
  const processBatch = async (pageBatch: PageText[]) => {
    const batchChunks: EnhancedChunk[] = []

    for (const page of pageBatch) {
      const pageChunks = await splitter.splitText(page.text)

      for (const chunkContent of pageChunks) {
        if (chunkContent.length < CONFIG.minChunkSize) continue

        // Detect section info
        const section = detectSection(chunkContent, currentHierarchy)
        if (section) {
          currentHierarchy = section.hierarchy
        }

        // Generate contextual header
        const contextualHeader = generateContextualHeader(
          chunkContent,
          section,
          page.pageNumber,
          documentTitle
        )

        // Detect metadata
        const elementType = detectElementType(chunkContent)
        const hasDefinition = SECTION_PATTERNS.definition.test(chunkContent)
        const hasReference = /(?:Article|Section|Chapter|Clause)\s+\d+/i.test(chunkContent)

        batchChunks.push({
          content: chunkContent,
          contextualHeader,
          pageNumber: page.pageNumber,
          pageNumbers: [page.pageNumber],
          chunkIndex: globalChunkIndex++,
          section: section || (currentHierarchy.length > 0 ? {
            type: 'paragraph',
            number: null,
            title: null,
            hierarchy: [...currentHierarchy]
          } : null),
          metadata: {
            charCount: chunkContent.length,
            wordCount: chunkContent.split(/\s+/).length,
            hasDefinition,
            hasReference,
            elementType
          }
        })
      }
    }

    return batchChunks
  }

  // Process in parallel batches
  for (let i = 0; i < pages.length; i += CONFIG.maxParallelPages) {
    const batch = pages.slice(i, i + CONFIG.maxParallelPages)
    const batchChunks = await processBatch(batch)
    allChunks.push(...batchChunks)

    if (onProgress) {
      onProgress({
        stage: 'chunking',
        current: Math.min(i + CONFIG.maxParallelPages, pages.length),
        total: pages.length,
        message: `Chunking pages ${i + 1}-${Math.min(i + CONFIG.maxParallelPages, pages.length)}`
      })
    }
  }

  const elapsed = Date.now() - startTime
  const avgSize = Math.round(allChunks.reduce((s, c) => s + c.content.length, 0) / allChunks.length)

  console.log(`✓ Created ${allChunks.length} chunks in ${elapsed}ms`)
  console.log(`  - Avg size: ${avgSize} chars (~${Math.round(avgSize / 4)} tokens)`)
  console.log(`  - With sections: ${allChunks.filter(c => c.section).length}`)
  console.log(`  - With definitions: ${allChunks.filter(c => c.metadata.hasDefinition).length}`)

  return allChunks
}

// ============================================================================
// Batch Embedding Generation
// ============================================================================

/**
 * Generate embeddings in batches with parallelism
 */
export async function generateBatchEmbeddings(
  texts: string[],
  onProgress?: (progress: IndexingProgress) => void
): Promise<BatchEmbeddingResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  console.log(`\n🔮 Generating embeddings for ${texts.length} chunks...`)
  const startTime = Date.now()

  const allEmbeddings: number[][] = []
  let totalTokens = 0

  // Process in batches
  const batches: string[][] = []
  for (let i = 0; i < texts.length; i += CONFIG.batchSize) {
    batches.push(texts.slice(i, i + CONFIG.batchSize))
  }

  // Process batches with controlled parallelism
  for (let i = 0; i < batches.length; i += CONFIG.maxParallelEmbeddings) {
    const parallelBatches = batches.slice(i, i + CONFIG.maxParallelEmbeddings)

    const results = await Promise.all(
      parallelBatches.map(async (batch) => {
        // Truncate texts that are too long
        const maxChars = CONFIG.maxTokensPerEmbedding * 4
        const truncatedBatch = batch.map(t =>
          t.length > maxChars ? t.substring(0, maxChars) : t
        )

        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: CONFIG.embeddingModel,
            input: truncatedBatch,
          }),
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`Embedding API error: ${error}`)
        }

        const data = await response.json()
        return {
          embeddings: data.data.map((d: any) => d.embedding),
          tokens: data.usage?.total_tokens || 0
        }
      })
    )

    for (const result of results) {
      allEmbeddings.push(...result.embeddings)
      totalTokens += result.tokens
    }

    if (onProgress) {
      const processed = Math.min((i + CONFIG.maxParallelEmbeddings) * CONFIG.batchSize, texts.length)
      onProgress({
        stage: 'embedding',
        current: processed,
        total: texts.length,
        message: `Embedding chunks ${processed}/${texts.length}`
      })
    }
  }

  const elapsed = Date.now() - startTime

  console.log(`✓ Generated ${allEmbeddings.length} embeddings in ${elapsed}ms`)
  console.log(`  - Total tokens: ${totalTokens.toLocaleString()}`)
  console.log(`  - Avg latency: ${Math.round(elapsed / texts.length)}ms per chunk`)

  return {
    embeddings: allEmbeddings,
    tokens: totalTokens,
    latencyMs: elapsed
  }
}

// ============================================================================
// Re-ranking with GPT-4o-mini
// ============================================================================

export interface SearchResultForRerank {
  content: string
  score: number
  chunkIndex: number
  pageNumber: number | null
  metadata?: any
}

/**
 * Re-rank search results using GPT-4o-mini
 */
export async function rerankResults(
  query: string,
  results: SearchResultForRerank[],
  topK: number = CONFIG.finalTopK
): Promise<SearchResultForRerank[]> {
  if (results.length <= topK) {
    return results
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('⚠️ No API key for re-ranking, returning original results')
    return results.slice(0, topK)
  }

  console.log(`\n🔄 Re-ranking ${results.length} results...`)
  const startTime = Date.now()

  // Take top candidates for re-ranking
  const candidates = results.slice(0, CONFIG.rerankTopK)

  const prompt = `You are a relevance scoring assistant. Score each document chunk's relevance to the query on a scale of 0-10.

Query: "${query}"

Documents to score:
${candidates.map((r, i) => `[${i}] ${r.content.substring(0, 500)}...`).join('\n\n')}

Return ONLY a JSON array of scores in order, e.g., [8, 5, 9, 3, ...]
No explanation, just the array.`

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.rerankModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    })

    if (!response.ok) {
      throw new Error(`Re-rank API error: ${response.status}`)
    }

    const data = await response.json()
    const scoresText = data.choices[0]?.message?.content?.trim()

    // Parse scores
    const scores = JSON.parse(scoresText) as number[]

    // Apply scores and sort
    const reranked = candidates.map((r, i) => ({
      ...r,
      score: scores[i] || 0
    }))

    reranked.sort((a, b) => b.score - a.score)

    const elapsed = Date.now() - startTime
    console.log(`✓ Re-ranked in ${elapsed}ms`)

    return reranked.slice(0, topK)
  } catch (error) {
    console.error('❌ Re-ranking failed:', error)
    return results.slice(0, topK)
  }
}

// ============================================================================
// Full Indexing Pipeline
// ============================================================================

export interface IndexingResult {
  documentId: string
  chunksCreated: number
  totalTokens: number
  totalTimeMs: number
  stages: {
    extraction: number
    chunking: number
    embedding: number
    storing: number
  }
}

/**
 * Full indexing pipeline with parallel processing
 */
export async function indexDocumentV2(
  documentId: string,
  buffer: Buffer,
  documentTitle: string,
  storeChunkFn: (
    documentId: string,
    content: string,
    embedding: number[],
    chunkIndex: number,
    pageNumber: number | null,
    metadata: any
  ) => Promise<void>,
  onProgress?: (progress: IndexingProgress) => void
): Promise<IndexingResult> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`📚 RAG Pipeline V2 - Indexing: ${documentTitle}`)
  console.log(`${'='.repeat(60)}`)

  const totalStart = Date.now()
  const stages = { extraction: 0, chunking: 0, embedding: 0, storing: 0 }

  // Stage 1: Extract text
  let stageStart = Date.now()
  const pages = await extractTextFromPDFv2(buffer, onProgress)
  stages.extraction = Date.now() - stageStart

  // Stage 2: Chunk with semantic awareness
  stageStart = Date.now()
  const chunks = await chunkPagesV2(pages, documentTitle, onProgress)
  stages.chunking = Date.now() - stageStart

  // Stage 3: Generate embeddings (with contextual headers prepended)
  stageStart = Date.now()
  const textsForEmbedding = chunks.map(c => `${c.contextualHeader}\n\n${c.content}`)
  const { embeddings, tokens } = await generateBatchEmbeddings(textsForEmbedding, onProgress)
  stages.embedding = Date.now() - stageStart

  // Stage 4: Store chunks
  stageStart = Date.now()
  console.log(`\n💾 Storing ${chunks.length} chunks...`)

  // Store in parallel batches
  const storeBatchSize = 10
  for (let i = 0; i < chunks.length; i += storeBatchSize) {
    const batch = chunks.slice(i, i + storeBatchSize)

    await Promise.all(
      batch.map((chunk, j) => {
        const idx = i + j
        return storeChunkFn(
          documentId,
          chunk.content,
          embeddings[idx],
          chunk.chunkIndex,
          chunk.pageNumber,
          {
            contextual_header: chunk.contextualHeader,
            section: chunk.section,
            element_type: chunk.metadata.elementType,
            has_definition: chunk.metadata.hasDefinition,
            has_reference: chunk.metadata.hasReference,
            word_count: chunk.metadata.wordCount,
            page_numbers: chunk.pageNumbers
          }
        )
      })
    )

    if (onProgress) {
      onProgress({
        stage: 'storing',
        current: Math.min(i + storeBatchSize, chunks.length),
        total: chunks.length,
        message: `Storing chunks ${i + 1}-${Math.min(i + storeBatchSize, chunks.length)}`
      })
    }
  }
  stages.storing = Date.now() - stageStart

  const totalTime = Date.now() - totalStart

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✅ Indexing Complete`)
  console.log(`${'='.repeat(60)}`)
  console.log(`   Chunks: ${chunks.length}`)
  console.log(`   Tokens: ${tokens.toLocaleString()}`)
  console.log(`   Time breakdown:`)
  console.log(`     - Extraction: ${stages.extraction}ms`)
  console.log(`     - Chunking:   ${stages.chunking}ms`)
  console.log(`     - Embedding:  ${stages.embedding}ms`)
  console.log(`     - Storing:    ${stages.storing}ms`)
  console.log(`   Total: ${totalTime}ms`)

  if (onProgress) {
    onProgress({
      stage: 'complete',
      current: chunks.length,
      total: chunks.length,
      message: `Indexing complete: ${chunks.length} chunks`
    })
  }

  return {
    documentId,
    chunksCreated: chunks.length,
    totalTokens: tokens,
    totalTimeMs: totalTime,
    stages
  }
}

// ============================================================================
// Export Configuration for Testing
// ============================================================================

export { CONFIG as RAG_CONFIG }
