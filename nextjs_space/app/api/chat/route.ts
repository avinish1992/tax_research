
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
// NOTE: supabase-rag (vector-based) replaced by PageIndex tree-based retrieval
import {
  getChatSessionWithMessages,
  createMessage,
  updateChatSessionTimestamp,
} from '@/lib/supabase-db'
import { createClient } from '@/utils/supabase/server'
import { classifyQuery as classifyQueryParams, describeClassification } from '@/lib/query-classifier'
import {
  quickOffTopicFilter,
  shouldProceedWithResponse,
  OFF_TOPIC_RESPONSES,
  type OffTopicCheckResult,
} from '@/lib/pageindex/retrieval-confidence-gate'
import {
  retrieveFromMultipleTrees,
  formatRetrievalAsContext,
  formatSourcesForDisplay,
  filterCitedSources,
  renumberCitations,
  type DocumentTree,
  type RetrievalResult,
  type RetrievalSource,
} from '@/lib/pageindex'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'

// Latency metrics interface
interface LatencyMetrics {
  requestId: string
  timestamp: string
  // Timing breakdown (all in ms)
  authTimeMs: number
  sessionFetchTimeMs: number
  ragTotalTimeMs: number
  ragEmbeddingTimeMs: number
  ragSearchTimeMs: number
  llmTtftMs: number           // Time to First Token
  llmStreamDurationMs: number // Time from first to last token
  llmTotalTimeMs: number      // Total LLM call time
  totalRequestTimeMs: number  // End-to-end time
  // Token metrics
  tokenCount: number
  tokensPerSecond: number
  responseCharCount: number
  // Context info
  queryLength: number
  ragChunksRetrieved: number
  model: string
  userId: string
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Detect if user wants exact quotes/verbatim text from documents
 * Returns true for requests like "quote Article 50", "exact text of...", "verbatim"
 */
function isQuoteModeRequest(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const quoteIndicators = [
    'quote',
    'exact text',
    'verbatim',
    'word for word',
    'exact wording',
    'cite exactly',
    'full text of',
    'complete text',
    'actual text',
    'original text',
    'as written',
    'copy of',
  ]
  return quoteIndicators.some(indicator => lowerMessage.includes(indicator))
}

/**
 * Detect if query is a follow-up that needs context enrichment
 * Returns true for vague follow-ups like "what about this", "tell me more", "implications"
 */
function isFollowUpQuery(message: string): boolean {
  const lowerMessage = message.toLowerCase()
  const followUpIndicators = [
    'this',
    'that',
    'it',
    'more about',
    'tell me more',
    'explain more',
    'dive deeper',
    'implications',
    'what about',
    'how about',
    'can you explain',
    'elaborate',
  ]
  return followUpIndicators.some(indicator => lowerMessage.includes(indicator)) &&
    message.length < 100 // Short messages are likely follow-ups
}

/**
 * Enrich a follow-up query with context from previous messages
 * Extracts key entities (Article X, legal concepts) from recent messages
 */
function enrichQueryWithContext(
  message: string,
  previousMessages: Array<{ role: string; content: string }>
): string {
  // Get last few assistant/user exchanges to find context
  const recentContext = previousMessages
    .slice(-4) // Last 4 messages
    .map(m => m.content)
    .join(' ')

  // Extract key entities from context
  const entities: string[] = []

  // Find Article references
  const articleMatches = recentContext.matchAll(/Article\s+(\d+)/gi)
  for (const match of articleMatches) {
    entities.push(`Article ${match[1]}`)
  }

  // Find legal concepts mentioned
  const legalConcepts = ['GAAR', 'anti-abuse', 'transfer pricing', 'withholding', 'corporate tax', 'Free Zone']
  legalConcepts.forEach(concept => {
    if (recentContext.toLowerCase().includes(concept.toLowerCase())) {
      entities.push(concept)
    }
  })

  // Find document names mentioned
  const docMatches = recentContext.matchAll(/Federal\s+Decree[- ]Law(?:\s+No\.?)?\s*(\d+)?/gi)
  for (const match of docMatches) {
    entities.push(match[0])
  }

  if (entities.length > 0) {
    const uniqueEntities = [...new Set(entities)]
    const contextPrefix = `Regarding ${uniqueEntities.slice(0, 3).join(', ')}: `
    console.log(`📝 Query enriched with context: "${contextPrefix}${message}"`)
    return contextPrefix + message
  }

  return message
}

/**
 * Pre-filter documents based on query relevance using keyword matching
 * This reduces the number of expensive LLM calls by only processing likely-relevant documents
 */
interface DocumentWithTree {
  tree: DocumentTree
  documentId: string
  documentName: string
  storagePath: string
  docDescription?: string
}

function preFilterDocuments(
  documents: DocumentWithTree[],
  query: string,
  maxDocs: number = 10
): DocumentWithTree[] {
  const queryLower = query.toLowerCase()

  // Check if query mentions specific articles (e.g., "Article 50", "Article 23")
  const articleMatch = queryLower.match(/article\s*(\d+)/i)
  const hasArticleReference = !!articleMatch

  // Extract key terms from query (remove common words)
  const stopWords = new Set(['what', 'are', 'the', 'in', 'of', 'to', 'for', 'is', 'a', 'an', 'and', 'or', 'how', 'does', 'do', 'can', 'uae', 'under', 'about', 'say', 'says'])
  const queryTerms = queryLower
    .split(/\s+/)
    .filter(term => term.length > 2 && !stopWords.has(term))

  // Score each document based on term matches
  const scoredDocs = documents.map(doc => {
    let score = 0
    const fileName = doc.documentName.toLowerCase()
    const description = (doc.docDescription || '').toLowerCase()

    for (const term of queryTerms) {
      // Higher weight for filename matches
      if (fileName.includes(term)) {
        score += 10
      }
      // Medium weight for description matches
      if (description.includes(term)) {
        score += 5
      }
    }

    // Bonus for exact multi-word phrase matches
    const phrases = [
      'transfer pricing', 'free zone', 'tax group', 'withholding tax',
      'small business', 'participation exemption', 'qualifying income',
      'permanent establishment', 'anti-abuse', 'gaar', 'general anti',
      'tax registration', 'tax residency', 'taxable income', 'exempt income',
      'related parties', 'connected persons', 'qualifying investment'
    ]
    for (const phrase of phrases) {
      if (queryLower.includes(phrase)) {
        if (fileName.includes(phrase.replace(' ', '-')) || fileName.includes(phrase.replace(' ', '_')) || fileName.includes(phrase)) {
          score += 20
        }
        if (description.includes(phrase)) {
          score += 15
        }
      }
    }

    // Core law documents - ALWAYS include with high priority when:
    // 1. Query references specific articles
    // 2. Query mentions general concepts that are in the main law
    const isCoreDoc = fileName.includes('federal-decree-law') ||
      (fileName.includes('corporate tax') && fileName.includes('general'))

    if (isCoreDoc) {
      if (hasArticleReference) {
        // When asking about specific articles, core law docs are essential
        score += 50
      } else {
        // General questions - include core docs but don't dominate
        score += 5
      }
    }

    // Executive Regulation is also important for article references
    if (hasArticleReference && fileName.includes('executive regulation')) {
      score += 30
    }

    return { doc, score }
  })

  // Sort by score descending
  scoredDocs.sort((a, b) => b.score - a.score)

  // Take top scoring documents
  let filtered = scoredDocs
    .filter(d => d.score > 0)
    .slice(0, maxDocs)
    .map(d => d.doc)

  // If article reference but not enough docs, ensure core docs are included
  if (hasArticleReference && filtered.length < 3) {
    const coreDocs = documents.filter(d => {
      const name = d.documentName.toLowerCase()
      return name.includes('federal-decree-law') || name.includes('executive regulation')
    })
    const existingIds = new Set(filtered.map(d => d.documentId))
    for (const coreDoc of coreDocs) {
      if (!existingIds.has(coreDoc.documentId)) {
        filtered.push(coreDoc)
        if (filtered.length >= maxDocs) break
      }
    }
  }

  // If no matches at all, fall back to core documents
  if (filtered.length === 0) {
    const coreDocs = documents.filter(d => {
      const name = d.documentName.toLowerCase()
      return name.includes('corporate tax') || name.includes('federal-decree-law')
    }).slice(0, 5)
    return coreDocs.length > 0 ? coreDocs : documents.slice(0, maxDocs)
  }

  console.log(`   📑 Pre-filtered ${documents.length} documents → ${filtered.length} (max 3 for optimal accuracy/speed)`)
  console.log(`   Top matches: ${filtered.slice(0, 3).map(d => d.documentName).join(', ')}`)
  if (hasArticleReference) {
    console.log(`   🔍 Article reference detected: Article ${articleMatch![1]}`)
  }

  return filtered
}

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now()
  const requestId = generateRequestId()

  // Initialize metrics object
  const metrics: Partial<LatencyMetrics> = {
    requestId,
    timestamp: new Date().toISOString(),
  }

  try {
    // === AUTH TIMING ===
    const authStartTime = Date.now()
    const user = await getAuthenticatedUser()
    metrics.authTimeMs = Date.now() - authStartTime

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { chatSessionId, message, model } = body

    if (!chatSessionId || !message) {
      return NextResponse.json(
        { error: 'Chat session ID and message are required' },
        { status: 400 }
      )
    }

    metrics.queryLength = message.length
    metrics.userId = user.id

    // === SESSION FETCH TIMING ===
    const sessionFetchStartTime = Date.now()
    const chatSession = await getChatSessionWithMessages(chatSessionId, user.id, 10)
    metrics.sessionFetchTimeMs = Date.now() - sessionFetchStartTime

    if (!chatSession) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 })
    }

    // Save user message (using Supabase) and capture real ID
    const userMessage = await createMessage({
      chatSessionId,
      role: 'user',
      content: message,
    })

    // === QUICK OFF-TOPIC FILTER (PageIndex-Aligned) ===
    // Only filter truly off-topic queries (programming, weather, VAT)
    // Domain-specific terms (GAAR, QFZP, etc.) go to retrieval - no keyword maintenance needed
    const offTopicCheck = quickOffTopicFilter(message)

    if (offTopicCheck.isOffTopic) {
      console.log(`\n⛔ Quick off-topic filter: ${offTopicCheck.category}`)
      console.log(`   Reason: ${offTopicCheck.reason}`)

      const declineResponse = OFF_TOPIC_RESPONSES[offTopicCheck.category || 'other_domain']

      // Save the decline response as assistant message
      const assistantMessage = await createMessage({
        chatSessionId,
        role: 'assistant',
        content: declineResponse,
        metadata: {
          offTopicFilter: {
            category: offTopicCheck.category,
            reason: offTopicCheck.reason,
          }
        },
      })

      await updateChatSessionTimestamp(chatSessionId)

      // Return as streaming response (for consistency with frontend)
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          // Send filter info
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            offTopicFilter: {
              category: offTopicCheck.category,
              reason: offTopicCheck.reason,
              action: 'declined'
            }
          })}\n\n`))

          // Send response as streaming tokens (simulate)
          const words = declineResponse.split(' ')
          for (const word of words) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              choices: [{ delta: { content: word + ' ' } }]
            })}\n\n`))
          }

          // Send message IDs
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            messageIds: {
              userMessageId: userMessage.id,
              assistantMessageId: assistantMessage.id,
            }
          })}\n\n`))

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        }
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
        },
      })
    }

    // Get previous messages for context enrichment
    const previousMessages = chatSession?.messages?.map((m: { content: string }) => m.content) || []

    // === PAGEINDEX TREE-BASED RETRIEVAL ===
    // Uses LLM reasoning through document structure instead of vector similarity
    let retrievalResult: RetrievalResult | null = null
    let retrievalSources: RetrievalSource[] = []
    let documentTreeCount = 0 // Track tree count for thinking display

    // === RAG TIMING ===
    const ragStartTime = Date.now()
    metrics.ragEmbeddingTimeMs = 0
    metrics.ragSearchTimeMs = 0

    try {
      console.log('\n' + '='.repeat(80))
      console.log(`🌳 PAGEINDEX TREE RETRIEVAL [${requestId}]`)
      console.log('='.repeat(80))
      console.log(`Query: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`)

      // Step 0: Enrich follow-up queries with conversational context
      let ragQuery = message
      if (isFollowUpQuery(message) && chatSession?.messages?.length > 0) {
        ragQuery = enrichQueryWithContext(message, chatSession.messages)
      }

      // Step 0.5: Classify query for retrieval parameters (topK, similarity)
      const retrieverClassification = classifyQueryParams(ragQuery)
      console.log(`\n📊 Retrieval Parameters: ${describeClassification(retrieverClassification)}`)

      // Step 1: Fetch document trees for user's documents
      const supabase = await createClient()
      console.log('\n📚 Fetching document trees...')
      const treeStartTime = Date.now()

      const { data: trees, error: treeError } = await supabase
        .from('document_trees')
        .select(`
          id,
          document_id,
          tree_json,
          documents!inner (
            id,
            file_name,
            storage_path,
            user_id
          )
        `)
        .eq('documents.user_id', user.id)

      if (treeError) {
        console.error('Error fetching document trees:', treeError)
        throw treeError
      }

      metrics.ragEmbeddingTimeMs = Date.now() - treeStartTime // Reuse for tree fetch time
      documentTreeCount = trees?.length || 0
      console.log(`   Found ${documentTreeCount} indexed documents in ${metrics.ragEmbeddingTimeMs}ms`)

      if (trees && trees.length > 0) {
        // Step 2: Tree-based retrieval using LLM reasoning
        console.log('\n🤔 Running LLM reasoning through document trees...')
        const searchStartTime = Date.now()

        // Prepare trees with document info for retrieval
        const allTreesWithDocs: DocumentWithTree[] = trees.map(t => ({
          tree: t.tree_json as DocumentTree,
          documentId: t.document_id,
          documentName: (t.documents as any).file_name,
          storagePath: (t.documents as any).storage_path,
          docDescription: (t.tree_json as any).doc_description || '',
        }))

        // Pre-filter documents based on query relevance
        // Optimal config: 3 docs based on pipeline comparison testing
        // 3-docs achieved 96.7% pass rate vs 70% for 1-doc, with minimal latency increase
        const treesWithDocs = preFilterDocuments(allTreesWithDocs, ragQuery, 3)

        // Retrieve from filtered document trees using LLM reasoning
        // Uses gpt-4o-mini for retrieval (faster/cheaper), response uses gpt-4o-mini
        const multiTreeResult = await retrieveFromMultipleTrees(
          treesWithDocs.map(t => ({ tree: t.tree, documentId: t.documentId })),
          ragQuery,
          {
            model: 'gpt-4o-mini',  // Changed from gpt-4o for cost efficiency
            maxSourcesPerDoc: 3,   // Reduced from 5 based on testing
          }
        )

        metrics.ragSearchTimeMs = Date.now() - searchStartTime
        console.log(`   Tree retrieval completed in ${metrics.ragSearchTimeMs}ms`)

        // Use the result with highest confidence (then most sources) for reasoning
        if (multiTreeResult.results.length > 0) {
          // Sort by confidence first, then by source count
          // High confidence with few sources is better than medium with many
          const sortedResults = [...multiTreeResult.results].sort((a, b) => {
            // First compare by confidence
            const confidenceOrder: Record<string, number> = { high: 3, medium: 2, low: 1 }
            const confDiff = (confidenceOrder[b.result.confidence] || 0) - (confidenceOrder[a.result.confidence] || 0)
            if (confDiff !== 0) return confDiff

            // Then by source count if same confidence
            return b.result.sources.length - a.result.sources.length
          })

          const bestResult = sortedResults[0].result
          console.log(`   Best result from doc ${sortedResults[0].documentId}: ${bestResult.sources.length} sources, ${bestResult.confidence} confidence`)

          retrievalResult = {
            node_ids: multiTreeResult.allSources.map(s => s.node_id),
            reasoning: bestResult.reasoning,
            confidence: bestResult.confidence,
            content: multiTreeResult.combinedContent,
            sources: multiTreeResult.allSources,
          }
          console.log(`   Reasoning: ${retrievalResult.reasoning.substring(0, 200)}...`)
          console.log(`   Confidence: ${retrievalResult.confidence}`)
          console.log(`   Retrieved ${retrievalResult.sources.length} sections`)
        }

        retrievalSources = multiTreeResult.allSources

        // Generate signed URLs for documents
        const documentUrls: Map<string, string | null> = new Map()

        for (const tree of treesWithDocs) {
          if (tree.storagePath) {
            const { data: urlData } = await supabase.storage
              .from('documents')
              .createSignedUrl(tree.storagePath, 3600)
            documentUrls.set(tree.documentId, urlData?.signedUrl || null)
          }
        }

        // Attach document info to sources for display
        // Match sources to their documents by finding which tree contains each node
        retrievalSources = retrievalSources.map(source => {
          // Find which document this source belongs to
          const docInfo = multiTreeResult.results.find(r =>
            r.result.sources.some(s => s.node_id === source.node_id)
          )
          const docId = docInfo?.documentId || treesWithDocs[0]?.documentId
          return {
            ...source,
            documentId: docId,
            fileUrl: documentUrls.get(docId) || null,
          }
        }) as any

        console.log('\n✅ Tree retrieval complete')
        console.log('='.repeat(80) + '\n')
      } else {
        console.log('\n⚠️ No indexed documents found for user')
        console.log('='.repeat(80) + '\n')
      }
    } catch (retrievalError) {
      console.error('❌ Error in tree retrieval pipeline:', retrievalError)
      console.log('   Continuing without context...\n')
      // Continue without context if retrieval fails
    }

    metrics.ragTotalTimeMs = Date.now() - ragStartTime
    metrics.ragChunksRetrieved = retrievalSources.length

    // === RETRIEVAL CONFIDENCE GATE (PageIndex-Aligned) ===
    // Use retrieval results to determine if query is answerable
    // This replaces keyword-based intent classification
    if (retrievalResult) {
      const confidenceGate = shouldProceedWithResponse(retrievalResult)
      console.log(`\n🚦 Confidence Gate: ${confidenceGate.proceed ? 'PROCEED' : 'LOW CONFIDENCE'}`)
      console.log(`   Reason: ${confidenceGate.reason}`)

      if (!confidenceGate.proceed && confidenceGate.suggestedResponse) {
        console.log(`\n⚠️ Low confidence retrieval - returning graceful response`)

        // Save the low-confidence response as assistant message
        const assistantMessage = await createMessage({
          chatSessionId,
          role: 'assistant',
          content: confidenceGate.suggestedResponse,
          metadata: {
            retrievalConfidence: {
              confidence: retrievalResult.confidence,
              sourceCount: retrievalResult.sources.length,
              reason: confidenceGate.reason,
            }
          },
        })

        await updateChatSessionTimestamp(chatSessionId)

        // Return as streaming response
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            // Send confidence info
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              retrievalConfidence: {
                confidence: retrievalResult!.confidence,
                sourceCount: retrievalResult!.sources.length,
                action: 'low_confidence'
              }
            })}\n\n`))

            // Send response as streaming tokens
            const words = confidenceGate.suggestedResponse!.split(' ')
            for (const word of words) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                choices: [{ delta: { content: word + ' ' } }]
              })}\n\n`))
            }

            // Send message IDs
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              messageIds: {
                userMessageId: userMessage.id,
                assistantMessageId: assistantMessage.id,
              }
            })}\n\n`))

            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          }
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
          },
        })
      }
    }

    // Build context from tree-based retrieval sources
    let contextText = ''

    // Create sources list for citations (PageIndex format)
    const sourcesList: Array<{
      index: number
      fileName: string
      pageNumber: number | null
      content: string
      documentId: string
      fileUrl: string | null
      similarity: number
      // New PageIndex fields for enhanced citations
      sectionPath: string
      title: string
      pageRange: { start: number; end: number }
      summary?: string
      nodeId: string
    }> = []

    if (retrievalSources.length > 0) {
      // Format context using PageIndex's structured format
      contextText = '\n\n=== UPLOADED LEGAL DOCUMENTS ===\n\n'

      retrievalSources.forEach((source, index) => {
        const sourceNum = index + 1
        const pageRange = `Pages ${source.pages.start}-${source.pages.end}`

        // Rich context format with section hierarchy
        contextText += `[${sourceNum}] ${source.section_path}\n`
        contextText += `    ${pageRange}\n`
        if (source.summary) {
          contextText += `    Summary: ${source.summary}\n`
        }
        contextText += `\n${source.content}\n\n---\n\n`

        // Add to sources list with enhanced PageIndex metadata
        sourcesList.push({
          index: sourceNum,
          fileName: source.title,
          pageNumber: source.pages.start,
          content: source.content.substring(0, 500) + (source.content.length > 500 ? '...' : ''),
          documentId: (source as any).documentId || '',
          fileUrl: (source as any).fileUrl || null,
          similarity: 1.0, // Tree retrieval doesn't use similarity scores
          // PageIndex-specific fields
          sectionPath: source.section_path,
          title: source.title,
          pageRange: source.pages,
          summary: source.summary,
          nodeId: source.node_id,
        })
      })

      contextText += '=== END OF DOCUMENTS ===\n\n'

      // Add reasoning context for the LLM
      if (retrievalResult?.reasoning) {
        contextText += `\n[Retrieval Reasoning: ${retrievalResult.reasoning}]\n\n`
      }
    }

    // Detect if user wants exact quotes
    const quoteMode = isQuoteModeRequest(message)

    // Single unified system prompt that handles all cases naturally
    const systemPrompt = `You are a helpful legal AI assistant specialized in UAE Corporate Tax Law. You have access to the user's uploaded legal documents which are provided below (if any).

SCOPE & GUARDRAILS (IMPORTANT):
- Your expertise is LIMITED to UAE Corporate Tax Law and related legal/tax matters
- You can ONLY answer questions based on the uploaded documents OR general legal/tax topics within your domain
- For questions OUTSIDE your scope (recipes, coding, entertainment, etc.): Politely redirect to tax-related queries
- NEVER provide answers from general knowledge on non-legal topics
- If asked to do something potentially harmful, unethical, or illegal: Refuse clearly and explain why

YOUR CAPABILITIES:
- Answer questions about UAE Corporate Tax Law documents
- Explain tax regulations, articles, and legal provisions
- Help users understand compliance requirements
- Respond to greetings and clarifying questions naturally

CITATION GUIDELINES (CRITICAL - FOLLOW EXACTLY):
When referencing information from the provided documents, use INLINE numbered citations [1], [2], etc.

⚠️ IMPORTANT: Citations MUST appear INLINE after EACH fact, NOT grouped at the end of paragraphs.

CORRECT (inline citations):
"The corporate tax rate is 9% for income above AED 375,000 [1]. Small businesses with revenue below the threshold may qualify for relief [2]. Transfer pricing rules require arm's length pricing [3]."

WRONG (grouped at end):
"The corporate tax rate is 9% for income above AED 375,000. Small businesses may qualify for relief. Transfer pricing rules require arm's length pricing. [1][2][3]"

CITATION RULES:
1. Place citation IMMEDIATELY after each fact or claim (same sentence)
2. NEVER save citations for the end of a paragraph
3. ONLY cite sources whose content you ACTUALLY USE
4. MATCH citations to specific content:
   - If you state "9%", cite the source containing that figure
   - If you mention "Article 50", cite the source with Article 50 text
5. Multiple sources for one claim: "Relief may be available [1][2]."

RESPONSE GUIDELINES:
1. For greetings (hello, hi, etc.): Respond naturally and briefly mention you can help with UAE tax questions.

2. For legal/tax questions WITH document context:
   - Answer using the provided documents WITH citations [1], [2], etc.
   - Be accurate and specific to the source material

3. For legal/tax questions WITHOUT document context:
   - Say "I don't have specific information about that in the uploaded documents."
   - Suggest uploading relevant documents OR rephrasing the question
   - Do NOT make up legal information

4. For OFF-TOPIC questions (non-legal/non-tax):
   - Politely decline: "I'm specialized in UAE Corporate Tax Law. I can help you with tax-related questions instead."
   - Do NOT answer from general knowledge on unrelated topics

5. Keep responses clear and well-organized. Use bullet points for complex legal answers.

${quoteMode ? `
QUOTE MODE ACTIVE - The user wants exact text from documents:
- Present the most relevant document excerpts as block quotes using markdown (> prefix)
- Format each quote with its source reference immediately after
- Example format:
  > "This is the exact text from the document..."
  — Source: Section Name [1], Pages X-Y

- Include multiple relevant excerpts if the content spans several sections
- Preserve the original formatting and punctuation
- If the exact requested text isn't found, quote the closest relevant content and explain
` : ''}
${retrievalSources.length > 0 ? `DOCUMENT CONTEXT PROVIDED BELOW - The AI has analyzed your documents and identified the most relevant sections using reasoning-based retrieval.

Each source shows:
- Section hierarchy path (e.g., "Chapter 4 > Article 12 > Penalties")
- Page range where the content appears
- The actual text content

Use the source numbers [1], [2], etc. when citing specific information:` : 'NOTE: No relevant documents found for this query. If this is a tax-related question, suggest the user upload relevant documents or rephrase. If off-topic, politely redirect.'}`

    const messages = [
      { role: 'system', content: systemPrompt + contextText },
      ...chatSession?.messages?.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })) ?? [],
      { role: 'user', content: message },
    ]

    // Validate OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is not configured')
      return NextResponse.json(
        { error: 'AI service is not properly configured. Please contact administrator.' },
        { status: 500 }
      )
    }

    // Use OpenAI models
    const selectedModel = model || chatSession?.model || 'gpt-4o-mini'
    metrics.model = selectedModel
    console.log(`[${requestId}] Using model: ${selectedModel}`)

    // === LLM TIMING ===
    const llmStartTime = Date.now()

    // Stream response from OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        stream: true,
        max_tokens: 3000,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('LLM API error:', response.status, errorText)
      
      // Provide user-friendly error messages
      let userMessage = 'Failed to get AI response'
      if (response.status === 401) {
        userMessage = 'Authentication failed with AI service'
      } else if (response.status === 429) {
        userMessage = 'Rate limit exceeded. Please try again in a moment'
      } else if (response.status >= 500) {
        userMessage = 'AI service is temporarily unavailable'
      }
      
      return NextResponse.json(
        { error: userMessage },
        { status: response.status }
      )
    }

    if (!response.body) {
      console.error('No response body from LLM API')
      return NextResponse.json(
        { error: 'Invalid response from AI service' },
        { status: 500 }
      )
    }

    let fullResponse = ''

    // LLM streaming metrics
    let firstTokenTime: number | null = null
    let lastTokenTime: number = Date.now()
    let tokenCount = 0

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        const encoder = new TextEncoder()
        let buffer = '' // Buffer for incomplete chunks

        try {
          // === PAGEINDEX-STYLE THINKING EVENT ===
          // Send thinking/reasoning data FIRST (before sources)
          // This allows the frontend to show "Thought for X seconds" with reasoning
          if (retrievalResult) {
            const thinkingData = {
              thinking: {
                reasoning: retrievalResult.reasoning || '',
                confidence: retrievalResult.confidence || 'medium',
                nodeList: retrievalResult.node_ids || [],
                retrievedSections: retrievalSources.slice(0, 10).map(s => ({
                  nodeId: s.node_id,
                  title: s.title,
                  sectionPath: s.section_path,
                  pageStart: s.pages.start,
                  pageEnd: s.pages.end,
                })),
                totalTimeMs: metrics.ragTotalTimeMs || 0,
                treeCount: documentTreeCount,
              }
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(thinkingData)}\n\n`))
          }

          // Send sources metadata at the start of the stream
          if (sourcesList.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources: sourcesList })}\n\n`))
          }

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            // Append new chunk to buffer
            buffer += decoder.decode(value, { stream: true })

            // Process complete lines (ending with \n)
            const lines = buffer.split('\n')
            // Keep the last potentially incomplete line in buffer
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmedLine = line.trim()
              if (!trimmedLine) continue

              if (trimmedLine.startsWith('data: ')) {
                const data = trimmedLine.slice(6).trim()
                if (data === '[DONE]') continue
                if (!data) continue

                try {
                  const parsed = JSON.parse(data)
                  const content = parsed?.choices?.[0]?.delta?.content
                  if (content) {
                    // Track TTFT on first token
                    if (!firstTokenTime) {
                      firstTokenTime = Date.now()
                      metrics.llmTtftMs = firstTokenTime - llmStartTime
                      console.log(`[${requestId}] ⚡ TTFT: ${metrics.llmTtftMs}ms`)
                    }
                    tokenCount++
                    lastTokenTime = Date.now()
                    fullResponse += content
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`))
                  }
                } catch (e) {
                  // JSON parse failed - likely incomplete data, skip this chunk
                  // This can happen with malformed responses, just continue
                  console.warn('Skipping malformed JSON chunk')
                }
              }
            }
          }

          // Process any remaining data in buffer
          if (buffer.trim()) {
            const trimmedLine = buffer.trim()
            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6).trim()
              if (data && data !== '[DONE]') {
                try {
                  const parsed = JSON.parse(data)
                  const content = parsed?.choices?.[0]?.delta?.content
                  if (content) {
                    if (!firstTokenTime) {
                      firstTokenTime = Date.now()
                      metrics.llmTtftMs = firstTokenTime - llmStartTime
                    }
                    tokenCount++
                    lastTokenTime = Date.now()
                    fullResponse += content
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`))
                  }
                } catch (e) {
                  // Final chunk was incomplete, skip it
                }
              }
            }
          }

          // === CALCULATE FINAL METRICS ===
          const streamEndTime = Date.now()
          metrics.llmTotalTimeMs = streamEndTime - llmStartTime
          metrics.llmStreamDurationMs = firstTokenTime ? lastTokenTime - firstTokenTime : 0
          metrics.tokenCount = tokenCount
          metrics.responseCharCount = fullResponse.length
          metrics.tokensPerSecond = metrics.llmStreamDurationMs > 0
            ? (tokenCount / (metrics.llmStreamDurationMs / 1000))
            : 0
          metrics.totalRequestTimeMs = streamEndTime - requestStartTime

          // === LOG COMPREHENSIVE METRICS ===
          console.log('\n' + '='.repeat(80))
          console.log(`📊 LATENCY METRICS [${requestId}]`)
          console.log('='.repeat(80))
          console.log(`Timestamp:        ${metrics.timestamp}`)
          console.log(`User:             ${metrics.userId}`)
          console.log(`Model:            ${metrics.model}`)
          console.log(`Query Length:     ${metrics.queryLength} chars`)
          console.log('')
          console.log('⏱️  TIMING BREAKDOWN:')
          console.log(`   Auth:          ${metrics.authTimeMs}ms`)
          console.log(`   Session Fetch: ${metrics.sessionFetchTimeMs}ms`)
          console.log(`   RAG Total:     ${metrics.ragTotalTimeMs}ms`)
          console.log(`     - Embedding: ${metrics.ragEmbeddingTimeMs}ms`)
          console.log(`     - Search:    ${metrics.ragSearchTimeMs}ms`)
          console.log(`   LLM Total:     ${metrics.llmTotalTimeMs}ms`)
          console.log(`     - TTFT:      ${metrics.llmTtftMs}ms`)
          console.log(`     - Streaming: ${metrics.llmStreamDurationMs}ms`)
          console.log('')
          console.log('📈 RESPONSE METRICS:')
          console.log(`   RAG Chunks:    ${metrics.ragChunksRetrieved}`)
          console.log(`   Tokens:        ${metrics.tokenCount}`)
          console.log(`   Throughput:    ${metrics.tokensPerSecond?.toFixed(1)} tok/s`)
          console.log(`   Response:      ${metrics.responseCharCount} chars`)
          console.log('')
          console.log(`⚡ TOTAL TIME:    ${metrics.totalRequestTimeMs}ms`)
          console.log('='.repeat(80) + '\n')

          // Also log as JSON for structured parsing
          console.log(`[METRICS_JSON] ${JSON.stringify(metrics)}`)

          // Save assistant message (using Supabase) with sources in metadata
          if (fullResponse) {
            // === CITATION VALIDATION (PageIndex) ===
            // Filter sources to only include those actually cited by the LLM
            // This ensures users only see relevant sources, not all retrieved
            let finalResponse = fullResponse
            let finalSources = sourcesList

            if (retrievalSources.length > 0 && sourcesList.length > 0) {
              // Use PageIndex filtering which understands section-based citations
              const citedRetrievalSources = filterCitedSources(fullResponse, retrievalSources)

              // Renumber citations in the response to be sequential
              // renumberCitations(response, originalSources, filteredSources) -> string
              const renumberedResponse = renumberCitations(
                fullResponse,
                retrievalSources,
                citedRetrievalSources
              )

              finalResponse = renumberedResponse

              // Rebuild sourcesList with only cited sources, properly renumbered
              finalSources = citedRetrievalSources.map((source, index) => ({
                index: index + 1,
                fileName: source.title,
                pageNumber: source.pages.start,
                content: source.content.substring(0, 500) + (source.content.length > 500 ? '...' : ''),
                documentId: (source as any).documentId || '',
                fileUrl: (source as any).fileUrl || null,
                similarity: 1.0,
                sectionPath: source.section_path,
                title: source.title,
                pageRange: source.pages,
                summary: source.summary,
                nodeId: source.node_id,
              }))

              console.log(`📋 Citation filtering: ${sourcesList.length} sources → ${finalSources.length} cited`)

              // Determine grounding status for UX transparency
              // isGrounded = true means answer is based on documents
              // isGrounded = false means answer is based on LLM general knowledge
              const isGrounded = finalSources.length > 0

              // Send filtered sources AND renumbered content to frontend
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                filteredSources: finalSources,
                filteredContent: finalResponse,
                sourcesFiltered: true,
                groundingStatus: {
                  isGrounded,
                  sourcesCount: finalSources.length,
                  message: isGrounded
                    ? `Grounded in ${finalSources.length} document section${finalSources.length > 1 ? 's' : ''}`
                    : 'Based on general knowledge (not from your documents)'
                }
              })}\n\n`))
            } else {
              // No sources retrieved at all - answer is from LLM knowledge
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                groundingStatus: {
                  isGrounded: false,
                  sourcesCount: 0,
                  message: 'Based on general knowledge (not from your documents)'
                }
              })}\n\n`))
            }

            const assistantMessage = await createMessage({
              chatSessionId,
              role: 'assistant',
              content: finalResponse,
              metadata: finalSources.length > 0 ? { sources: finalSources } : {},
            })

            // Update chat session timestamp (using Supabase)
            await updateChatSessionTimestamp(chatSessionId)

            // Send real message IDs back to frontend for feedback functionality
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              messageIds: {
                userMessageId: userMessage.id,
                assistantMessageId: assistantMessage.id,
              }
            })}\n\n`))
          }

        } catch (error) {
          console.error('Stream error:', error)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          controller.enqueue(encoder.encode(`data: {"error":"${errorMessage}"}\n\n`))
          controller.error(error)
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error('Chat error:', errorMessage)
    console.error('Stack trace:', errorStack)

    // Include error details in response for debugging
    return NextResponse.json(
      {
        error: 'Failed to process chat message',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
        debug: errorMessage // Temporarily include for production debugging
      },
      { status: 500 }
    )
  }
}
