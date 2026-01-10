'use client'

import { useState } from 'react'
import { ChevronUp, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Thinking state for an assistant message
 */
export interface ThinkingState {
  isThinking: boolean
  totalThinkingTimeMs?: number
  reasoning?: string
  confidence?: 'high' | 'medium' | 'low'
}

interface ThinkingStepsDisplayProps {
  thinking: ThinkingState
  defaultExpanded?: boolean
}

/**
 * PageIndex-style thinking display
 * Shows "Thought for X seconds" with collapsible reasoning text
 * Matches the simple UI from PageIndex - no tool step dropdowns
 */
export function ThinkingStepsDisplay({
  thinking,
  defaultExpanded = false,
}: ThinkingStepsDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const thinkingTimeSeconds = thinking.totalThinkingTimeMs
    ? Math.round(thinking.totalThinkingTimeMs / 1000)
    : thinking.isThinking
      ? 0
      : 0

  return (
    <div className="mb-3">
      {/* Main collapsible header - "Thought for X seconds" */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors group"
      >
        <span className="text-sm">
          {thinking.isThinking ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Thinking...</span>
            </span>
          ) : (
            `Thought for ${thinkingTimeSeconds} second${thinkingTimeSeconds !== 1 ? 's' : ''}`
          )}
        </span>
        <ChevronUp
          className={cn(
            "w-4 h-4 transition-transform duration-200",
            !isExpanded && "rotate-180"
          )}
        />
      </button>

      {/* Expanded content - just the reasoning text */}
      {isExpanded && thinking.reasoning && (
        <div className="mt-3 text-sm text-foreground/80 leading-relaxed">
          {thinking.reasoning}
        </div>
      )}
    </div>
  )
}

/**
 * Simple inline thinking indicator for during streaming
 */
export function ThinkingIndicator({
  text = "Analyzing documents...",
  showTime = false,
  elapsedMs = 0
}: {
  text?: string
  showTime?: boolean
  elapsedMs?: number
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground py-2 mb-2">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      <span className="text-sm">{text}</span>
      {showTime && elapsedMs > 0 && (
        <span className="text-xs text-muted-foreground/70">
          ({(elapsedMs / 1000).toFixed(1)}s)
        </span>
      )}
    </div>
  )
}

// Legacy exports for backwards compatibility
export interface ToolStep {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'error'
  parameters?: Record<string, any>
  result?: any
}

export default ThinkingStepsDisplay
