import { NextRequest, NextResponse } from 'next/server'
import { uploadFile } from '@/lib/supabase-storage'
import { smartExtractText, chunkPages, isSupportedFileType, getSupportedFormatsText } from '@/lib/document-processor'
import { generateEmbedding } from '@/lib/supabase-rag'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for large documents

// Parallelization settings
const EMBEDDING_BATCH_SIZE = 10 // Process 10 embeddings in parallel
const CHUNK_INSERT_BATCH_SIZE = 5 // Insert 5 chunks at a time for realtime updates

export async function POST(request: NextRequest) {
  let documentId: string | null = null
  const supabase = await createClient()

  try {
    console.log('=== Document Upload Started (Parallel Processing) ===')
    const user = await getAuthenticatedUser()

    if (!user) {
      console.error('Upload failed: Unauthorized')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('User authenticated:', user.id)

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      console.error('Upload failed: No file provided')
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    console.log('File received:', file.name, 'Size:', file.size, 'Type:', file.type)

    // Validate file type
    if (!isSupportedFileType(file.type, file.name)) {
      console.error('Upload failed: Unsupported file type:', file.type)
      return NextResponse.json(
        { error: `Unsupported file type. Supported formats: ${getSupportedFormatsText()}` },
        { status: 400 }
      )
    }

    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      console.error('Upload failed: File too large:', file.size)
      return NextResponse.json({ error: 'File size must be less than 10MB' }, { status: 400 })
    }

    // Convert to buffer
    console.log('Converting file to buffer...')
    const buffer = Buffer.from(await file.arrayBuffer())

    // Upload to Supabase Storage
    console.log('Uploading to Supabase Storage...')
    let storagePath: string
    try {
      storagePath = await uploadFile(buffer, file.name, user.id)
      console.log('Storage upload successful:', storagePath)
    } catch (storageError: any) {
      console.error('Storage upload failed:', storageError)
      throw new Error(`Failed to upload file: ${storageError.message}`)
    }

    // Create document record EARLY for realtime tracking
    console.log('Creating document record for tracking...')
    const { data: document, error: docError } = await supabase
      .from('documents')
      .insert({
        user_id: user.id,
        file_name: file.name,
        original_name: file.name,
        file_size: file.size,
        storage_path: storagePath,
        mime_type: file.type || 'application/pdf',
        status: 'processing',
        chunk_count: 0,
        total_chunks: 0, // Will update after chunking
      })
      .select()
      .single()

    if (docError) {
      throw new Error(`Failed to create document: ${docError.message}`)
    }

    documentId = document.id
    console.log('Document created with ID:', documentId)

    // Extract text from document
    console.log('Extracting text...')
    let pages
    try {
      pages = await smartExtractText(buffer, file.name, file.type)
      console.log('Extracted', pages.length, 'pages')

      if (!pages || pages.length === 0) {
        throw new Error('Document is empty or text extraction failed')
      }
    } catch (extractError: any) {
      await supabase.from('documents').update({
        status: 'failed',
        error_message: `Text extraction failed: ${extractError.message}`
      }).eq('id', documentId)
      throw extractError
    }

    // Chunk pages
    console.log('Chunking document...')
    let chunks
    try {
      chunks = await chunkPages(pages)
      console.log('Created', chunks.length, 'chunks')

      if (!chunks || chunks.length === 0) {
        throw new Error('Chunking produced no results')
      }
    } catch (chunkError: any) {
      await supabase.from('documents').update({
        status: 'failed',
        error_message: `Chunking failed: ${chunkError.message}`
      }).eq('id', documentId)
      throw chunkError
    }

    // Update document with total chunks for progress calculation
    await supabase.from('documents').update({
      total_chunks: chunks.length
    }).eq('id', documentId)

    // Generate embeddings in PARALLEL batches
    console.log(`Generating embeddings for ${chunks.length} chunks in parallel...`)
    const chunksWithEmbeddings: Array<{
      document_id: string
      content: string
      embedding: string
      chunk_index: number
      page_number: number | null
      metadata: Record<string, any>
    }> = []

    const startTime = Date.now()

    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE)

      // Generate embeddings in parallel for this batch
      const embeddingPromises = batch.map(async (chunk) => {
        try {
          const embedding = await generateEmbedding(chunk.content)
          return {
            chunk,
            embedding,
            error: null
          }
        } catch (err: any) {
          return {
            chunk,
            embedding: null,
            error: err.message
          }
        }
      })

      const results = await Promise.all(embeddingPromises)

      // Process results
      for (const result of results) {
        if (result.error || !result.embedding) {
          console.error(`Embedding failed for chunk ${result.chunk.chunkIndex}:`, result.error)
          await supabase.from('documents').update({
            status: 'failed',
            error_message: `Embedding failed at chunk ${result.chunk.chunkIndex}: ${result.error}`
          }).eq('id', documentId)
          throw new Error(`Embedding failed: ${result.error}`)
        }

        chunksWithEmbeddings.push({
          document_id: documentId!,
          content: result.chunk.content,
          embedding: `[${result.embedding.join(',')}]`,
          chunk_index: result.chunk.chunkIndex,
          page_number: result.chunk.pageNumber ?? null,
          metadata: {
            charCount: result.chunk.content.length,
            wordCount: result.chunk.content.split(/\s+/).length,
          },
        })
      }

      // Insert chunks in small batches for REALTIME progress updates
      const chunksToInsert = chunksWithEmbeddings.slice(
        chunksWithEmbeddings.length - results.length
      )

      for (let j = 0; j < chunksToInsert.length; j += CHUNK_INSERT_BATCH_SIZE) {
        const insertBatch = chunksToInsert.slice(j, j + CHUNK_INSERT_BATCH_SIZE)

        const { error: insertError } = await supabase
          .from('document_chunks')
          .insert(insertBatch)

        if (insertError) {
          console.error('Failed to insert chunks:', insertError)
          throw new Error(`Failed to store chunks: ${insertError.message}`)
        }

        // Update chunk_count for realtime progress tracking
        const processedCount = Math.min(i + j + insertBatch.length, chunks.length)
        await supabase.from('documents').update({
          chunk_count: processedCount
        }).eq('id', documentId)
      }

      const progress = Math.round(((i + batch.length) / chunks.length) * 100)
      console.log(`Progress: ${progress}% (${i + batch.length}/${chunks.length} chunks)`)
    }

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`Embedding generation completed in ${processingTime}s`)

    // Mark document as completed
    await supabase.from('documents').update({
      status: 'completed',
      chunk_count: chunks.length,
      processed_at: new Date().toISOString()
    }).eq('id', documentId)

    console.log('=== Document processed successfully ===')

    return NextResponse.json({
      message: 'Document uploaded and processed successfully',
      document: {
        id: documentId,
        fileName: file.name,
        uploadedAt: document.uploaded_at,
        chunkCount: chunks.length,
        processingTime: `${processingTime}s`
      },
    })
  } catch (error: any) {
    console.error('=== Document upload error ===')
    console.error('Error:', error?.message)

    // Cleanup on failure
    if (documentId) {
      try {
        await supabase.from('documents').delete().eq('id', documentId)
      } catch (cleanupError) {
        console.error('Cleanup failed:', cleanupError)
      }
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to upload document' },
      { status: 500 }
    )
  }
}
