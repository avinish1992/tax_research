import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import { getDocumentsByUser } from '@/lib/supabase-db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const documents = await getDocumentsByUser(user.id)

    // Map to expected format (snake_case to camelCase)
    const formattedDocuments = documents.map(doc => ({
      id: doc.id,
      fileName: doc.file_name,
      originalName: doc.original_name,
      fileSize: doc.file_size,
      uploadedAt: doc.uploaded_at,
      status: doc.status,
      chunkCount: doc.chunk_count,
    }))

    return NextResponse.json({ documents: formattedDocuments })
  } catch (error) {
    console.error('Error fetching documents:', error)
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    )
  }
}
