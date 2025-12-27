import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import { deleteFile, downloadFile } from '@/lib/supabase-storage'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

// GET: Fetch fresh signed URL for a document
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser()
    const { id } = await params

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()

    // Get the document to find storage path
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('id, storage_path, file_name')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Generate fresh signed URL
    const signedUrl = await downloadFile(document.storage_path)

    return NextResponse.json({
      signedUrl,
      fileName: document.file_name
    })
  } catch (error) {
    console.error('Error fetching signed URL:', error)
    return NextResponse.json(
      { error: 'Failed to fetch document URL' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser()
    const { id } = await params

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()

    // First get the document to find storage path
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('id, storage_path')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Delete from Supabase Storage
    try {
      await deleteFile(document.storage_path)
    } catch (storageError) {
      console.error('Error deleting file from storage:', storageError)
      // Continue to delete database record even if storage delete fails
    }

    // Delete from database (cascades to chunks)
    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .eq('id', id)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ message: 'Document deleted successfully' })
  } catch (error) {
    console.error('Error deleting document:', error)
    return NextResponse.json(
      { error: 'Failed to delete document' },
      { status: 500 }
    )
  }
}
