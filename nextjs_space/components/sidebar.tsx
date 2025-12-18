'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import type { User } from '@supabase/supabase-js'

interface ChatSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface SidebarProps {
  user: User
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    loadChatSessions()
  }, [])

  const loadChatSessions = async () => {
    try {
      const response = await fetch('/api/chat-sessions')
      const data = await response.json()
      setChatSessions(data?.chatSessions ?? [])
    } catch (error) {
      console.error('Error loading chat sessions:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const createNewChat = async () => {
    try {
      const response = await fetch('/api/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New chat' }),
      })
      const data = await response.json()
      if (data?.chatSession) {
        setChatSessions([data.chatSession, ...chatSessions])
        router.push(`/dashboard/chat?session=${data.chatSession.id}`)
      }
    } catch (error) {
      console.error('Error creating chat:', error)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'

  return (
    <div className="w-64 bg-secondary/50 border-r border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <button
          onClick={createNewChat}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary transition-colors text-left"
        >
          <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span className="text-sm font-medium text-foreground">New chat</span>
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
            </div>
          ) : chatSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground px-3 py-4 text-center">
              No chats yet
            </p>
          ) : (
            <>
              <p className="text-xs font-medium text-muted-foreground px-3 py-2">Recents</p>
              {chatSessions.slice(0, 10).map((session) => (
                <button
                  key={session.id}
                  onClick={() => router.push(`/dashboard/chat?session=${session.id}`)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${
                    pathname?.includes(session.id)
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  {session.title}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* User menu */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            title="Sign out"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
