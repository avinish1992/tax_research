/**
 * Cross-Encoder Reranking for PageIndex
 *
 * Uses Jina Rerank API (free tier available) or Cohere as fallback
 * to improve retrieval precision after initial tree-based recall.
 * Cross-encoders provide better relevance scoring than bi-encoders.
 *
 * Priority: Jina (free tier) > Cohere (paid) > Keyword (local fallback)
 *
 * Research: Based on LlamaIndex best practices, Jina/Cohere reranking docs
 */

import { RetrievalSource } from './types';

// Lazy client initialization for Cohere (optional)
let _cohereInitialized = false;
let _cohere: any = null;

async function getCohere(): Promise<any> {
  if (!_cohereInitialized) {
    try {
      const { CohereClient } = await import('cohere-ai');
      const apiKey = process.env.COHERE_API_KEY;
      if (apiKey) {
        _cohere = new CohereClient({ token: apiKey });
      }
    } catch {
      // Cohere not available
    }
    _cohereInitialized = true;
  }
  return _cohere;
}

export interface RerankedSource extends RetrievalSource {
  originalRank: number;
  rerankedScore: number;
}

export interface RerankOptions {
  topK?: number;           // Max sources to return after reranking
  minScore?: number;       // Minimum relevance score (0-1)
  provider?: 'jina' | 'cohere' | 'keyword';  // Reranking provider
  model?: string;          // Model to use (provider-specific)
}

/**
 * Rerank using Jina Reranker API (FREE TIER available)
 * https://jina.ai/reranker/
 */
async function rerankWithJina(
  query: string,
  sources: RetrievalSource[],
  topK: number,
  minScore: number
): Promise<RerankedSource[] | null> {
  const jinaApiKey = process.env.JINA_API_KEY;
  if (!jinaApiKey) {
    return null;
  }

  try {
    console.log(`🔄 Reranking ${sources.length} sources with Jina (free tier)...`);
    const startTime = Date.now();

    const response = await fetch('https://api.jina.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jinaApiKey}`,
      },
      body: JSON.stringify({
        model: 'jina-reranker-v2-base-multilingual',
        query,
        documents: sources.map(s => `${s.title}\n${s.section_path}\n\n${s.content}`),
        top_n: topK,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Jina rerank error:', error);
      return null;
    }

    const data = await response.json();
    const rerankTime = Date.now() - startTime;
    console.log(`   Jina reranking completed in ${rerankTime}ms`);

    const rerankedSources: RerankedSource[] = [];
    for (const result of data.results || []) {
      if (result.relevance_score < minScore) continue;

      const originalSource = sources[result.index];
      rerankedSources.push({
        ...originalSource,
        originalRank: result.index + 1,
        rerankedScore: result.relevance_score,
      });
    }

    console.log(`   Filtered to ${rerankedSources.length} sources (min score: ${minScore})`);
    return rerankedSources;
  } catch (error) {
    console.error('Jina reranking failed:', error);
    return null;
  }
}

/**
 * Rerank using Cohere Rerank API (PAID)
 */
async function rerankWithCohere(
  query: string,
  sources: RetrievalSource[],
  topK: number,
  minScore: number,
  model: string = 'rerank-english-v3.0'
): Promise<RerankedSource[] | null> {
  const cohere = await getCohere();
  if (!cohere) {
    return null;
  }

  try {
    console.log(`🔄 Reranking ${sources.length} sources with Cohere...`);
    const startTime = Date.now();

    const documents = sources.map(s => ({
      text: `${s.title}\n${s.section_path}\n\n${s.content}`
    }));

    const response = await cohere.rerank({
      model,
      query,
      documents,
      topN: topK,
      returnDocuments: false,
    });

    const rerankTime = Date.now() - startTime;
    console.log(`   Cohere reranking completed in ${rerankTime}ms`);

    const rerankedSources: RerankedSource[] = [];
    for (const result of response.results) {
      if (result.relevanceScore < minScore) continue;

      const originalSource = sources[result.index];
      rerankedSources.push({
        ...originalSource,
        originalRank: result.index + 1,
        rerankedScore: result.relevanceScore,
      });
    }

    console.log(`   Filtered to ${rerankedSources.length} sources (min score: ${minScore})`);
    return rerankedSources;
  } catch (error) {
    console.error('Cohere reranking failed:', error);
    return null;
  }
}

/**
 * Rerank retrieved sources using cross-encoder
 *
 * Priority: Jina (free) > Cohere (paid) > Keyword (local fallback)
 *
 * @param query - The user query
 * @param sources - Initial retrieval sources from PageIndex
 * @param options - Reranking configuration
 * @returns Reranked sources sorted by relevance
 */
export async function rerankSources(
  query: string,
  sources: RetrievalSource[],
  options: RerankOptions = {}
): Promise<RerankedSource[]> {
  const {
    topK = 5,
    minScore = 0.3,
    provider,
    model,
  } = options;

  // Early return if no sources or few sources
  if (sources.length === 0) {
    return [];
  }

  // If we have fewer sources than topK, no need to rerank
  if (sources.length <= topK) {
    return sources.map((s, i) => ({
      ...s,
      originalRank: i + 1,
      rerankedScore: 1.0 - (i * 0.1),
    }));
  }

  // Try providers in priority order
  let result: RerankedSource[] | null = null;

  // If specific provider requested
  if (provider === 'jina') {
    result = await rerankWithJina(query, sources, topK, minScore);
  } else if (provider === 'cohere') {
    result = await rerankWithCohere(query, sources, topK, minScore, model);
  } else if (provider === 'keyword') {
    return keywordRerank(query, sources, topK);
  }

  // Default: Try Jina first (free), then Cohere, then keyword fallback
  if (!result && provider !== 'cohere') {
    result = await rerankWithJina(query, sources, topK, minScore);
  }

  if (!result && provider !== 'jina') {
    result = await rerankWithCohere(query, sources, topK, minScore, model);
  }

  // Final fallback: keyword-based reranking (always available)
  if (!result) {
    console.log('   Using keyword-based reranking (no API keys configured)');
    return keywordRerank(query, sources, topK);
  }

  return result;
}

/**
 * Check if reranking is available
 * Returns true if Jina OR Cohere API key is configured
 * If neither is available, keyword fallback is always used
 */
export function isRerankingAvailable(): boolean {
  return !!(process.env.JINA_API_KEY || process.env.COHERE_API_KEY);
}

/**
 * Get the available reranking provider
 * Priority: Jina (free) > Cohere (paid) > keyword (local)
 */
export function getAvailableProvider(): 'jina' | 'cohere' | 'keyword' {
  if (process.env.JINA_API_KEY) return 'jina';
  if (process.env.COHERE_API_KEY) return 'cohere';
  return 'keyword';
}

/**
 * Simple keyword-based reranking fallback (no API required)
 * Uses TF-IDF-like scoring based on query term overlap
 */
export function keywordRerank(
  query: string,
  sources: RetrievalSource[],
  topK: number = 5
): RerankedSource[] {
  // Extract query terms (lowercase, remove common words)
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'just', 'don', 'now', 'what', 'which', 'who', 'this', 'that', 'these', 'those', 'am', 'it', 'its', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'about']);

  const queryTerms = query.toLowerCase()
    .split(/\W+/)
    .filter(t => t.length > 2 && !stopWords.has(t));

  // Score each source
  const scored = sources.map((source, index) => {
    const text = `${source.title} ${source.section_path} ${source.content}`.toLowerCase();

    // Count term occurrences
    let score = 0;
    for (const term of queryTerms) {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        score += matches.length;
      }
    }

    // Normalize by text length (TF-IDF-like)
    const normalizedScore = score / Math.sqrt(text.length);

    return {
      source,
      originalRank: index + 1,
      score: normalizedScore,
    };
  });

  // Sort by score and take topK
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(item => ({
      ...item.source,
      originalRank: item.originalRank,
      rerankedScore: item.score,
    }));
}
