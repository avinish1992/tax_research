/**
 * Test-only endpoint for RAG accuracy testing
 * Bypasses auth for local development testing
 *
 * WARNING: This endpoint should be disabled in production
 */

import { NextRequest, NextResponse } from 'next/server';
import { retrieveFromTree, filterCitedSources, renumberCitations } from '@/lib/pageindex/retriever';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import {
  quickOffTopicFilter,
  shouldProceedWithResponse,
  OFF_TOPIC_RESPONSES,
  type OffTopicCheckResult,
} from '@/lib/pageindex/retrieval-confidence-gate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Only allow in development
const ALLOW_TEST_ENDPOINT = process.env.NODE_ENV === 'development' || process.env.ALLOW_TEST_ENDPOINT === 'true';

// Create admin client for bypassing RLS in tests
function createTestClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Use service role if available to bypass RLS, otherwise anon key
  return createSupabaseClient(supabaseUrl, serviceRoleKey || anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

interface TestRequest {
  query: string;
  model?: string;
  documentId?: string;
  // Pipeline configuration options
  maxDocs?: number;           // Number of documents to retrieve from (default: 5)
  retrievalModel?: string;    // Model for retrieval (default: gpt-4o-mini)
  maxSourcesPerDoc?: number;  // Max sources per document (default: 3)
}

interface DocumentWithTree {
  id: string;
  file_name: string;
  tree_json: any;
  docDescription: string;
}

// Pre-filter documents based on query relevance (matching main chat route logic)
function preFilterDocuments(
  documents: DocumentWithTree[],
  query: string,
  maxDocs: number = 10
): DocumentWithTree[] {
  const queryLower = query.toLowerCase();

  // Extract key terms from query (remove common words)
  const stopWords = new Set(['what', 'are', 'the', 'in', 'of', 'to', 'for', 'is', 'a', 'an', 'and', 'or', 'how', 'does', 'do', 'can', 'uae', 'under', 'about', 'say', 'says']);
  const queryTerms = queryLower
    .split(/\s+/)
    .filter(term => term.length > 2 && !stopWords.has(term));

  // Score each document based on term matches
  const scoredDocs = documents.map(doc => {
    let score = 0;
    const fileName = doc.file_name.toLowerCase();
    const description = (doc.docDescription || '').toLowerCase();

    for (const term of queryTerms) {
      if (fileName.includes(term)) score += 10;
      if (description.includes(term)) score += 5;
    }

    // Bonus for exact multi-word phrase matches
    const phrases = [
      'transfer pricing', 'free zone', 'tax group', 'withholding tax',
      'small business', 'participation exemption', 'qualifying income',
      'permanent establishment', 'anti-abuse', 'gaar', 'general anti',
      'tax registration', 'tax residency', 'taxable income', 'exempt income',
      'related parties', 'connected persons', 'qualifying investment',
      'interest deduction', 'deduction limitation', 'qualifying activities'
    ];
    for (const phrase of phrases) {
      if (queryLower.includes(phrase)) {
        if (fileName.includes(phrase.replace(' ', '-')) || fileName.includes(phrase.replace(' ', '_')) || fileName.includes(phrase)) {
          score += 20;
        }
        if (description.includes(phrase)) {
          score += 15;
        }
      }
    }

    // Always include the main Federal Decree-Law
    if (fileName.includes('federal-decree-law-no.-47') || fileName.includes('federal decree-law')) {
      score += 5;
    }

    return { doc, score };
  });

  // Sort by score descending and take top N
  const sorted = scoredDocs.sort((a, b) => b.score - a.score);
  const selected = sorted.slice(0, maxDocs);

  console.log(`📋 Pre-filtered ${documents.length} docs -> top ${selected.length}:`);
  selected.forEach(s => console.log(`   [${s.score}] ${s.doc.file_name}`));

  return selected.map(s => s.doc);
}

export async function POST(request: NextRequest) {
  // Security check
  if (!ALLOW_TEST_ENDPOINT) {
    return NextResponse.json({ error: 'Test endpoint disabled' }, { status: 403 });
  }

  try {
    const body: TestRequest = await request.json();
    const {
      query,
      model = 'gpt-4o-mini',
      documentId,
      maxDocs = 5,
      retrievalModel = 'gpt-4o-mini',
      maxSourcesPerDoc = 3,
    } = body;

    // Track token usage for cost calculation
    let totalTokens = { prompt: 0, completion: 0, total: 0 };
    let retrievalTokens = { prompt: 0, completion: 0, total: 0 };

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const startTime = Date.now();
    const supabase = createTestClient();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // === QUICK OFF-TOPIC FILTER (PageIndex-aligned) ===
    // Only filter obvious off-topic queries, let domain queries go to retrieval
    const offTopicCheck = quickOffTopicFilter(query);
    if (offTopicCheck.isOffTopic) {
      const declineResponse = OFF_TOPIC_RESPONSES[offTopicCheck.category as keyof typeof OFF_TOPIC_RESPONSES] || OFF_TOPIC_RESPONSES.programming;
      console.log(`🚫 Off-topic: ${offTopicCheck.category} - ${offTopicCheck.reason}`);
      return NextResponse.json({
        success: true,
        query,
        model,
        response: declineResponse,
        sources: [],
        metrics: {
          totalTimeMs: Date.now() - startTime,
          ragTimeMs: 0,
          llmTimeMs: 0,
          retrievalConfidence: 'declined',
          sourcesRetrieved: 0,
          sourcesCited: 0,
        },
        offTopicCheck: {
          isOffTopic: true,
          category: offTopicCheck.category,
          reason: offTopicCheck.reason,
        },
      });
    }

    // Get ALL documents with trees (no artificial limit)
    let documentsQuery = supabase
      .from('documents')
      .select(`
        id,
        file_name,
        document_trees (
          id,
          tree_json
        )
      `)
      .eq('tree_indexed', true);

    if (documentId) {
      documentsQuery = documentsQuery.eq('id', documentId);
    }

    const { data: allDocuments, error: docError } = await documentsQuery;

    if (docError || !allDocuments || allDocuments.length === 0) {
      return NextResponse.json({
        error: 'No tree-indexed documents found',
        details: docError?.message,
      }, { status: 404 });
    }

    console.log(`📚 Found ${allDocuments.length} indexed documents`);

    // Pre-filter documents based on query relevance (like main chat route)
    const docsWithTrees: DocumentWithTree[] = allDocuments
      .filter(d => d.document_trees?.[0]?.tree_json)
      .map(d => ({
        id: d.id,
        file_name: d.file_name,
        tree_json: d.document_trees![0].tree_json,
        docDescription: (d.document_trees![0].tree_json as any)?.doc_description || '',
      }));

    const documents = preFilterDocuments(docsWithTrees, query, maxDocs);

    // Retrieve from all document trees IN PARALLEL
    const ragStartTime = Date.now();
    const allSources: any[] = [];
    const allContent: string[] = [];
    let retrievalReasoning = '';
    let retrievalConfidence = 'medium';

    // Parallel retrieval - all docs at once
    const retrievalPromises = documents
      .filter(doc => doc.tree_json)
      .map(async (doc) => {
        try {
          const result = await retrieveFromTree(doc.tree_json, query, {
            model: retrievalModel,
            maxSources: maxSourcesPerDoc,
          });
          // Track retrieval tokens if available
          if (result.usage) {
            retrievalTokens.prompt += result.usage.prompt_tokens || 0;
            retrievalTokens.completion += result.usage.completion_tokens || 0;
            retrievalTokens.total += result.usage.total_tokens || 0;
          }
          return { doc, result, error: null };
        } catch (err) {
          console.error(`Error retrieving from ${doc.file_name}:`, err);
          return { doc, result: null, error: err };
        }
      });

    const retrievalResults = await Promise.all(retrievalPromises);

    // Process results
    for (const { doc, result } of retrievalResults) {
      if (!result) continue;

      if (result.reasoning) {
        retrievalReasoning = result.reasoning;
      }
      if (result.confidence) {
        retrievalConfidence = result.confidence;
      }

      // Format sources with document context
      for (let i = 0; i < result.sources.length; i++) {
        const source = result.sources[i];
        allSources.push({
          index: allSources.length + 1,
          nodeId: source.node_id,
          fileName: doc.file_name,
          sectionPath: source.section_path,
          pageStart: source.pages.start,
          pageEnd: source.pages.end,
          content: source.content?.substring(0, 1000) || '',
          summary: source.summary,
          documentId: doc.id,
        });
      }

      if (result.content) {
        allContent.push(result.content);
      }
    }

    const ragTimeMs = Date.now() - ragStartTime;

    // Build context for LLM
    const context = allSources
      .map((s, i) => `[${i + 1}] ${s.sectionPath} (Pages ${s.pageStart}-${s.pageEnd})\n${s.content}`)
      .join('\n\n' + '='.repeat(60) + '\n\n');

    // Generate response with OpenAI (reuse instance from classification)

    const systemPrompt = `You are a legal AI assistant specialized in UAE Corporate Tax Law.

CITATION GUIDELINES (CRITICAL - FOLLOW EXACTLY):
When referencing information from the provided documents, use INLINE numbered citations [1], [2], etc.

⚠️ IMPORTANT: Citations MUST appear INLINE after EACH fact, NOT grouped at the end of paragraphs.

CORRECT (inline citations):
"The corporate tax rate is 9% for income above AED 375,000 [1]. Small businesses with revenue below the threshold may qualify for relief [2]."

WRONG (grouped at end):
"The corporate tax rate is 9% for income above AED 375,000. Small businesses may qualify for relief. [1][2]"

CITATION RULES:
1. Place citation IMMEDIATELY after each fact or claim (same sentence)
2. NEVER save citations for the end of a paragraph
3. ONLY cite sources whose content you ACTUALLY USE
4. Multiple sources for one claim: "Relief may be available [1][2]."

If the question is outside the scope of the provided documents, clearly state that you cannot find relevant information.`;

    const userPrompt = `Based on the following document excerpts, answer the question.

DOCUMENTS:
${context}

QUESTION: ${query}

Provide a clear, accurate answer with inline citations.`;

    const llmStartTime = Date.now();
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const llmTimeMs = Date.now() - llmStartTime;
    let response = completion.choices[0]?.message?.content || '';

    // Track response generation tokens
    if (completion.usage) {
      totalTokens.prompt = retrievalTokens.prompt + (completion.usage.prompt_tokens || 0);
      totalTokens.completion = retrievalTokens.completion + (completion.usage.completion_tokens || 0);
      totalTokens.total = retrievalTokens.total + (completion.usage.total_tokens || 0);
    }

    // Filter and renumber citations
    const citedSources = filterCitedSources(response, allSources.map(s => ({
      node_id: s.nodeId,
      title: s.sectionPath,
      section_path: s.sectionPath,
      pages: { start: s.pageStart, end: s.pageEnd },
      content: s.content,
    })));

    const originalSources = allSources.map(s => ({
      node_id: s.nodeId,
      title: s.sectionPath,
      section_path: s.sectionPath,
      pages: { start: s.pageStart, end: s.pageEnd },
      content: s.content,
    }));

    response = renumberCitations(response, originalSources, citedSources);

    // Renumber the sources to match
    const filteredSources = allSources.filter((_, i) =>
      citedSources.some(cs => cs.node_id === allSources[i].nodeId)
    ).map((s, i) => ({ ...s, index: i + 1 }));

    const totalTimeMs = Date.now() - startTime;

    // Calculate estimated cost (USD) - OpenAI pricing as of Jan 2025
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
      'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
    };
    const retrievalPricing = pricing[retrievalModel] || pricing['gpt-4o-mini'];
    const responsePricing = pricing[model] || pricing['gpt-4o-mini'];

    const retrievalCost = (retrievalTokens.prompt * retrievalPricing.input) +
                          (retrievalTokens.completion * retrievalPricing.output);
    const responseCost = ((completion.usage?.prompt_tokens || 0) * responsePricing.input) +
                         ((completion.usage?.completion_tokens || 0) * responsePricing.output);
    const totalCost = retrievalCost + responseCost;

    return NextResponse.json({
      success: true,
      query,
      model,
      response,
      sources: filteredSources,
      config: {
        maxDocs,
        retrievalModel,
        maxSourcesPerDoc,
        responseModel: model,
      },
      metrics: {
        totalTimeMs,
        ragTimeMs,
        llmTimeMs,
        retrievalConfidence,
        sourcesRetrieved: allSources.length,
        sourcesCited: filteredSources.length,
      },
      tokens: {
        retrieval: retrievalTokens,
        response: {
          prompt: completion.usage?.prompt_tokens || 0,
          completion: completion.usage?.completion_tokens || 0,
          total: completion.usage?.total_tokens || 0,
        },
        total: totalTokens,
      },
      cost: {
        retrieval: retrievalCost,
        response: responseCost,
        total: totalCost,
        currency: 'USD',
      },
      retrieval: {
        reasoning: retrievalReasoning,
        confidence: retrievalConfidence,
        totalSources: allSources.length,
      },
    });
  } catch (error) {
    console.error('Test accuracy error:', error);
    return NextResponse.json({
      error: 'Test failed',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
