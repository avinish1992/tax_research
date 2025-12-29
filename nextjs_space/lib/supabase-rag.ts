/**
 * Supabase-based RAG system using pgvector for semantic search
 *
 * EMBEDDING OPTIONS (configurable via USE_HUGGINGFACE_EMBEDDINGS):
 * 1. Hugging Face Inference API (FREE) - all-MiniLM-L6-v2 (384 dims)
 * 2. OpenAI API (paid) - text-embedding-3-small (1536 dims)
 *
 * HuggingFace is recommended for cost savings - free tier with generous limits
 */

import { createClient } from '@/utils/supabase/server'
import { InferenceClient } from '@huggingface/inference'

// =============================================================================
// CONFIGURATION - Change this to switch embedding providers
// =============================================================================
const USE_HUGGINGFACE_EMBEDDINGS = false // OpenAI (1536 dims) - consistent with stored embeddings

// Hugging Face config (FREE)
const HF_MODEL = 'sentence-transformers/all-MiniLM-L6-v2' // 384 dimensions

// OpenAI config (paid fallback)
const OPENAI_MODEL = 'text-embedding-3-small' // 1536 dimensions
const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings'
const MAX_TOKENS = 8191

// Search config
const DEFAULT_TOP_K = 15
const DEFAULT_MIN_SIMILARITY = 0.25
const RRF_K = 60

interface SearchResult {
  content: string
  fileName: string
  score: number
  chunkIndex: number
  pageNumber: number | null
  source: string
  documentId: string
}

interface HybridSearchResult {
  chunk_id: string
  document_id: string
  content: string
  file_name: string
  page_number: number | null
  chunk_index: number
  semantic_rank: number | null
  keyword_rank: number | null
  rrf_score: number
  search_type: string
}

// =============================================================================
// EMBEDDING GENERATION
// =============================================================================

/**
 * Generate embedding using Hugging Face Inference SDK (FREE)
 * Uses all-MiniLM-L6-v2 model (384 dimensions)
 *
 * Free tier: ~30,000 requests/month
 * Get your free API key at: https://huggingface.co/settings/tokens
 */
async function generateHuggingFaceEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.HUGGINGFACE_API_KEY
  if (!apiKey) {
    throw new Error('HUGGINGFACE_API_KEY not configured. Get a free key at https://huggingface.co/settings/tokens')
  }

  console.log('🤗 Generating HuggingFace embedding (FREE)...')
  const startTime = Date.now()

  // Truncate text if too long (model max ~512 tokens)
  const truncatedText = text.length > 2000 ? text.substring(0, 2000) : text

  const client = new InferenceClient(apiKey)

  try {
    const output = await client.featureExtraction({
      model: HF_MODEL,
      inputs: truncatedText,
      provider: 'hf-inference',
    })

    // Convert to number array - output can be nested array or flat array
    let embedding: number[]
    if (Array.isArray(output) && Array.isArray(output[0])) {
      // Nested array - take mean pooling or first element
      embedding = output[0] as number[]
    } else if (Array.isArray(output)) {
      embedding = output as number[]
    } else {
      throw new Error('Invalid embedding response from HuggingFace')
    }

    const duration = Date.now() - startTime
    console.log(`✓ HuggingFace embedding: ${duration}ms (${embedding.length} dims)`)

    return embedding
  } catch (error: any) {
    // Handle model loading (503) - retry once
    if (error.message?.includes('loading') || error.message?.includes('503')) {
      console.log('   Model loading, retrying in 2s...')
      await new Promise(resolve => setTimeout(resolve, 2000))
      return generateHuggingFaceEmbedding(text)
    }
    throw error
  }
}

/**
 * Generate embedding using OpenAI API (paid fallback)
 * Uses text-embedding-3-small (1536 dimensions)
 */
async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  console.log('🔮 Generating OpenAI embedding...')
  const startTime = Date.now()

  const maxChars = MAX_TOKENS * 4
  const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: truncatedText,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const embedding = data?.data?.[0]?.embedding

  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Invalid embedding response from OpenAI')
  }

  const duration = Date.now() - startTime
  console.log(`✓ OpenAI embedding: ${duration}ms (${embedding.length} dims)`)

  return embedding
}

/**
 * Main embedding function - uses configured provider
 * Defaults to HuggingFace (FREE) unless USE_HUGGINGFACE_EMBEDDINGS is false
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text')
  }

  if (USE_HUGGINGFACE_EMBEDDINGS) {
    try {
      return await generateHuggingFaceEmbedding(text)
    } catch (error) {
      console.warn('⚠️ HuggingFace failed, falling back to OpenAI:', error)
      // Fallback to OpenAI if HuggingFace fails
      if (process.env.OPENAI_API_KEY) {
        return await generateOpenAIEmbedding(text)
      }
      throw error
    }
  } else {
    return await generateOpenAIEmbedding(text)
  }
}

/**
 * Get the embedding dimensions for the current provider
 */
export function getEmbeddingDimensions(): number {
  return USE_HUGGINGFACE_EMBEDDINGS ? 384 : 1536
}

// =============================================================================
// SEARCH FUNCTIONS
// =============================================================================

/**
 * Semantic search using Supabase RPC function
 * Automatically uses the correct search function based on embedding dimensions
 */
export async function semanticSearch(
  queryEmbedding: number[],
  userId: string,
  topK: number = DEFAULT_TOP_K,
  minSimilarity: number = DEFAULT_MIN_SIMILARITY
): Promise<SearchResult[]> {
  const dims = queryEmbedding.length
  const searchFunction = dims === 384 ? 'semantic_search_local' : 'semantic_search'

  console.log(`🔍 Semantic Search (${dims} dims, ${searchFunction})`)

  const supabase = await createClient()

  // Format embedding based on function expectation
  const embeddingParam = dims === 384
    ? `[${queryEmbedding.join(',')}]`  // Local format
    : JSON.stringify(queryEmbedding)    // OpenAI format

  const { data, error } = await supabase.rpc(searchFunction, {
    query_embedding: embeddingParam,
    p_user_id: userId,
    match_count: topK,
    min_similarity: minSimilarity
  })

  if (error) {
    console.error('❌ Semantic search error:', error)
    throw error
  }

  const results: SearchResult[] = (data as any[]).map((row) => ({
    content: row.content,
    fileName: row.file_name,
    score: row.similarity,
    chunkIndex: row.chunk_index,
    pageNumber: row.page_number,
    source: 'semantic',
    documentId: row.document_id
  }))

  console.log(`✓ Semantic search: ${results.length} results`)
  return results
}

interface HybridSearchV2Result extends HybridSearchResult {
  semantic_similarity: number | null
  keyword_score: number | null
}

/**
 * Hybrid search using improved Supabase RPC function
 * Combines semantic (vector) and BM25-style keyword search with RRF fusion
 */
export async function hybridSearch(
  query: string,
  queryEmbedding: number[],
  userId: string,
  topK: number = DEFAULT_TOP_K,
  minSimilarity: number = DEFAULT_MIN_SIMILARITY
): Promise<SearchResult[]> {
  const dims = queryEmbedding.length
  // Use v2 for OpenAI embeddings (1536), fallback for local (384)
  const searchFunction = dims === 384 ? 'hybrid_search_local' : 'hybrid_search_v2'
  console.log(`\n🔀 Hybrid Search (${dims} dims, ${searchFunction})`)
  console.log(`   Query: "${query.substring(0, 100)}..."`)

  const supabase = await createClient()

  // Try improved hybrid search (v2 with BM25)
  try {
    const embeddingParam = dims === 384
      ? `[${queryEmbedding.join(',')}]`
      : JSON.stringify(queryEmbedding)

    const { data, error } = await supabase.rpc(searchFunction, {
      query_text: query,
      query_embedding: embeddingParam,
      p_user_id: userId,
      match_count: topK,
      semantic_weight: 0.6,
      keyword_weight: 0.4,
      rrf_k: RRF_K,
      min_semantic_similarity: minSimilarity
    })

    if (error) {
      console.warn('❌ Hybrid search v2 error, falling back to v1:', error.message)
      // Fallback to original hybrid search
      return hybridSearchV1(query, queryEmbedding, userId, topK, minSimilarity)
    }

    const results: SearchResult[] = (data as HybridSearchV2Result[]).map((row) => ({
      content: row.content,
      fileName: row.file_name,
      score: row.rrf_score,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number,
      source: row.search_type,
      documentId: row.document_id
    }))

    console.log(`✓ Hybrid search (BM25): ${results.length} results`)
    if (results.length > 0) {
      const topResult = data[0] as HybridSearchV2Result
      console.log(`  Top: ${results[0].source} (RRF: ${results[0].score.toFixed(4)}, sem: ${topResult.semantic_similarity?.toFixed(3) || 'N/A'}, kw: ${topResult.keyword_score?.toFixed(3) || 'N/A'})`)
    }

    return results
  } catch (error) {
    console.error('❌ Hybrid search v2 failed:', error)
    return semanticSearch(queryEmbedding, userId, topK, minSimilarity)
  }
}

/**
 * Original hybrid search (v1) as fallback
 */
async function hybridSearchV1(
  query: string,
  queryEmbedding: number[],
  userId: string,
  topK: number = DEFAULT_TOP_K,
  minSimilarity: number = DEFAULT_MIN_SIMILARITY
): Promise<SearchResult[]> {
  const dims = queryEmbedding.length
  const searchFunction = dims === 384 ? 'hybrid_search_local' : 'hybrid_search'

  const supabase = await createClient()

  try {
    const embeddingParam = dims === 384
      ? `[${queryEmbedding.join(',')}]`
      : JSON.stringify(queryEmbedding)

    const { data, error } = await supabase.rpc(searchFunction, {
      query_text: query,
      query_embedding: embeddingParam,
      p_user_id: userId,
      match_count: topK,
      semantic_weight: 0.6,
      keyword_weight: 0.4,
      rrf_k: RRF_K,
      min_semantic_similarity: minSimilarity
    })

    if (error) {
      console.warn('❌ Hybrid search v1 error, falling back to semantic:', error.message)
      return semanticSearch(queryEmbedding, userId, topK, minSimilarity)
    }

    const results: SearchResult[] = (data as HybridSearchResult[]).map((row) => ({
      content: row.content,
      fileName: row.file_name,
      score: row.rrf_score,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number,
      source: row.search_type,
      documentId: row.document_id
    }))

    console.log(`✓ Hybrid search v1: ${results.length} results`)
    return results
  } catch (error) {
    console.error('❌ Hybrid search v1 failed:', error)
    return semanticSearch(queryEmbedding, userId, topK, minSimilarity)
  }
}

// =============================================================================
// QUERY EXPANSION & NORMALIZATION
// =============================================================================

/**
 * Legal/Tax domain synonyms for query expansion
 * Maps terms to their synonyms and related concepts
 */
const LEGAL_SYNONYMS: Record<string, string[]> = {
  // Tax terms
  'tax': ['taxation', 'levy', 'duty', 'tariff'],
  'rate': ['percentage', 'ratio', 'proportion'],
  'corporate': ['company', 'business', 'enterprise', 'firm'],
  'income': ['revenue', 'earnings', 'profit', 'proceeds'],
  'penalty': ['fine', 'sanction', 'punishment', 'fee'],
  'exempt': ['excluded', 'waived', 'relieved', 'free from'],
  'exemption': ['exclusion', 'waiver', 'relief', 'deduction'],
  'deduction': ['allowance', 'reduction', 'write-off', 'credit'],
  'compliance': ['adherence', 'conformity', 'observance'],
  'violation': ['breach', 'infringement', 'non-compliance', 'offense'],
  'filing': ['submission', 'declaration', 'return'],
  'assessment': ['evaluation', 'determination', 'calculation'],
  'liability': ['obligation', 'duty', 'responsibility'],
  'threshold': ['limit', 'minimum', 'ceiling', 'cap'],
  'resident': ['domiciled', 'established', 'based'],
  'non-resident': ['foreign', 'overseas', 'external'],

  // Legal structure terms
  'article': ['section', 'clause', 'provision', 'paragraph'],
  'chapter': ['part', 'division', 'title'],
  'regulation': ['rule', 'law', 'statute', 'ordinance'],
  'decree': ['order', 'directive', 'resolution'],

  // UAE-specific terms
  'uae': ['emirates', 'united arab emirates', 'gulf'],
  'aed': ['dirhams', 'dhs', 'dirham'],
  'free zone': ['freezone', 'fz', 'free trade zone', 'ftz'],
  'mainland': ['onshore', 'local'],

  // Business terms
  'entity': ['company', 'organization', 'establishment', 'business'],
  'subsidiary': ['affiliate', 'branch', 'division'],
  'group': ['conglomerate', 'holding', 'parent'],
  'transfer pricing': ['intercompany pricing', 'related party transactions'],
}

/**
 * Common misspellings and typo corrections
 */
const TYPO_CORRECTIONS: Record<string, string> = {
  'corproate': 'corporate',
  'coporate': 'corporate',
  'corperate': 'corporate',
  'taxs': 'tax',
  'taxess': 'taxes',
  'penaltiy': 'penalty',
  'penalities': 'penalties',
  'compiance': 'compliance',
  'compilance': 'compliance',
  'exemtion': 'exemption',
  'exmeption': 'exemption',
  'dedcution': 'deduction',
  'deductoin': 'deduction',
  'violaton': 'violation',
  'assesment': 'assessment',
  'assessement': 'assessment',
  'liabilty': 'liability',
  'reveune': 'revenue',
  'revneue': 'revenue',
  'incmoe': 'income',
  'incoem': 'income',
}

/**
 * Abbreviation expansions
 */
const ABBREVIATIONS: Record<string, string> = {
  'ct': 'corporate tax',
  'vat': 'value added tax',
  'fta': 'federal tax authority',
  'rta': 'roads and transport authority',
  'mof': 'ministry of finance',
  'qfzp': 'qualifying free zone person',
  'fy': 'fiscal year',
  'ty': 'tax year',
  'tp': 'transfer pricing',
  'pe': 'permanent establishment',
  'dta': 'double taxation agreement',
  'dtaa': 'double taxation avoidance agreement',
  'poa': 'power of attorney',
  'roi': 'return on investment',
  'p&l': 'profit and loss',
  'bs': 'balance sheet',
}

/**
 * Normalize query by fixing typos and standardizing text
 */
function normalizeQuery(query: string): string {
  let normalized = query.toLowerCase().trim()

  // Fix common typos
  for (const [typo, correction] of Object.entries(TYPO_CORRECTIONS)) {
    const regex = new RegExp(`\\b${typo}\\b`, 'gi')
    normalized = normalized.replace(regex, correction)
  }

  // Expand abbreviations (only when standalone word)
  for (const [abbr, expansion] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi')
    if (regex.test(normalized)) {
      normalized = normalized.replace(regex, expansion)
    }
  }

  // Remove extra whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim()

  return normalized
}

/**
 * Extract keywords from query (removes stop words)
 */
function extractKeywords(query: string): string[] {
  const stopWords = new Set([
    'what', 'is', 'the', 'a', 'an', 'are', 'how', 'do', 'does', 'can', 'could',
    'would', 'should', 'will', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with',
    'about', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
    'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
    'when', 'where', 'why', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'am', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'get', 'gets',
    'please', 'tell', 'me', 'explain', 'describe', 'show', 'give', 'find'
  ])

  const words = query.toLowerCase().split(/\s+/)
  return words.filter(word => word.length > 2 && !stopWords.has(word))
}

/**
 * Enhanced query expansion for legal/tax documents
 * Handles synonyms, typos, abbreviations, and structural references
 */
export function expandLegalQuery(query: string): string {
  // Step 1: Normalize (fix typos, expand abbreviations)
  let expanded = normalizeQuery(query)
  const originalNormalized = expanded
  const addedTerms: string[] = []

  // Step 2: Chapter X ↔ Article X expansion
  const chapterPattern = /chapter\s+(\d+)/gi
  const chapterMatches = [...expanded.matchAll(chapterPattern)]
  chapterMatches.forEach((match) => {
    addedTerms.push(`Article ${match[1]}`)
  })

  const articlePattern = /article\s+(\d+)/gi
  const articleMatches = [...expanded.matchAll(articlePattern)]
  articleMatches.forEach((match) => {
    addedTerms.push(`Chapter ${match[1]}`)
  })

  // Step 3: Add synonyms for key terms (limit to avoid query explosion)
  const keywords = extractKeywords(expanded)
  let synonymsAdded = 0
  const maxSynonyms = 5 // Limit total synonyms added

  for (const keyword of keywords) {
    if (synonymsAdded >= maxSynonyms) break

    const synonyms = LEGAL_SYNONYMS[keyword]
    if (synonyms) {
      // Add first 1-2 synonyms for each matching term
      const toAdd = synonyms.slice(0, 2)
      addedTerms.push(...toAdd)
      synonymsAdded += toAdd.length
    }
  }

  // Step 4: Combine original query with expanded terms
  if (addedTerms.length > 0) {
    expanded = `${originalNormalized} ${addedTerms.join(' ')}`
    console.log('📝 Query expansion:')
    console.log(`   Original: "${query}"`)
    console.log(`   Normalized: "${originalNormalized}"`)
    console.log(`   Added terms: [${addedTerms.join(', ')}]`)
    console.log(`   Final: "${expanded}"`)
  } else if (originalNormalized !== query.toLowerCase().trim()) {
    console.log('📝 Query normalized:')
    console.log(`   Original: "${query}"`)
    console.log(`   Normalized: "${originalNormalized}"`)
  }

  return expanded
}

/**
 * Generate search-optimized query for BM25/full-text search
 * Converts natural language query to tsquery format
 */
export function generateSearchQuery(query: string): string {
  const keywords = extractKeywords(normalizeQuery(query))

  // Create OR-connected search query for flexibility
  // e.g., "corporate tax rate" → "corporate | tax | rate"
  if (keywords.length === 0) return query

  return keywords.join(' | ')
}

/**
 * Expand search results with parent context (adjacent chunks)
 */
export async function expandWithParentContext(
  searchResults: SearchResult[],
  _userId: string,
  window: number = 2
): Promise<SearchResult[]> {
  if (searchResults.length === 0) return searchResults

  const supabase = await createClient()
  const expandedResults: SearchResult[] = []
  const seenContexts = new Set<string>()

  for (const result of searchResults) {
    const contextKey = `${result.fileName}:${Math.floor(result.chunkIndex / (window * 2))}`
    if (seenContexts.has(contextKey)) continue
    seenContexts.add(contextKey)

    const { data: adjacentChunks, error } = await supabase
      .from('document_chunks')
      .select('content, chunk_index')
      .eq('document_id', result.documentId)
      .gte('chunk_index', Math.max(0, result.chunkIndex - window))
      .lte('chunk_index', result.chunkIndex + window)
      .order('chunk_index', { ascending: true })

    if (error || !adjacentChunks || adjacentChunks.length === 0) {
      expandedResults.push(result)
      continue
    }

    const expandedContent = adjacentChunks
      .map((c: { content: string }) => c.content)
      .join('\n\n')

    expandedResults.push({
      ...result,
      content: expandedContent
    })
  }

  console.log(`✓ Expanded ${searchResults.length} → ${expandedResults.length} with context`)
  return expandedResults
}

/**
 * Store document chunk with embedding
 */
export async function storeChunk(
  documentId: string,
  content: string,
  embedding: number[],
  chunkIndex: number,
  pageNumber: number | null
): Promise<void> {
  const supabase = await createClient()
  const dims = embedding.length

  const insertData: Record<string, any> = {
    document_id: documentId,
    content,
    chunk_index: chunkIndex,
    page_number: pageNumber,
    metadata: {}
  }

  // Store in appropriate column based on dimensions
  if (dims === 384) {
    insertData.embedding_local = `[${embedding.join(',')}]`
  } else {
    insertData.embedding = JSON.stringify(embedding)
  }

  const { error } = await supabase
    .from('document_chunks')
    .insert(insertData)

  if (error) {
    console.error('❌ Failed to store chunk:', error)
    throw error
  }
}
