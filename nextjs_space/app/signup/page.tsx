'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const supabase = createClient()

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="p-6">
          <Link href="/" className="text-xl font-semibold text-foreground">
            Legal AI
          </Link>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center px-4 -mt-16">
          <div className="w-full max-w-sm space-y-6 text-center">
            <h1 className="text-3xl font-serif text-foreground">Check your email</h1>
            <p className="text-muted-foreground">
              We&apos;ve sent a confirmation link to <strong className="text-foreground">{email}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              Click the link in the email to verify your account.
            </p>
            <Link
              href="/"
              className="inline-block px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Back to login
            </Link>
          </div>
        </main>
      </div>
    )
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
            <h1 className="text-4xl font-serif text-foreground">Create account</h1>
            <p className="text-muted-foreground">Get started with Legal AI</p>
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-xl">
                {error}
              </div>
            )}

            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={loading}
              className="w-full px-4 py-3 bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />

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
              {loading ? 'Creating account...' : 'Continue'}
            </button>
          </form>

          <p className="text-center text-muted-foreground text-sm">
            Already have an account?{' '}
            <Link href="/" className="text-foreground hover:underline font-medium">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
