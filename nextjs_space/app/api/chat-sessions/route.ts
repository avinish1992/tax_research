import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import { getChatSessionsByUser, createChatSession } from '@/lib/supabase-db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const chatSessions = await getChatSessionsByUser(user.id)

    return NextResponse.json({ chatSessions })
  } catch (error) {
    console.error('Error fetching chat sessions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chat sessions' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { title, model } = body

    const chatSession = await createChatSession({
      userId: user.id,
      title: title || 'New Conversation',
      model: model || 'claude-3-5-sonnet-20241022',
    })

    return NextResponse.json({ chatSession })
  } catch (error) {
    console.error('Error creating chat session:', error)
    return NextResponse.json(
      { error: 'Failed to create chat session' },
      { status: 500 }
    )
  }
}
