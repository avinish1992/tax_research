import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import {
  getChatSessionWithMessages,
  updateChatSessionTitle,
  deleteChatSession,
} from '@/lib/supabase-db'
import { createClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

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

    const chatSession = await getChatSessionWithMessages(id, user.id)

    if (!chatSession) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 })
    }

    return NextResponse.json({ chatSession })
  } catch (error) {
    console.error('Error fetching chat session:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chat session' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser()
    const { id } = await params

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { title, model } = body

    const supabase = await createClient()

    // Build update data
    const updateData: Record<string, any> = {}
    if (title) updateData.title = title
    if (model) updateData.model = model

    const { data, error } = await supabase
      .from('chat_sessions')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()

    if (error) {
      throw error
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Chat session updated successfully' })
  } catch (error) {
    console.error('Error updating chat session:', error)
    return NextResponse.json(
      { error: 'Failed to update chat session' },
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

    // First check if session exists and belongs to user
    const { data: session } = await supabase
      .from('chat_sessions')
      .select('id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!session) {
      return NextResponse.json({ error: 'Chat session not found' }, { status: 404 })
    }

    // Delete (messages will cascade)
    const { error } = await supabase
      .from('chat_sessions')
      .delete()
      .eq('id', id)

    if (error) {
      throw error
    }

    return NextResponse.json({ message: 'Chat session deleted successfully' })
  } catch (error) {
    console.error('Error deleting chat session:', error)
    return NextResponse.json(
      { error: 'Failed to delete chat session' },
      { status: 500 }
    )
  }
}
