'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push('/dashboard/chat')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="p-6">
        <Link href="/" className="text-xl font-semibold text-foreground">
          Legal AI
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 -mt-16">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-serif text-foreground">Welcome back</h1>
            <p className="text-muted-foreground">Sign in to continue</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-xl">
                {error}
              </div>
            )}

            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 bg-foreground text-background rounded-xl font-medium hover:bg-foreground/90 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Continue'}
            </button>
          </form>

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
