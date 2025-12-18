/**
 * Supabase-based RAG system using pgvector for semantic search
 * Replaces the Prisma-based implementation with native PostgreSQL vector operations
 * Uses OpenAI API for embeddings
 */

import { createClient } from '@/utils/supabase/server'

// Embedding model configuration - Using OpenAI
const EMBEDDING_MODEL = 'text-embedding-3-small' // 1536 dimensions
const EMBEDDING_API_URL = 'https://api.openai.com/v1/embeddings'
const MAX_TOKENS = 8191

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

interface SearchResult {
  content: string
  fileName: string
  score: number
  chunkIndex: number
  pageNumber: number | null
  source: string
}

/**
 * Generate embeddings using OpenAI API
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text')
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured')
  }

  try {
    console.log('🔮 Generating embedding for text of length:', text.length)

    // Truncate if needed (rough estimate: 1 token ≈ 4 chars)
    const maxChars = MAX_TOKENS * 4
    const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text

    const response = await fetch(EMBEDDING_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncatedText,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Embedding API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const embedding = data?.data?.[0]?.embedding

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error('Invalid embedding response format')
    }

    console.log('✓ Generated embedding:')
    console.log(`  - Model: ${EMBEDDING_MODEL}`)
    console.log(`  - Dimensions: ${embedding.length}`)

    return embedding
  } catch (error) {
    console.error('❌ Error generating embedding:', error)
    throw error
  }
}

/**
 * Hybrid search using Supabase RPC function
 * Combines semantic (vector) and keyword search with RRF fusion
 */
export async function hybridSearch(
  query: string,
  queryEmbedding: number[],
  userId: string,
  topK: number = 10
): Promise<SearchResult[]> {
  console.log(`\n🔀 Hybrid Search (Supabase pgvector)`)
  console.log(`   Query: "${query.substring(0, 100)}..."`)
  console.log(`   User: ${userId}`)

  const supabase = await createClient()

  try {
    const { data, error } = await supabase.rpc('hybrid_search', {
      query_text: query,
      query_embedding: JSON.stringify(queryEmbedding),
      p_user_id: userId,
      match_count: topK,
      semantic_weight: 0.6,  // Slightly favor semantic for legal docs
      keyword_weight: 0.4,
      rrf_k: 60
    })

    if (error) {
      console.error('❌ Hybrid search error:', error)
      throw error
    }

    const results: SearchResult[] = (data as HybridSearchResult[]).map((row) => ({
      content: row.content,
      fileName: row.file_name,
      score: row.rrf_score,
      chunkIndex: row.chunk_index,
      pageNumber: row.page_number,
      source: row.search_type
    }))

    console.log(`\n✓ Hybrid search complete: ${results.length} results`)
    if (results.length > 0) {
      console.log(`  - Top result: ${results[0].source} (score: ${results[0].score.toFixed(4)})`)
    }

    return results
  } catch (error) {
    console.error('❌ Supabase hybrid search failed:', error)
    // Fallback to semantic-only search
    return semanticSearch(queryEmbedding, userId, topK)
  }
}

/**
 * Semantic-only search using Supabase RPC function
 */
export async function semanticSearch(
  queryEmbedding: number[],
  userId: string,
  topK: number = 10,
  minSimilarity: number = 0.3
): Promise<SearchResult[]> {
  console.log(`🔍 Semantic Search (Supabase pgvector)`)

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

  const results: SearchResult[] = (data as any[]).map((row) => ({
    content: row.content,
    fileName: row.file_name,
    score: row.similarity,
    chunkIndex: row.chunk_index,
    pageNumber: row.page_number,
    source: 'semantic'
  }))

  console.log(`✓ Semantic search complete: ${results.length} results`)
  return results
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
 * Store document chunk with embedding in Supabase
 */
export async function storeChunk(
  documentId: string,
  content: string,
  embedding: number[],
  chunkIndex: number,
  pageNumber: number | null
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('document_chunks')
    .insert({
      document_id: documentId,
      content,
      embedding: JSON.stringify(embedding),
      chunk_index: chunkIndex,
      page_number: pageNumber,
      metadata: {}
    })

  if (error) {
    console.error('❌ Failed to store chunk:', error)
    throw error
  }
}
