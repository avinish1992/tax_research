'use client'

import React from 'react'

interface HighlightedTextProps {
  text: string
  query: string
  maxLength?: number
  contextChars?: number
}

/**
 * Safely highlights search query matches in text using React elements.
 * No innerHTML/XSS risk - uses pure React components.
 */
export function HighlightedText({
  text,
  query,
  maxLength = 150,
  contextChars = 50
}: HighlightedTextProps) {
  if (!text) {
    return null
  }

  if (!query) {
    const truncated = text.substring(0, maxLength)
    return <>{truncated}{text.length > maxLength ? '...' : ''}</>
  }

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerText.indexOf(lowerQuery)

  // No match found - return truncated text
  if (matchIndex === -1) {
    const truncated = text.substring(0, maxLength)
    return <>{truncated}{text.length > maxLength ? '...' : ''}</>
  }

  // Extract context around the match
  const contextStart = Math.max(0, matchIndex - contextChars)
  const contextEnd = Math.min(text.length, matchIndex + query.length + contextChars)

  // Build highlighted result using React elements (safe from XSS)
  const before = text.substring(contextStart, matchIndex)
  const match = text.substring(matchIndex, matchIndex + query.length)
  const after = text.substring(matchIndex + query.length, contextEnd)

  return (
    <>
      {contextStart > 0 && '...'}
      {before}
      <mark className="bg-yellow-200 dark:bg-yellow-700/70 text-foreground px-0.5 rounded font-medium">
        {match}
      </mark>
      {after}
      {contextEnd < text.length && '...'}
    </>
  )
}

/**
 * Highlights all occurrences of a query in text.
 * Useful for showing multiple matches in a longer excerpt.
 */
export function HighlightAllMatches({
  text,
  query,
  maxLength = 300
}: HighlightedTextProps) {
  if (!text) return null
  if (!query) {
    const truncated = text.substring(0, maxLength)
    return <>{truncated}{text.length > maxLength ? '...' : ''}</>
  }

  const truncatedText = text.substring(0, maxLength) + (text.length > maxLength ? '...' : '')
  const lowerText = truncatedText.toLowerCase()
  const lowerQuery = query.toLowerCase()

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let matchIndex = lowerText.indexOf(lowerQuery)
  let keyIndex = 0

  while (matchIndex !== -1) {
    // Add text before match
    if (matchIndex > lastIndex) {
      parts.push(truncatedText.substring(lastIndex, matchIndex))
    }

    // Add highlighted match
    parts.push(
      <mark
        key={keyIndex++}
        className="bg-yellow-200 dark:bg-yellow-700/70 text-foreground px-0.5 rounded font-medium"
      >
        {truncatedText.substring(matchIndex, matchIndex + query.length)}
      </mark>
    )

    lastIndex = matchIndex + query.length
    matchIndex = lowerText.indexOf(lowerQuery, lastIndex)
  }

  // Add remaining text
  if (lastIndex < truncatedText.length) {
    parts.push(truncatedText.substring(lastIndex))
  }

  return <>{parts}</>
}
