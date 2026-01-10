import { NextRequest, NextResponse } from 'next/server'
import { uploadFile } from '@/lib/supabase-storage'
import { isSupportedFileType, getSupportedFormatsText } from '@/lib/document-processor'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import { createClient } from '@/utils/supabase/server'
import { indexDocument } from '@/lib/pageindex'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for large documents

export async function POST(request: NextRequest) {
  let documentId: string | null = null
  const supabase = await createClient()

  try {
    console.log('=== Document Upload Started (PageIndex Tree Indexing) ===')
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

    // Create document record for tracking
    console.log('Creating document record...')
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
        total_chunks: 0,
      })
      .select()
      .single()

    if (docError) {
      throw new Error(`Failed to create document: ${docError.message}`)
    }

    documentId = document.id
    console.log('Document created with ID:', documentId)

    const startTime = Date.now()

    // === PAGEINDEX TREE INDEXING ===
    // Build hierarchical tree structure for reasoning-based retrieval
    console.log('Building PageIndex tree structure...')
    let treeIndexed = false
    let treeError: string | null = null

    try {
      // Only index PDFs with tree structure (for now)
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const treeStartTime = Date.now()

        // Build document tree using PageIndex
        const documentTree = await indexDocument(buffer, file.name, {
          model: 'gpt-4o',
          add_node_id: true,
          add_node_text: true,
          add_node_summary: true,
          add_doc_description: true,
        })

        // Store tree in database
        const { error: treeInsertError } = await supabase
          .from('document_trees')
          .insert({
            document_id: documentId,
            tree_json: documentTree,
            model_used: 'gpt-4o',
          })

        if (treeInsertError) {
          console.error('Failed to store document tree:', treeInsertError)
          treeError = treeInsertError.message
        } else {
          treeIndexed = true
          const treeTime = ((Date.now() - treeStartTime) / 1000).toFixed(1)
          console.log(`PageIndex tree built in ${treeTime}s`)
          console.log(`Tree structure: ${documentTree.structure.length} top-level sections`)
        }
      } else {
        console.log('Skipping tree indexing for non-PDF file')
      }
    } catch (treeErr: any) {
      console.error('Tree indexing failed:', treeErr.message)
      treeError = treeErr.message
      // Don't fail the upload - vector search still works
    }

    const processingTime = ((Date.now() - startTime) / 1000).toFixed(1)

    // Mark document as completed with tree status
    await supabase.from('documents').update({
      status: treeIndexed ? 'completed' : 'failed',
      processed_at: new Date().toISOString(),
      tree_indexed: treeIndexed,
      tree_indexed_at: treeIndexed ? new Date().toISOString() : null,
      tree_indexing_error: treeError,
    }).eq('id', documentId)

    console.log('=== Document processed successfully ===')
    console.log(`   Tree indexed: ${treeIndexed}, Time: ${processingTime}s`)

    return NextResponse.json({
      message: treeIndexed
        ? 'Document uploaded and indexed successfully'
        : 'Document uploaded but tree indexing failed',
      document: {
        id: documentId,
        fileName: file.name,
        uploadedAt: document.uploaded_at,
        processingTime: `${processingTime}s`,
        treeIndexed,
        treeError,
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
