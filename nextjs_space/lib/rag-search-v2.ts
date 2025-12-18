/**
 * RAG Search V2 - Enhanced search with re-ranking and metadata filtering
 *
 * Improvements:
 * 1. Query expansion for legal terms
 * 2. Hybrid search (semantic + keyword)
 * 3. GPT-4o-mini re-ranking
 * 4. Metadata-aware filtering
 * 5. Section hierarchy aware results
 */

import { createClient } from '@/utils/supabase/server'

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  embeddingModel: 'text-embedding-3-small',
  embeddingApiUrl: 'https://api.openai.com/v1/embeddings',
  maxTokens: 8191,

  // Search settings
  initialTopK: 20,      // Retrieve more for re-ranking
  finalTopK: 5,         // Return after re-ranking
  minSimilarity: 0.3,

  // Hybrid search weights
  semanticWeight: 0.6,
  keywordWeight: 0.4,
  rrfK: 60,

  // Re-ranking
  rerankModel: 'gpt-4o-mini',
  enableReranking: true,
}

// ============================================================================
// Types
// ============================================================================

export interface SearchResult {
  content: string
  fileName: string
  score: number
  chunkIndex: number
  pageNumber: number | null
  pageNumbers: number[]
  source: 'semantic' | 'keyword' | 'hybrid'
  metadata: {
    contextualHeader?: string
    section?: {
      type: string
      number: string | null
      title: string | null
      hierarchy: string[]
    }
    elementType?: string
    hasDefinition?: boolean
    hasReference?: boolean
  }
}

export interface SearchOptions {
  topK?: number
  enableReranking?: boolean
  filterBySection?: string
  filterByElementType?: string
  minSimilarity?: number
}

// ============================================================================
// Query Expansion
// ============================================================================

const LEGAL_SYNONYMS: Record<string, string[]> = {
  'corporate tax': ['CT', 'business tax', 'company tax'],
  'taxable income': ['chargeable income', 'assessable income'],
  'exemptions': ['exempt entities', 'tax-exempt', 'exclusions'],
  'penalties': ['fines', 'sanctions', 'charges'],
  'compliance': ['adherence', 'conformity'],
  'deductions': ['allowances', 'deductible expenses'],
  'transfer pricing': ['arm\'s length', 'related party transactions'],
}

/**
 * Expand query with legal synonyms and related terms
 */
export function expandLegalQuery(query: string): string {
  let expanded = query

  // Add chapter/article cross-references
  const chapterPattern = /chapter\s+(\d+)/gi
  const chapterMatches = [...query.matchAll(chapterPattern)]
  chapterMatches.forEach((match) => {
    expanded += ` Article ${match[1]}`
  })

  const articlePattern = /article\s+(\d+)/gi
  const articleMatches = [...query.matchAll(articlePattern)]
  articleMatches.forEach((match) => {
    expanded += ` Chapter ${match[1]}`
  })

  // Add synonyms
  const lowerQuery = query.toLowerCase()
  for (const [term, synonyms] of Object.entries(LEGAL_SYNONYMS)) {
    if (lowerQuery.includes(term)) {
      expanded += ' ' + synonyms.join(' ')
    }
  }

  if (expanded !== query) {
    console.log('📝 Query expansion:')
    console.log(`   Original: "${query}"`)
    console.log(`   Expanded: "${expanded.substring(0, 200)}..."`)
  }

  return expanded
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embedding for query
 */
export async function generateQueryEmbedding(text: string): Promise<number[]> {
  if (!text?.trim()) {
    throw new Error('Cannot generate embedding for empty text')
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  const maxChars = CONFIG.maxTokens * 4
  const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text

  const response = await fetch(CONFIG.embeddingApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.embeddingModel,
      input: truncatedText,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Embedding API error: ${error}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

// ============================================================================
// Re-ranking
// ============================================================================

/**
 * Re-rank results using GPT-4o-mini
 */
async function rerankResults(
  query: string,
  results: SearchResult[],
  topK: number
): Promise<SearchResult[]> {
  if (results.length <= topK) {
    return results
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('⚠️ No API key for re-ranking')
    return results.slice(0, topK)
  }

  console.log(`\n🔄 Re-ranking ${results.length} results with GPT-4o-mini...`)
  const startTime = Date.now()

  const prompt = `Score each document's relevance to the query (0-10). Return ONLY a JSON array of numbers.

Query: "${query}"

Documents:
${results.map((r, i) => `[${i}] ${r.metadata.contextualHeader || ''}\n${r.content.substring(0, 400)}...`).join('\n\n')}

Return format: [score1, score2, ...]`

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
      throw new Error(`Re-rank error: ${response.status}`)
    }

    const data = await response.json()
    const scoresText = data.choices[0]?.message?.content?.trim()

    // Parse scores - handle potential JSON formatting issues
    let scores: number[]
    try {
      scores = JSON.parse(scoresText)
    } catch {
      // Try to extract numbers
      const matches = scoresText.match(/\d+/g)
      scores = matches ? matches.map(Number) : []
    }

    if (scores.length !== results.length) {
      console.warn('⚠️ Score count mismatch, using original order')
      return results.slice(0, topK)
    }

    // Apply scores and sort
    const reranked = results.map((r, i) => ({
      ...r,
      score: scores[i] / 10  // Normalize to 0-1
    }))

    reranked.sort((a, b) => b.score - a.score)

    const elapsed = Date.now() - startTime
    console.log(`✓ Re-ranked in ${elapsed}ms`)
    console.log(`   Top scores: ${reranked.slice(0, 3).map(r => r.score.toFixed(2)).join(', ')}`)

    return reranked.slice(0, topK)
  } catch (error) {
    console.error('❌ Re-ranking failed:', error)
    return results.slice(0, topK)
  }
}

// ============================================================================
// Hybrid Search
// ============================================================================

/**
 * Perform hybrid search with re-ranking
 */
export async function hybridSearchV2(
  query: string,
  userId: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const {
    topK = CONFIG.finalTopK,
    enableReranking = CONFIG.enableReranking,
    filterBySection,
    filterByElementType,
    minSimilarity = CONFIG.minSimilarity,
  } = options

  console.log(`\n🔀 Hybrid Search V2`)
  console.log(`   Query: "${query.substring(0, 100)}..."`)
  console.log(`   User: ${userId}`)
  console.log(`   Re-ranking: ${enableReranking ? 'enabled' : 'disabled'}`)

  const startTime = Date.now()

  // Expand query
  const expandedQuery = expandLegalQuery(query)

  // Generate embedding
  const queryEmbedding = await generateQueryEmbedding(expandedQuery)

  const supabase = await createClient()

  // Retrieve more results if re-ranking is enabled
  const retrieveCount = enableReranking ? CONFIG.initialTopK : topK

  try {
    const { data, error } = await supabase.rpc('hybrid_search', {
      query_text: expandedQuery,
      query_embedding: JSON.stringify(queryEmbedding),
      p_user_id: userId,
      match_count: retrieveCount,
      semantic_weight: CONFIG.semanticWeight,
      keyword_weight: CONFIG.keywordWeight,
      rrf_k: CONFIG.rrfK
    })

    if (error) {
      console.error('❌ Hybrid search error:', error)
      throw error
    }

    // Transform results
    let results: SearchResult[] = (data || []).map((row: any) => ({
      content: row.content,
      fileName: row.file_name,
      score: row.rrf_score,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number,
      pageNumbers: row.metadata?.page_numbers || [row.page_number],
      source: row.search_type as SearchResult['source'],
      metadata: {
        contextualHeader: row.metadata?.contextual_header,
        section: row.metadata?.section,
        elementType: row.metadata?.element_type,
        hasDefinition: row.metadata?.has_definition,
        hasReference: row.metadata?.has_reference,
      }
    }))

    // Apply metadata filters
    if (filterBySection) {
      results = results.filter(r =>
        r.metadata.section?.hierarchy?.some(h =>
          h.toLowerCase().includes(filterBySection.toLowerCase())
        )
      )
    }

    if (filterByElementType) {
      results = results.filter(r =>
        r.metadata.elementType === filterByElementType
      )
    }

    // Filter by similarity
    results = results.filter(r => r.score >= minSimilarity)

    // Re-rank if enabled
    if (enableReranking && results.length > topK) {
      results = await rerankResults(query, results, topK)
    } else {
      results = results.slice(0, topK)
    }

    const elapsed = Date.now() - startTime

    console.log(`\n✓ Search complete: ${results.length} results in ${elapsed}ms`)
    if (results.length > 0) {
      console.log(`   Top result: page ${results[0].pageNumber}, score ${results[0].score.toFixed(4)}`)
      if (results[0].metadata.section?.hierarchy) {
        console.log(`   Section: ${results[0].metadata.section.hierarchy.join(' > ')}`)
      }
    }

    return results
  } catch (error) {
    console.error('❌ Search failed, falling back to semantic only:', error)
    return semanticSearchV2(queryEmbedding, userId, { topK, minSimilarity })
  }
}

// ============================================================================
// Semantic Search Fallback
// ============================================================================

/**
 * Semantic-only search as fallback
 */
export async function semanticSearchV2(
  queryEmbedding: number[],
  userId: string,
  options: { topK?: number; minSimilarity?: number } = {}
): Promise<SearchResult[]> {
  const { topK = 5, minSimilarity = 0.3 } = options

  console.log(`🔍 Semantic Search V2 (fallback)`)

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('semantic_search', {
    query_embedding: JSON.stringify(queryEmbedding),
    p_user_id: userId,
    match_count: topK,
    min_similarity: minSimilarity
  })

  if (error) {
    console.error('❌ Semantic search error:', error)
    throw error
  }

  return (data || []).map((row: any) => ({
    content: row.content,
    fileName: row.file_name,
    score: row.similarity,
    chunkIndex: row.chunk_index,
    pageNumber: row.page_number,
    pageNumbers: [row.page_number],
    source: 'semantic' as const,
    metadata: {
      contextualHeader: row.metadata?.contextual_header,
      section: row.metadata?.section,
      elementType: row.metadata?.element_type,
    }
  }))
}

// ============================================================================
// Build Context for LLM
// ============================================================================

/**
 * Build context string from search results for LLM
 */
export function buildContextFromResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No relevant context found.'
  }

  const contextParts = results.map((r, i) => {
    const header = r.metadata.contextualHeader || `Source: ${r.fileName}, Page ${r.pageNumber}`
    const section = r.metadata.section?.hierarchy?.join(' > ') || ''

    return `--- Context ${i + 1} ---
${header}
${section ? `Section: ${section}` : ''}

${r.content}
`
  })

  return contextParts.join('\n')
}

// ============================================================================
// Export Config
// ============================================================================

export { CONFIG as SEARCH_CONFIG }
