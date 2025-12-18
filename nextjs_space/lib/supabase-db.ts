/**
 * Supabase Database Operations
 * Replaces Prisma for all database operations
 */

import { createClient } from '@/utils/supabase/server'

// Types matching Supabase schema
export interface Document {
  id: string
  user_id: string
  file_name: string
  original_name: string
  file_size: number
  storage_path: string
  mime_type: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message: string | null
  chunk_count: number
  uploaded_at: string
  processed_at: string | null
}

export interface DocumentChunk {
  id: string
  document_id: string
  content: string
  embedding: number[] | null
  page_number: number | null
  chunk_index: number
  metadata: Record<string, any>
  created_at: string
}

export interface ChatSession {
  id: string
  user_id: string
  title: string
  model: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  chat_session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata: Record<string, any>
  created_at: string
}

// ============ Document Operations ============

export async function createDocument(data: {
  userId: string
  fileName: string
  originalName: string
  fileSize: number
  storagePath: string
  mimeType?: string
}): Promise<Document> {
  const supabase = await createClient()

  const { data: doc, error } = await supabase
    .from('documents')
    .insert({
      user_id: data.userId,
      file_name: data.fileName,
      original_name: data.originalName,
      file_size: data.fileSize,
      storage_path: data.storagePath,
      mime_type: data.mimeType || 'application/pdf',
      status: 'pending',
      chunk_count: 0,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create document:', error)
    throw new Error(`Failed to create document: ${error.message}`)
  }

  return doc
}

export async function updateDocumentStatus(
  documentId: string,
  status: Document['status'],
  updates?: { chunkCount?: number; errorMessage?: string }
): Promise<void> {
  const supabase = await createClient()

  const updateData: Record<string, any> = { status }

  if (status === 'completed') {
    updateData.processed_at = new Date().toISOString()
  }
  if (updates?.chunkCount !== undefined) {
    updateData.chunk_count = updates.chunkCount
  }
  if (updates?.errorMessage) {
    updateData.error_message = updates.errorMessage
  }

  const { error } = await supabase
    .from('documents')
    .update(updateData)
    .eq('id', documentId)

  if (error) {
    console.error('Failed to update document status:', error)
    throw new Error(`Failed to update document status: ${error.message}`)
  }
}

export async function deleteDocument(documentId: string): Promise<void> {
  const supabase = await createClient()

  // Chunks will be deleted automatically due to CASCADE
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)

  if (error) {
    console.error('Failed to delete document:', error)
    throw new Error(`Failed to delete document: ${error.message}`)
  }
}

export async function getDocumentsByUser(userId: string): Promise<Document[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false })

  if (error) {
    console.error('Failed to get documents:', error)
    throw new Error(`Failed to get documents: ${error.message}`)
  }

  return data || []
}

// ============ Document Chunk Operations ============

export async function createDocumentChunk(data: {
  documentId: string
  content: string
  embedding: number[]
  chunkIndex: number
  pageNumber?: number | null
  metadata?: Record<string, any>
}): Promise<DocumentChunk> {
  const supabase = await createClient()

  // Format embedding as PostgreSQL vector string
  const embeddingString = `[${data.embedding.join(',')}]`

  const { data: chunk, error } = await supabase
    .from('document_chunks')
    .insert({
      document_id: data.documentId,
      content: data.content,
      embedding: embeddingString,
      chunk_index: data.chunkIndex,
      page_number: data.pageNumber ?? null,
      metadata: data.metadata || {},
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create chunk:', error)
    throw new Error(`Failed to create chunk: ${error.message}`)
  }

  return chunk
}

export async function createDocumentChunksBatch(
  chunks: Array<{
    documentId: string
    content: string
    embedding: number[]
    chunkIndex: number
    pageNumber?: number | null
    metadata?: Record<string, any>
  }>
): Promise<void> {
  const supabase = await createClient()

  const formattedChunks = chunks.map(chunk => ({
    document_id: chunk.documentId,
    content: chunk.content,
    embedding: `[${chunk.embedding.join(',')}]`,
    chunk_index: chunk.chunkIndex,
    page_number: chunk.pageNumber ?? null,
    metadata: chunk.metadata || {},
  }))

  const { error } = await supabase
    .from('document_chunks')
    .insert(formattedChunks)

  if (error) {
    console.error('Failed to create chunks batch:', error)
    throw new Error(`Failed to create chunks batch: ${error.message}`)
  }
}

// ============ Chat Session Operations ============

export async function createChatSession(data: {
  userId: string
  title?: string
  model?: string
}): Promise<ChatSession> {
  const supabase = await createClient()

  const { data: session, error } = await supabase
    .from('chat_sessions')
    .insert({
      user_id: data.userId,
      title: data.title || 'New Conversation',
      model: data.model || 'gpt-4o-mini',
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create chat session:', error)
    throw new Error(`Failed to create chat session: ${error.message}`)
  }

  return session
}

export async function getChatSession(
  sessionId: string,
  userId: string
): Promise<ChatSession | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    console.error('Failed to get chat session:', error)
    throw new Error(`Failed to get chat session: ${error.message}`)
  }

  return data
}

export async function getChatSessionWithMessages(
  sessionId: string,
  userId: string,
  messageLimit: number = 10
): Promise<(ChatSession & { messages: Message[] }) | null> {
  const supabase = await createClient()

  // Get session
  const { data: session, error: sessionError } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single()

  if (sessionError) {
    if (sessionError.code === 'PGRST116') return null
    throw new Error(`Failed to get chat session: ${sessionError.message}`)
  }

  // Get messages
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(messageLimit)

  if (messagesError) {
    throw new Error(`Failed to get messages: ${messagesError.message}`)
  }

  return { ...session, messages: messages || [] }
}

export async function getChatSessionsByUser(userId: string): Promise<ChatSession[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('Failed to get chat sessions:', error)
    throw new Error(`Failed to get chat sessions: ${error.message}`)
  }

  return data || []
}

export async function updateChatSessionTimestamp(sessionId: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId)

  if (error) {
    console.error('Failed to update chat session timestamp:', error)
    // Don't throw - this is not critical
  }
}

export async function updateChatSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('chat_sessions')
    .update({ title })
    .eq('id', sessionId)

  if (error) {
    console.error('Failed to update chat session title:', error)
    throw new Error(`Failed to update chat session title: ${error.message}`)
  }
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const supabase = await createClient()

  // Messages will be deleted automatically due to CASCADE
  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId)

  if (error) {
    console.error('Failed to delete chat session:', error)
    throw new Error(`Failed to delete chat session: ${error.message}`)
  }
}

// ============ Message Operations ============

export async function createMessage(data: {
  chatSessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata?: Record<string, any>
}): Promise<Message> {
  const supabase = await createClient()

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      chat_session_id: data.chatSessionId,
      role: data.role,
      content: data.content,
      metadata: data.metadata || {},
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create message:', error)
    throw new Error(`Failed to create message: ${error.message}`)
  }

  return message
}

export async function getMessagesByChatSession(
  chatSessionId: string,
  limit?: number
): Promise<Message[]> {
  const supabase = await createClient()

  let query = supabase
    .from('messages')
    .select('*')
    .eq('chat_session_id', chatSessionId)
    .order('created_at', { ascending: true })

  if (limit) {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    console.error('Failed to get messages:', error)
    throw new Error(`Failed to get messages: ${error.message}`)
  }

  return data || []
}
