'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import { useSidebar } from './sidebar-context'
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

function SidebarContent({ user }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()
  const currentSessionId = searchParams?.get('session')

  const { isCollapsed, setIsCollapsed } = useSidebar()
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [activeChatMenu, setActiveChatMenu] = useState<string | null>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const chatMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadChatSessions()
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) {
        setActiveChatMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
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
    router.push('/dashboard/chat')
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const deleteChat = async (id: string) => {
    try {
      const response = await fetch(`/api/chat-sessions/${id}`, { method: 'DELETE' })
      if (response.ok) {
        setChatSessions(prev => prev.filter(s => s.id !== id))
        toast.success('Chat deleted')
        if (currentSessionId === id) {
          router.push('/dashboard/chat')
        }
      }
    } catch (error) {
      toast.error('Failed to delete chat')
    }
    setActiveChatMenu(null)
  }

  const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'
  const userInitial = displayName.charAt(0).toUpperCase()

  return (
    <div
      className={`bg-card border-r border-border flex flex-col h-full flex-shrink-0 transition-all duration-200 ${
        isCollapsed ? 'w-[60px]' : 'w-64'
      }`}
    >
      {/* Header - Expanded */}
      {!isCollapsed && (
        <div className="p-3 flex items-center justify-between">
          <span className="text-lg font-semibold text-foreground pl-1">Legal AI</span>
          <button
            onClick={() => setIsCollapsed(true)}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Collapse sidebar"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <rect x="3" y="4" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="9" y1="4" x2="9" y2="20" strokeLinecap="round"/>
              <path d="M15 10l-2 2 2 2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      )}

      {/* Header - Collapsed */}
      {isCollapsed && (
        <div className="flex flex-col items-center py-3 gap-1.5 px-2">
          <button
            onClick={() => setIsCollapsed(false)}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Expand sidebar"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <rect x="3" y="4" width="18" height="16" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
              <line x1="9" y1="4" x2="9" y2="20" strokeLinecap="round"/>
              <path d="M13 10l2 2-2 2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={createNewChat}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-secondary transition-colors"
            title="New chat"
          >
            <div className="w-[22px] h-[22px] rounded-full bg-foreground flex items-center justify-center">
              <svg className="w-3 h-3 text-background" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
          </button>
          <button
            onClick={() => router.push('/dashboard/documents')}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Documents"
          >
            <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
        </div>
      )}

      {/* Navigation - Expanded */}
      {!isCollapsed && (
        <div className="px-3 space-y-1">
          <button
            onClick={createNewChat}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-secondary transition-colors text-left"
          >
            <div className="w-[22px] h-[22px] rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
              <svg className="w-3 h-3 text-background" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <span className="text-sm font-medium text-foreground">New chat</span>
          </button>

          <button
            onClick={() => router.push('/dashboard/documents')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-secondary transition-colors text-left"
          >
            <svg className="w-[22px] h-[22px] text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium text-foreground">Documents</span>
          </button>
        </div>
      )}

      {/* Recents Section - Expanded */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto px-3 mt-4">
          <p className="text-xs font-medium text-muted-foreground px-2 py-2">Recents</p>
          <div className="space-y-0.5">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
              </div>
            ) : chatSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground px-2 py-4 text-center">
                No chats yet
              </p>
            ) : (
              chatSessions.slice(0, 10).map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                    currentSessionId === session.id ? 'bg-secondary' : 'hover:bg-secondary'
                  }`}
                >
                  <button
                    onClick={() => router.push(`/dashboard/chat?session=${session.id}`)}
                    className="flex-1 text-left text-sm text-foreground truncate"
                  >
                    {session.title}
                  </button>
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveChatMenu(activeChatMenu === session.id ? null : session.id)
                      }}
                      className={`p-1 rounded hover:bg-muted text-muted-foreground transition-opacity ${
                        currentSessionId === session.id || activeChatMenu === session.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                      </svg>
                    </button>
                    {activeChatMenu === session.id && (
                      <div
                        ref={chatMenuRef}
                        className="absolute right-0 top-full mt-1 w-36 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50 animate-in fade-in slide-in-from-top-1"
                      >
                        <button
                          onClick={() => deleteChat(session.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors text-left"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Spacer for collapsed */}
      {isCollapsed && <div className="flex-1" />}

      {/* User Menu - Expanded */}
      {!isCollapsed && (
        <div className="p-3 relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-secondary transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-foreground flex items-center justify-center text-sm font-semibold text-background flex-shrink-0 shadow-sm">
              {userInitial}
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground">Free plan</p>
            </div>
            <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          </button>

          {showUserMenu && (
            <div className="absolute bottom-full left-3 right-3 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-2">
              <div className="p-3 border-b border-border">
                <p className="text-sm font-medium text-foreground truncate">{user.email}</p>
              </div>
              <div className="py-1">
                <button className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors text-left">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
              </div>
              <div className="py-1 border-t border-border">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors text-left"
                >
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* User Avatar - Collapsed */}
      {isCollapsed && (
        <div className="p-2 flex justify-center">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-secondary transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center text-xs font-semibold text-background">
              {userInitial}
            </div>
          </button>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ user }: SidebarProps) {
  return (
    <Suspense fallback={
      <div className="w-64 bg-card border-r border-border flex flex-col h-full">
        <div className="flex items-center justify-center h-full">
          <div className="w-5 h-5 border-2 border-muted-foreground/20 border-t-muted-foreground rounded-full animate-spin" />
        </div>
      </div>
    }>
      <SidebarContent user={user} />
    </Suspense>
  )
}
