'use client'

import { FileText, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Grounding status from the RAG pipeline
 */
export interface GroundingStatus {
  isGrounded: boolean
  sourcesCount: number
  message: string
}

interface GroundingIndicatorProps {
  status: GroundingStatus | null
  className?: string
}

/**
 * Visual indicator showing whether the response is grounded in documents
 * or based on LLM general knowledge.
 *
 * - Green (grounded): Answer is based on user's uploaded documents
 * - Amber (ungrounded): Answer is based on LLM's general knowledge
 *
 * This provides transparency for legal/compliance use cases where
 * users need to know if answers come from their documents or not.
 */
export function GroundingIndicator({
  status,
  className,
}: GroundingIndicatorProps) {
  if (!status) return null

  const isGrounded = status.isGrounded

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
        isGrounded
          ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-500/20"
          : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-500/20",
        className
      )}
    >
      {isGrounded ? (
        <>
          <FileText className="w-3 h-3" />
          <span>
            {status.sourcesCount > 0
              ? `From ${status.sourcesCount} source${status.sourcesCount > 1 ? 's' : ''}`
              : 'Document-grounded'}
          </span>
        </>
      ) : (
        <>
          <AlertTriangle className="w-3 h-3" />
          <span>General knowledge</span>
        </>
      )}
    </div>
  )
}

/**
 * More detailed grounding banner for prominent display
 * Shows a full-width banner with explanation
 */
export function GroundingBanner({
  status,
  className,
}: GroundingIndicatorProps) {
  if (!status) return null

  const isGrounded = status.isGrounded

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 p-3 rounded-lg text-sm mb-3",
        isGrounded
          ? "bg-emerald-500/5 border border-emerald-500/20"
          : "bg-amber-500/5 border border-amber-500/20",
        className
      )}
    >
      {isGrounded ? (
        <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 dark:text-emerald-400 flex-shrink-0" />
      ) : (
        <Info className="w-4 h-4 mt-0.5 text-amber-500 dark:text-amber-400 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "font-medium",
            isGrounded
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-amber-700 dark:text-amber-300"
          )}
        >
          {isGrounded ? 'Document-grounded response' : 'General knowledge response'}
        </p>
        <p
          className={cn(
            "text-xs mt-0.5",
            isGrounded
              ? "text-emerald-600/80 dark:text-emerald-400/80"
              : "text-amber-600/80 dark:text-amber-400/80"
          )}
        >
          {isGrounded
            ? `This answer is based on ${status.sourcesCount} section${status.sourcesCount > 1 ? 's' : ''} from your uploaded documents.`
            : 'This answer is based on the AI\'s general knowledge, not your uploaded documents. Consider uploading relevant documents for more specific answers.'}
        </p>
      </div>
    </div>
  )
}

export default GroundingIndicator
