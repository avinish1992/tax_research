
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import { generateEmbedding, hybridSearch, expandLegalQuery } from '@/lib/supabase-rag'
import {
  getChatSessionWithMessages,
  createMessage,
  updateChatSessionTimestamp,
} from '@/lib/supabase-db'
import { createClient } from '@/utils/supabase/server'
import { classifyQuery, describeClassification } from '@/lib/query-classifier'

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
 * Extract citation numbers from LLM response
 * Finds all [N] patterns and returns unique numbers
 */
function extractCitedSources(response: string): number[] {
  const matches = [...response.matchAll(/\[(\d+)\]/g)]
  const cited = matches.map(m => parseInt(m[1]))
  return [...new Set(cited)].sort((a, b) => a - b)
}

/**
 * Filter sources to only include those actually cited by the LLM
 * Re-numbers sources sequentially [1], [2], [3] and updates response text
 */
function filterAndRenumberSources(
  response: string,
  sources: Array<{
    index: number
    fileName: string
    pageNumber: number | null
    content: string
    documentId: string
    fileUrl: string | null
    similarity: number
  }>
): {
  filteredResponse: string
  filteredSources: typeof sources
  citationMap: Record<number, number> // old index -> new index
} {
  const citedIndices = extractCitedSources(response)

  // If no citations found, return minimum sources (top 3 by relevance)
  if (citedIndices.length === 0) {
    const topSources = sources.slice(0, 3).map((s, i) => ({ ...s, index: i + 1 }))
    return {
      filteredResponse: response,
      filteredSources: topSources,
      citationMap: {}
    }
  }

  // Filter to only cited sources
  const citedSources = sources.filter(s => citedIndices.includes(s.index))

  // If somehow no sources matched (shouldn't happen), return top 3
  if (citedSources.length === 0) {
    const topSources = sources.slice(0, 3).map((s, i) => ({ ...s, index: i + 1 }))
    return {
      filteredResponse: response,
      filteredSources: topSources,
      citationMap: {}
    }
  }

  // Create mapping from old index to new sequential index
  const citationMap: Record<number, number> = {}
  citedSources.forEach((source, i) => {
    citationMap[source.index] = i + 1
  })

  // Renumber sources
  const filteredSources = citedSources.map((s, i) => ({
    ...s,
    index: i + 1
  }))

  // Update response text with new citation numbers
  let filteredResponse = response
  // Sort by old index descending to avoid replacement conflicts
  const sortedOldIndices = Object.keys(citationMap)
    .map(Number)
    .sort((a, b) => b - a)

  for (const oldIndex of sortedOldIndices) {
    const newIndex = citationMap[oldIndex]
    // Replace [oldIndex] with a temporary placeholder to avoid conflicts
    const placeholder = `__CITE_${newIndex}__`
    filteredResponse = filteredResponse.replace(
      new RegExp(`\\[${oldIndex}\\]`, 'g'),
      placeholder
    )
  }

  // Convert placeholders back to citation format
  for (let i = 1; i <= filteredSources.length; i++) {
    filteredResponse = filteredResponse.replace(
      new RegExp(`__CITE_${i}__`, 'g'),
      `[${i}]`
    )
  }

  console.log(`📋 Citation filtering: ${sources.length} sources → ${filteredSources.length} cited`)
  console.log(`   Cited indices: [${citedIndices.join(', ')}] → renumbered to [${Object.values(citationMap).join(', ')}]`)

  return {
    filteredResponse,
    filteredSources,
    citationMap
  }
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

    // Generate embedding for user query and find relevant chunks using hybrid search
    let relevantChunks: Array<{ content: string; fileName: string; pageNumber: number | null; score: number; documentId: string }> = []

    // === RAG TIMING ===
    const ragStartTime = Date.now()
    metrics.ragEmbeddingTimeMs = 0
    metrics.ragSearchTimeMs = 0

    try {
      console.log('\n' + '='.repeat(80))
      console.log(`🔍 RAG RETRIEVAL PIPELINE [${requestId}]`)
      console.log('='.repeat(80))
      console.log(`Query: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`)

      // Step 0: Enrich follow-up queries with conversational context
      let ragQuery = message
      if (isFollowUpQuery(message) && chatSession?.messages?.length > 0) {
        ragQuery = enrichQueryWithContext(message, chatSession.messages)
      }

      // Step 0.5: Classify query for adaptive retrieval
      const classification = classifyQuery(ragQuery)
      console.log(`\n📊 Query Classification: ${describeClassification(classification)}`)

      // Step 1: Query expansion for legal documents
      const expandedQuery = expandLegalQuery(ragQuery)

      // Step 2: Generate embedding using real embedding model
      console.log('\n📊 Generating semantic embedding...')
      const embeddingStartTime = Date.now()
      const queryEmbedding = await generateEmbedding(expandedQuery)
      metrics.ragEmbeddingTimeMs = Date.now() - embeddingStartTime
      console.log(`   Embedding generated in ${metrics.ragEmbeddingTimeMs}ms`)

      // Step 3: Hybrid search (semantic + keyword with RRF fusion)
      // Use classification.topK for adaptive retrieval (5-15 based on query type)
      if (queryEmbedding && queryEmbedding.length > 0) {
        const searchStartTime = Date.now()
        const results = await hybridSearch(
          expandedQuery,
          queryEmbedding,
          user.id,
          classification.topK // Dynamic based on query complexity
        )
        metrics.ragSearchTimeMs = Date.now() - searchStartTime
        console.log(`   Hybrid search completed in ${metrics.ragSearchTimeMs}ms`)

        // Convert to expected format with page numbers and documentId
        relevantChunks = results.map(r => ({
          content: r.content,
          fileName: r.fileName,
          pageNumber: r.pageNumber,
          score: r.score,
          documentId: r.documentId,
        }))

        console.log('\n✅ RAG retrieval complete')
        console.log('='.repeat(80) + '\n')
      }
    } catch (embeddingError) {
      console.error('❌ Error in RAG pipeline:', embeddingError)
      console.log('   Continuing without RAG context...\n')
      // Continue without RAG context if embedding fails
    }

    metrics.ragTotalTimeMs = Date.now() - ragStartTime
    metrics.ragChunksRetrieved = relevantChunks.length

    // Build context from relevant chunks with numbered sources
    let contextText = ''

    // Create a deduplicated list of sources for citations
    const sourcesList: Array<{
      index: number
      fileName: string
      pageNumber: number | null
      content: string
      documentId: string
      fileUrl: string | null
      similarity: number  // RRF score for relevance-based ordering
    }> = []

    if (relevantChunks.length > 0) {
      // Get unique document IDs and fetch their storage paths for PDF preview
      const uniqueDocIds = [...new Set(relevantChunks.map(c => c.documentId))]
      const documentUrls: Map<string, string | null> = new Map()

      try {
        const supabase = await createClient()

        // Fetch documents to get storage paths
        const { data: documents } = await supabase
          .from('documents')
          .select('id, storage_path')
          .in('id', uniqueDocIds)

        if (documents) {
          // Generate signed URLs for each document (valid for 1 hour)
          for (const doc of documents) {
            const { data: urlData } = await supabase.storage
              .from('documents')
              .createSignedUrl(doc.storage_path, 3600)
            documentUrls.set(doc.id, urlData?.signedUrl || null)
          }
        }
      } catch (urlError) {
        console.error('Error generating document URLs:', urlError)
        // Continue without URLs - PDF preview will fall back to text view
      }

      // Format context clearly with numbered sources for citation
      contextText = '\n\n=== UPLOADED LEGAL DOCUMENTS ===\n\n'
      relevantChunks.forEach((chunk, index) => {
        const sourceNum = index + 1
        const pageInfo = chunk.pageNumber ? ` (Page ${chunk.pageNumber})` : ''
        contextText += `[${sourceNum}] Source: ${chunk.fileName}${pageInfo}\n${chunk.content}\n\n---\n\n`

        // Add to sources list for frontend with documentId, fileUrl, and similarity score
        sourcesList.push({
          index: sourceNum,
          fileName: chunk.fileName,
          pageNumber: chunk.pageNumber,
          content: chunk.content.substring(0, 500) + (chunk.content.length > 500 ? '...' : ''),
          documentId: chunk.documentId,
          fileUrl: documentUrls.get(chunk.documentId) || null,
          similarity: chunk.score  // Include RRF relevance score for tiered display
        })
      })
      contextText += '=== END OF DOCUMENTS ===\n\n'
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
When referencing information from the provided documents, use inline numbered citations [1], [2], etc.
- Place the citation immediately after the fact or claim it supports
- Example: "The corporate tax rate is 9% for income above AED 375,000 [2]."
- Multiple sources for one claim: "Small businesses may qualify for relief [1][3]."

CITATION QUALITY RULES (IMPORTANT):
1. ONLY cite sources whose content you ACTUALLY USE in your response
   - Do NOT cite a source just because it exists or seems related
   - If you don't use information from source [5], don't cite [5]
2. MATCH citations to specific content:
   - If you state "9%" or "AED 375,000", cite the source containing that exact figure
   - If you mention "Article 23", cite the source with Article 23 text
3. For factual claims, cite at least one source that contains the supporting information
4. When multiple sources support the same claim, cite all relevant ones: [1][3]
5. Cite sources in order of relevance to each specific claim

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
  — Source: Document Name [1], Page X

- Include multiple relevant excerpts if the content spans several sections
- Preserve the original formatting and punctuation
- If the exact requested text isn't found, quote the closest relevant content and explain
` : ''}
${relevantChunks.length > 0 ? 'DOCUMENT CONTEXT PROVIDED BELOW - Use the source numbers [1], [2], etc. when citing:' : 'NOTE: No relevant documents found for this query. If this is a tax-related question, suggest the user upload relevant documents or rephrase. If off-topic, politely redirect.'}`

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
            // === CITATION VALIDATION ===
            // Filter sources to only include those actually cited by the LLM
            // This ensures users only see relevant sources, not all 10 retrieved
            let finalResponse = fullResponse
            let finalSources = sourcesList

            if (sourcesList.length > 0) {
              const { filteredResponse, filteredSources } = filterAndRenumberSources(
                fullResponse,
                sourcesList
              )
              finalResponse = filteredResponse
              finalSources = filteredSources

              // Send filtered sources update to frontend
              // Frontend can use this to replace the initial full sources list
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                filteredSources: filteredSources,
                sourcesFiltered: true
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
    console.error('Chat error:', error)
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    )
  }
}
