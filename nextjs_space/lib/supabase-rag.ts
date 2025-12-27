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

/**
 * Hybrid search using Supabase RPC function
 * Combines semantic (vector) and keyword search with RRF fusion
 */
export async function hybridSearch(
  query: string,
  queryEmbedding: number[],
  userId: string,
  topK: number = DEFAULT_TOP_K,
  minSimilarity: number = DEFAULT_MIN_SIMILARITY
): Promise<SearchResult[]> {
  const dims = queryEmbedding.length
  // Use appropriate hybrid search function based on embedding dimensions
  const searchFunction = dims === 384 ? 'hybrid_search_local' : 'hybrid_search'
  console.log(`\n🔀 Hybrid Search (${dims} dims, ${searchFunction})`)
  console.log(`   Query: "${query.substring(0, 100)}..."`)

  const supabase = await createClient()

  // Try hybrid search first
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
      console.warn('❌ Hybrid search error, falling back to semantic:', error.message)
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

    console.log(`✓ Hybrid search: ${results.length} results`)
    if (results.length > 0) {
      console.log(`  Top: ${results[0].source} (score: ${results[0].score.toFixed(4)})`)
    }

    return results
  } catch (error) {
    console.error('❌ Hybrid search failed:', error)
    return semanticSearch(queryEmbedding, userId, topK, minSimilarity)
  }
}

/**
 * Query expansion for legal documents
 */
export function expandLegalQuery(query: string): string {
  let expanded = query

  // Chapter X → add Article X
  const chapterPattern = /chapter\s+(\d+)/gi
  const chapterMatches = [...query.matchAll(chapterPattern)]
  chapterMatches.forEach((match) => {
    expanded += ` Article ${match[1]}`
  })

  // Article X → add Chapter X
  const articlePattern = /article\s+(\d+)/gi
  const articleMatches = [...query.matchAll(articlePattern)]
  articleMatches.forEach((match) => {
    expanded += ` Chapter ${match[1]}`
  })

  if (expanded !== query) {
    console.log('📝 Query expansion:')
    console.log(`   Original: "${query}"`)
    console.log(`   Expanded: "${expanded}"`)
  }

  return expanded
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
