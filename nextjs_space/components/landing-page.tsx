'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

function LandingPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const errorParam = searchParams?.get('error')
    if (errorParam) {
      setError('Authentication failed. Please try again.')
    }
  }, [searchParams])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Please enter email and password')
      return
    }

    setIsLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setIsLoading(false)
      return
    }

    router.push('/dashboard/chat')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Simple header */}
      <header className="p-6">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold text-foreground">Legal AI</span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 -mt-16">
        <div className="w-full max-w-sm space-y-8">
          {/* Greeting */}
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-serif text-foreground">
              Welcome back
            </h1>
            <p className="text-muted-foreground">
              Sign in to continue
            </p>
          </div>

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-xl">
                {error}
              </div>
            )}

            <div>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>

            <div>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full px-4 py-3 bg-foreground text-background rounded-xl font-medium hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Signing in...' : 'Continue'}
            </button>
          </form>

          {/* Sign up link */}
          <p className="text-center text-muted-foreground text-sm">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-foreground hover:underline font-medium">
              Sign up
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}

function LandingPageLoading() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center">
      <div className="w-8 h-8 border-2 border-muted-foreground/20 border-t-primary rounded-full animate-spin" />
    </div>
  )
}

export function LandingPage() {
  return (
    <Suspense fallback={<LandingPageLoading />}>
      <LandingPageContent />
    </Suspense>
  )
}
