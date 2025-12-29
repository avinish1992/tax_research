import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const documentId = searchParams.get('documentId')
    const query = searchParams.get('q')?.trim()

    if (!documentId) {
      return NextResponse.json({ error: 'Missing documentId parameter' }, { status: 400 })
    }

    if (!query) {
      return NextResponse.json({ error: 'Missing q (query) parameter' }, { status: 400 })
    }

    const supabase = await createClient()

    // First verify the user owns this document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id')
      .eq('id', documentId)
      .eq('user_id', user.id)
      .single()

    if (docError || !document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Search document chunks for matching text (case-insensitive)
    const { data: results, error } = await supabase
      .from('document_chunks')
      .select('content, page_number, chunk_index')
      .eq('document_id', documentId)
      .ilike('content', `%${query}%`)
      .order('page_number', { ascending: true, nullsFirst: false })
      .order('chunk_index', { ascending: true })
      .limit(50)

    if (error) {
      console.error('Search error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Format results
    const searchResults = results.map(chunk => ({
      pageNumber: chunk.page_number,
      content: chunk.content,
      chunkIndex: chunk.chunk_index,
      matchQuery: query
    }))

    return NextResponse.json(searchResults)
  } catch (error) {
    console.error('Error searching document:', error)
    return NextResponse.json(
      { error: 'Failed to search document' },
      { status: 500 }
    )
  }
}
