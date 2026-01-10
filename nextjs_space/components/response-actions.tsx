'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Copy, RefreshCw, ThumbsDown, Check } from 'lucide-react'

interface ResponseActionsProps {
  conversationId: string
  messageId: string
  query: string
  response: string
  sources?: Array<{
    fileName: string
    pageNumber: number | null
    chunkIndex: number
  }>
  onRegenerate?: () => void
  isRegenerating?: boolean
}

interface Feedback {
  id: string
  feedback_type: 'thumbs_up' | 'thumbs_down'
  feedback_text?: string
}

export function ResponseActions({
  conversationId,
  messageId,
  query,
  response,
  sources,
  onRegenerate,
  isRegenerating = false,
}: ResponseActionsProps) {
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingExisting, setIsLoadingExisting] = useState(true)
  const [copied, setCopied] = useState(false)

  // Load existing feedback on mount
  useEffect(() => {
    async function loadExistingFeedback() {
      try {
        const res = await fetch(`/api/feedback?messageId=${messageId}`)
        if (res.ok) {
          const data = await res.json()
          if (data.feedback) {
            setFeedback(data.feedback)
          }
        }
      } catch (error) {
        console.error('Error loading feedback:', error)
      } finally {
        setIsLoadingExisting(false)
      }
    }

    if (messageId && !messageId.startsWith('assistant-')) {
      loadExistingFeedback()
    } else {
      setIsLoadingExisting(false)
    }
  }, [messageId])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(response)
      setCopied(true)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
      toast.error('Failed to copy')
    }
  }

  const submitFeedback = async () => {
    // If already thumbs down, do nothing
    if (feedback?.feedback_type === 'thumbs_down') {
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          messageId,
          feedbackType: 'thumbs_down',
          query,
          response,
          sources: sources?.map(s => ({
            fileName: s.fileName,
            pageNumber: s.pageNumber,
            chunkIndex: s.chunkIndex ?? 0,
          })),
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to submit feedback')
      }

      const data = await res.json()
      setFeedback({
        id: data.feedbackId,
        feedback_type: 'thumbs_down',
      })

      toast.success("Thanks for the feedback. We'll improve.")
    } catch (error) {
      console.error('Error submitting feedback:', error)
      toast.error('Failed to submit feedback')
    } finally {
      setIsLoading(false)
    }
  }

  // Don't show buttons while loading or for temporary message IDs
  if (isLoadingExisting || messageId.startsWith('assistant-')) {
    return null
  }

  return (
    <div className="flex items-center gap-0.5 mt-2">
      {/* Copy button */}
      <button
        onClick={handleCopy}
        className="p-1.5 rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
        title="Copy response"
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </button>

      {/* Thumbs down button */}
      <button
        onClick={submitFeedback}
        disabled={isLoading}
        className={`p-1.5 rounded-md transition-colors ${
          feedback?.feedback_type === 'thumbs_down'
            ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
        title="Poor response"
      >
        <ThumbsDown
          className="w-4 h-4"
          fill={feedback?.feedback_type === 'thumbs_down' ? 'currentColor' : 'none'}
        />
      </button>

      {/* Regenerate button */}
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          disabled={isRegenerating}
          className={`p-1.5 rounded-md transition-colors ${
            isRegenerating
              ? 'text-primary animate-spin'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
          title="Regenerate response"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// Keep old export for backwards compatibility
export { ResponseActions as FeedbackButtons }
