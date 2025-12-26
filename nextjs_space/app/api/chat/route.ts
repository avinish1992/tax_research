
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import { generateEmbedding, hybridSearch, expandLegalQuery } from '@/lib/supabase-rag'
import {
  getChatSessionWithMessages,
  createMessage,
  updateChatSessionTimestamp,
} from '@/lib/supabase-db'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()

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

    // Verify chat session belongs to user (using Supabase)
    const chatSession = await getChatSessionWithMessages(chatSessionId, user.id, 10)

    if (!chatSession) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 })
    }

    // Save user message (using Supabase)
    await createMessage({
      chatSessionId,
      role: 'user',
      content: message,
    })

    // Generate embedding for user query and find relevant chunks using hybrid search
    let relevantChunks: Array<{ content: string; fileName: string; pageNumber: number | null; score: number; documentId: string }> = []

    try {
      console.log('\n' + '='.repeat(80))
      console.log('🔍 RAG RETRIEVAL PIPELINE')
      console.log('='.repeat(80))
      console.log(`Query: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`)

      // Step 1: Query expansion for legal documents
      const expandedQuery = expandLegalQuery(message)

      // Step 2: Generate embedding using real embedding model
      console.log('\n📊 Generating semantic embedding...')
      const queryEmbedding = await generateEmbedding(expandedQuery)

      // Step 3: Hybrid search (semantic + keyword with RRF fusion)
      if (queryEmbedding && queryEmbedding.length > 0) {
        const results = await hybridSearch(
          expandedQuery,
          queryEmbedding,
          user.id,
          10 // Top 10 chunks
        )

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

        // Add to sources list for frontend with documentId and fileUrl
        sourcesList.push({
          index: sourceNum,
          fileName: chunk.fileName,
          pageNumber: chunk.pageNumber,
          content: chunk.content.substring(0, 500) + (chunk.content.length > 500 ? '...' : ''),
          documentId: chunk.documentId,
          fileUrl: documentUrls.get(chunk.documentId) || null
        })
      })
      contextText += '=== END OF DOCUMENTS ===\n\n'
    }

    // Single unified system prompt that handles all cases naturally
    const systemPrompt = `You are a helpful legal AI assistant. You have access to the user's uploaded legal documents which are provided below (if any).

YOUR CAPABILITIES:
- You can have natural conversations and respond to greetings, questions about yourself, and general chat
- You can answer questions about the uploaded legal documents when relevant
- You can help users understand complex legal language in their documents

CITATION GUIDELINES (IMPORTANT):
When referencing information from the provided documents, you MUST use inline numbered citations in the format [1], [2], etc.
- Each citation number corresponds to the source number shown in the document context (e.g., "[1] Source: ...")
- Place the citation immediately after the fact or claim it supports
- Example: "The corporate tax rate is 9% for income above AED 375,000 [2]."
- You can cite multiple sources for one statement: "Small businesses may qualify for relief [1][3]."
- Only cite sources that are actually provided in the context below
- If you mention a page number, include it naturally: "According to the guidelines on Page 19 [1]..."

GENERAL GUIDELINES:
1. Be conversational and helpful. If the user says "hello" or "are you there?", respond naturally - don't tell them to upload documents for a simple greeting.

2. When answering questions about legal topics:
   - If relevant document content is provided below, use it to answer WITH citations using [1], [2], etc.
   - If the documents don't contain the answer, say so honestly and offer to help with what IS in the documents
   - Never make up legal information - only cite what's actually in the provided documents

3. For general questions about what you can do or the documents available, be helpful and informative.

4. Keep responses clear and well-organized. For complex legal answers, use bullet points or numbered lists.

${relevantChunks.length > 0 ? 'DOCUMENT CONTEXT PROVIDED BELOW - Use the source numbers [1], [2], etc. when citing:' : 'NOTE: No specific document content matched this query. You can still have a conversation or suggest what topics might be in the user\'s documents.'}`

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
    console.log(`Using model: ${selectedModel}`)

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
                    fullResponse += content
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`))
                  }
                } catch (e) {
                  // Final chunk was incomplete, skip it
                }
              }
            }
          }

          // Save assistant message (using Supabase) with sources in metadata
          if (fullResponse) {
            await createMessage({
              chatSessionId,
              role: 'assistant',
              content: fullResponse,
              metadata: sourcesList.length > 0 ? { sources: sourcesList } : {},
            })

            // Update chat session timestamp (using Supabase)
            await updateChatSessionTimestamp(chatSessionId)
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
