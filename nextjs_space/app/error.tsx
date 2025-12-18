'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Something went wrong
        </h2>
        <p className="text-gray-600 dark:text-gray-400 max-w-md">
          An unexpected error occurred. Please try again.
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400">Error ID: {error.digest}</p>
        )}
        <Button onClick={reset} variant="default">
          Try again
        </Button>
      </div>
    </div>
  )
}
