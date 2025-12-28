'use client'

import { useEffect, useState, ReactNode } from 'react'

interface ClientOnlyProps {
  children: ReactNode
  fallback?: ReactNode
}

/**
 * ClientOnly wrapper component to prevent SSR for dynamic content.
 * This fixes React hydration errors by ensuring content only renders on the client.
 *
 * Use this for:
 * - Streaming content that changes during render
 * - Content that depends on client-only state
 * - Components with potential server/client mismatch
 */
export function ClientOnly({ children, fallback = null }: ClientOnlyProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return <>{fallback}</>
  return <>{children}</>
}
