import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { getAuthenticatedUser } from '@/lib/supabase-auth'
import { z } from 'zod'

const feedbackSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  feedbackType: z.enum(['thumbs_up', 'thumbs_down']),
  feedbackText: z.string().optional(),
  query: z.string().min(1),
  response: z.string().min(1),
  sources: z.array(z.object({
    fileName: z.string(),
    pageNumber: z.number().nullable(),
    chunkIndex: z.number(),
  })).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const parsed = feedbackSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.errors },
        { status: 400 }
      )
    }

    const { conversationId, messageId, feedbackType, feedbackText, query, response, sources } = parsed.data

    const supabase = await createClient()

    // Check if feedback already exists for this message
    const { data: existing } = await supabase
      .from('chat_feedback')
      .select('id, feedback_type')
      .eq('user_id', user.id)
      .eq('message_id', messageId)
      .single()

    if (existing) {
      // Update existing feedback
      const { error } = await supabase
        .from('chat_feedback')
        .update({
          feedback_type: feedbackType,
          feedback_text: feedbackText,
        })
        .eq('id', existing.id)

      if (error) {
        console.error('Error updating feedback:', error)
        return NextResponse.json(
          { error: 'Failed to update feedback' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Feedback updated',
        feedbackId: existing.id,
      })
    }

    // Insert new feedback
    const { data: feedback, error } = await supabase
      .from('chat_feedback')
      .insert({
        user_id: user.id,
        conversation_id: conversationId,
        message_id: messageId,
        feedback_type: feedbackType,
        feedback_text: feedbackText,
        query,
        response,
        sources: sources || null,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Error inserting feedback:', error)
      return NextResponse.json(
        { error: 'Failed to save feedback' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Feedback saved',
      feedbackId: feedback.id,
    })

  } catch (error) {
    console.error('Feedback API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const messageId = searchParams.get('messageId')

    if (!messageId) {
      return NextResponse.json(
        { error: 'messageId is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data: feedback, error } = await supabase
      .from('chat_feedback')
      .select('id, feedback_type, feedback_text')
      .eq('user_id', user.id)
      .eq('message_id', messageId)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching feedback:', error)
      return NextResponse.json(
        { error: 'Failed to fetch feedback' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      feedback: feedback || null,
    })

  } catch (error) {
    console.error('Feedback GET API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
