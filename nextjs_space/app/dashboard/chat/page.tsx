'use client'

import React, { useState, useEffect, useRef, Suspense, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import { useSidebar } from '@/components/sidebar-context'

interface UploadingFile {
  name: string
  progress: 'uploading' | 'processing' | 'complete' | 'error'
  error?: string
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  sources?: Source[]
  metadata?: Record<string, any>
}

interface Source {
  index: number
  fileName: string
  pageNumber?: number | null
  content?: string
  similarity?: number
  documentId?: string
  fileUrl?: string
}

interface Document {
  id: string
  fileName: string
  uploadedAt: string
  fileSize?: number
}

function ChatContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionId = searchParams?.get('session') ?? null
  const { collapse: collapseSidebar, isCollapsed: isSidebarCollapsed } = useSidebar()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingSession, setIsLoadingSession] = useState(false)
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showSourcesPanel, setShowSourcesPanel] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null)
  const [previewSource, setPreviewSource] = useState<Source | null>(null)
  const [chatTitle, setChatTitle] = useState('New Chat')
  const [model] = useState('gpt-4o-mini')
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [isLoadingSourceUrl, setIsLoadingSourceUrl] = useState(false)

  // Track if we're currently sending a message (to prevent reload from clearing state)
  const isSendingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [])

  const loadChatSession = useCallback(async (id: string) => {
    // Don't reload if we're currently sending a message
    if (isSendingRef.current) return

    setIsLoadingSession(true)
    try {
      const response = await fetch(`/api/chat-sessions/${id}`)
      const data = await response.json()
      if (!isSendingRef.current) {
        // Transform messages and extract sources from metadata
        const rawMessages = data?.chatSession?.messages ?? []
        const transformedMessages: Message[] = rawMessages.map((msg: { id: string; role: 'user' | 'assistant'; content: string; created_at: string; metadata?: { sources?: Source[] } }) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          createdAt: msg.created_at,
          sources: msg.metadata?.sources ?? undefined,
        }))
        setMessages(transformedMessages)
        setChatTitle(data?.chatSession?.title || 'New Chat')
      }
    } catch (error) {
      console.error('Error loading chat session:', error)
    } finally {
      setIsLoadingSession(false)
    }
  }, [])

  const loadDocuments = useCallback(async () => {
    try {
      const response = await fetch('/api/documents')
      const data = await response.json()
      const docs = data?.documents ?? []
      setDocuments(docs)
      setSelectedDocIds(docs.map((d: Document) => d.id))
    } catch (error) {
      console.error('Error loading documents:', error)
    }
  }, [])

  useEffect(() => {
    if (sessionId) {
      loadChatSession(sessionId)
    } else if (!isSendingRef.current) {
      setMessages([])
      setChatTitle('New Chat')
    }
  }, [sessionId, loadChatSession])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Auto-collapse sidebar when sources panel opens for better readability
  useEffect(() => {
    if (showSourcesPanel) {
      collapseSidebar()
    }
  }, [showSourcesPanel, collapseSidebar])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const createSessionAndSend = async (message: string): Promise<string | null> => {
    try {
      const response = await fetch('/api/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: message.slice(0, 50) }),
      })
      const data = await response.json()
      if (data?.chatSession?.id) {
        setChatTitle(message.slice(0, 50))
        // Use replace instead of push to avoid adding to history stack
        router.replace(`/dashboard/chat?session=${data.chatSession.id}`, { scroll: false })
        return data.chatSession.id
      }
    } catch (error) {
      console.error('Error creating session:', error)
    }
    return null
  }

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    const message = input.trim()
    setInput('')

    // Set sending flag to prevent session reload from clearing messages
    isSendingRef.current = true

    let currentSessionId = sessionId
    if (!currentSessionId) {
      currentSessionId = await createSessionAndSend(message)
      if (!currentSessionId) {
        isSendingRef.current = false
        return
      }
    }

    setIsLoading(true)

    const tempUserMsgId = `user-${Date.now()}`
    const tempAssistantMsgId = `assistant-${Date.now()}`

    const tempUserMsg: Message = {
      id: tempUserMsgId,
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])

    const tempAssistantMsg: Message = {
      id: tempAssistantMsgId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempAssistantMsg])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatSessionId: currentSessionId,
          message,
          model,
          documentIds: selectedDocIds,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData.error || `Request failed with status ${response.status}`
        throw new Error(errorMessage)
      }

      if (!response.body) {
        throw new Error('No response body received')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistantResponse = ''
      let sources: Source[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]' || !data) continue

            try {
              const parsed = JSON.parse(data)
              if (parsed.error) {
                throw new Error(parsed.error)
              }
              if (parsed.sources) sources = parsed.sources
              const content = parsed?.choices?.[0]?.delta?.content
              if (content) {
                assistantResponse += content
                // Update the assistant message with streaming content
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === tempAssistantMsgId
                      ? { ...msg, content: assistantResponse, sources }
                      : msg
                  )
                )
              }
            } catch {
              // Skip JSON parse errors from partial data
            }
          }
        }
      }

      // If no response was generated, show a message
      if (!assistantResponse) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempAssistantMsgId
              ? { ...msg, content: 'I apologize, but I was unable to generate a response. Please try again.' }
              : msg
          )
        )
      }
    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred'
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempAssistantMsgId
            ? { ...msg, content: `Sorry, an error occurred: ${errorMessage}. Please try again.` }
            : msg
        )
      )
    } finally {
      setIsLoading(false)
      // Reset sending flag after a short delay to allow state to settle
      setTimeout(() => {
        isSendingRef.current = false
      }, 500)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setShowAddMenu(false)

    for (const file of Array.from(files)) {
      // Supported file types
      const supportedTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword',
        'text/plain',
        'text/markdown',
        'text/html',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ]
      const supportedExtensions = ['.pdf', '.docx', '.doc', '.txt', '.md', '.html', '.pptx', '.xlsx']
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))

      if (!supportedTypes.includes(file.type) && !supportedExtensions.includes(fileExtension)) {
        toast.error(`${file.name}: Supported formats: PDF, DOCX, TXT, PPTX, XLSX`)
        continue
      }

      // Validate file size (10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name}: File must be less than 10MB`)
        continue
      }

      // Add to uploading state
      setUploadingFiles(prev => [...prev, { name: file.name, progress: 'uploading' }])

      // Show uploading toast
      const toastId = toast.loading(`Uploading ${file.name}...`)

      const formData = new FormData()
      formData.append('file', file)

      try {
        // Update to processing state
        setUploadingFiles(prev =>
          prev.map(f => f.name === file.name ? { ...f, progress: 'processing' } : f)
        )
        toast.loading(`Processing ${file.name}...`, { id: toastId })

        const response = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Upload failed')
        }

        // Success
        setUploadingFiles(prev =>
          prev.map(f => f.name === file.name ? { ...f, progress: 'complete' } : f)
        )
        toast.success(`${file.name} uploaded successfully`, { id: toastId })

        // Remove from uploading list after a short delay
        setTimeout(() => {
          setUploadingFiles(prev => prev.filter(f => f.name !== file.name))
        }, 2000)

      } catch (error) {
        console.error('Upload error:', error)
        const errorMsg = error instanceof Error ? error.message : 'Upload failed'

        setUploadingFiles(prev =>
          prev.map(f => f.name === file.name ? { ...f, progress: 'error', error: errorMsg } : f)
        )
        toast.error(`${file.name}: ${errorMsg}`, { id: toastId })

        // Remove from uploading list after showing error
        setTimeout(() => {
          setUploadingFiles(prev => prev.filter(f => f.name !== file.name))
        }, 3000)
      }
    }

    await loadDocuments()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Handle citation click - open sources panel and preview the source with fresh URL
  const handleCitationClick = useCallback(async (sourceIndex: number, sources: Source[]) => {
    const source = sources.find(s => s.index === sourceIndex)
    if (source) {
      setPreviewDoc(null) // Clear document preview when showing source
      setShowSourcesPanel(true)

      // If we have a documentId, fetch a fresh signed URL
      if (source.documentId) {
        setIsLoadingSourceUrl(true)
        setPreviewSource({ ...source, fileUrl: undefined }) // Show loading state

        try {
          const response = await fetch(`/api/documents/${source.documentId}`)
          if (response.ok) {
            const data = await response.json()
            setPreviewSource({ ...source, fileUrl: data.signedUrl })
          } else {
            // Fall back to stored URL or content preview
            setPreviewSource(source)
          }
        } catch (error) {
          console.error('Error fetching signed URL:', error)
          setPreviewSource(source) // Fall back to stored URL
        } finally {
          setIsLoadingSourceUrl(false)
        }
      } else {
        // No documentId, use content preview
        setPreviewSource(source)
      }
    }
  }, [])

  // Render text with clickable citations [1], [2], etc. - Enterprise superscript style
  const renderTextWithCitations = useCallback((text: string, sources: Source[]) => {
    // Split text by citation pattern [1], [2], etc.
    const parts = text.split(/(\[\d+\])/g)

    return parts.map((part, i) => {
      const match = part.match(/^\[(\d+)\]$/)
      if (match) {
        const sourceIndex = parseInt(match[1], 10)
        const source = sources.find(s => s.index === sourceIndex)
        if (source) {
          return (
            <button
              key={i}
              onClick={() => handleCitationClick(sourceIndex, sources)}
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition-colors cursor-pointer align-super -ml-0.5 mr-0.5 border border-primary/20 hover:border-primary/40"
              title={`${source.fileName}${source.pageNumber ? ` • Page ${source.pageNumber}` : ''}`}
            >
              {sourceIndex}
            </button>
          )
        }
      }
      return part
    })
  }, [handleCitationClick])

  // Renumber citations sequentially (e.g., [2], [5], [7] → [1], [2], [3])
  const renumberCitations = useCallback((content: string, sources: Source[]): { content: string; sources: Source[]; indexMap: Map<number, number> } => {
    // Extract citation numbers in order of first appearance
    const matches = [...content.matchAll(/\[(\d+)\]/g)]
    const seenNumbers: number[] = []
    matches.forEach(match => {
      const num = parseInt(match[1], 10)
      if (!seenNumbers.includes(num)) {
        seenNumbers.push(num)
      }
    })

    // Create mapping from original index to sequential index
    const indexMap = new Map<number, number>()
    seenNumbers.forEach((origIndex, i) => {
      indexMap.set(origIndex, i + 1)
    })

    // Replace numbers in content using placeholders to avoid conflicts
    // Step 1: Replace all [N] with unique placeholders __CITE_N__
    let newContent = content
    seenNumbers.forEach(origIndex => {
      newContent = newContent.replace(new RegExp(`\\[${origIndex}\\]`, 'g'), `__CITE_${origIndex}__`)
    })

    // Step 2: Replace placeholders with new sequential numbers
    seenNumbers.forEach(origIndex => {
      const newIndex = indexMap.get(origIndex)
      if (newIndex !== undefined) {
        newContent = newContent.replace(new RegExp(`__CITE_${origIndex}__`, 'g'), `[${newIndex}]`)
      }
    })

    // Create renumbered sources (only those that were cited)
    const renumberedSources = sources
      .filter(s => indexMap.has(s.index))
      .map(s => ({
        ...s,
        index: indexMap.get(s.index)!
      }))
      .sort((a, b) => a.index - b.index)

    return { content: newContent, sources: renumberedSources, indexMap }
  }, [])

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }

  const filteredDocs = documents.filter(doc =>
    doc.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Render loading skeleton for session loading
  if (isLoadingSession && sessionId) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex-shrink-0 h-14 border-b border-border bg-card flex items-center px-4">
          <div className="w-32 h-5 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
            <div className="flex justify-end">
              <div className="bg-secondary rounded-2xl px-4 py-3 w-48 h-10 animate-pulse" />
            </div>
            <div className="space-y-2">
              <div className="bg-muted rounded-lg h-4 w-3/4 animate-pulse" />
              <div className="bg-muted rounded-lg h-4 w-1/2 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* Main Chat Area */}
      <div className={`flex-1 flex flex-col min-w-[400px] transition-all duration-300`}>
        {/* Header Bar */}
        <div className="flex-shrink-0 h-14 border-b border-border bg-card flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-secondary transition-colors">
              <span className="text-sm font-medium text-foreground">{chatTitle}</span>
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Sources button with badge */}
            <button
              onClick={() => setShowSourcesPanel(!showSourcesPanel)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                showSourcesPanel ? 'bg-primary/10 border-primary text-primary' : 'border-border hover:bg-secondary'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-medium">{selectedDocIds.length}</span>
            </button>
            {/* Copy button */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(messages.map(m => `${m.role}: ${m.content}`).join('\n\n'))
                toast.success('Chat copied to clipboard')
              }}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Copy chat"
            >
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-4">
              <div className="max-w-2xl w-full text-center space-y-4">
                <h1 className="text-4xl font-semibold text-foreground">
                  {getGreeting()}
                </h1>
                <p className="text-lg text-muted-foreground">
                  How can I help you today?
                </p>
              </div>
            </div>
          ) : (
            <div className={`mx-auto px-4 py-8 space-y-6 transition-all duration-200 ${showSourcesPanel ? 'max-w-2xl' : 'max-w-3xl'}`}>
              {messages.map((msg) => {
                // Apply sequential renumbering for assistant messages with sources
                const { content: displayContent, sources: displaySources } =
                  msg.role === 'assistant' && msg.sources?.length
                    ? renumberCitations(msg.content, msg.sources)
                    : { content: msg.content, sources: msg.sources || [] }

                return (
                <div key={msg.id} className="space-y-2">
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="bg-secondary rounded-2xl px-4 py-3 max-w-[85%]">
                        <p className={`text-foreground whitespace-pre-wrap ${showSourcesPanel ? 'text-[15px]' : ''}`}>{msg.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {displayContent ? (
                        <div className={`prose prose-neutral dark:prose-invert max-w-none text-foreground leading-relaxed ${showSourcesPanel ? 'prose-sm' : ''}`}>
                          <ReactMarkdown
                            components={{
                              h1: ({ children }) => <h1 className="text-xl font-semibold mt-4 mb-2">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-lg font-semibold mt-3 mb-2">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1">{children}</h3>,
                              p: ({ children }) => {
                                // Process children to find and replace citations
                                const processChild = (child: React.ReactNode): React.ReactNode => {
                                  if (typeof child === 'string' && displaySources.length) {
                                    return renderTextWithCitations(child, displaySources)
                                  }
                                  return child
                                }
                                const processedChildren = Array.isArray(children)
                                  ? children.map(processChild)
                                  : processChild(children)
                                return <p className="mb-3 last:mb-0">{processedChildren}</p>
                              },
                              ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
                              li: ({ children }) => {
                                const processChild = (child: React.ReactNode): React.ReactNode => {
                                  if (typeof child === 'string' && displaySources.length) {
                                    return renderTextWithCitations(child, displaySources)
                                  }
                                  return child
                                }
                                const processedChildren = Array.isArray(children)
                                  ? children.map(processChild)
                                  : processChild(children)
                                return <li className="text-foreground">{processedChildren}</li>
                              },
                              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                              code: ({ children, className }) => {
                                const isInline = !className
                                return isInline ? (
                                  <code className="bg-secondary px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
                                ) : (
                                  <code className="block bg-secondary p-3 rounded-lg text-sm font-mono overflow-x-auto">{children}</code>
                                )
                              },
                              pre: ({ children }) => <pre className="bg-secondary p-3 rounded-lg overflow-x-auto mb-3">{children}</pre>,
                            }}
                          >
                            {displayContent}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-muted-foreground py-2">
                          <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      )}
                      {/* Sources footer - Show renumbered sources */}
                      {displaySources.length > 0 && (() => {
                        // Group sources by fileName (already renumbered)
                        const groupedSources = new Map<string, { fileName: string; sources: Source[] }>()
                        displaySources.forEach(source => {
                          if (!groupedSources.has(source.fileName)) {
                            groupedSources.set(source.fileName, { fileName: source.fileName, sources: [] })
                          }
                          groupedSources.get(source.fileName)!.sources.push(source)
                        })

                        return (
                          <div className="mt-4 pt-3 border-t border-border/30">
                            <div className="flex items-center gap-1.5 mb-2">
                              <svg className="w-3.5 h-3.5 text-muted-foreground/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                              </svg>
                              <span className="text-[11px] font-medium text-muted-foreground/70">Sources</span>
                            </div>
                            <div className="space-y-1.5">
                              {Array.from(groupedSources.values()).map((group) => (
                                <div
                                  key={group.fileName}
                                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border/40 hover:border-primary/20 bg-muted/20 hover:bg-muted/30 transition-colors"
                                >
                                  <svg className="w-4 h-4 text-muted-foreground/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                  </svg>
                                  <span className="text-xs text-foreground/80 truncate flex-1 min-w-0">{group.fileName}</span>
                                  <div className="flex gap-0.5 flex-shrink-0">
                                    {group.sources.slice(0, 6).map(source => (
                                      <button
                                        key={source.index}
                                        onClick={() => handleCitationClick(source.index, displaySources)}
                                        className="w-5 h-5 flex items-center justify-center bg-primary/10 text-primary text-[10px] font-semibold rounded hover:bg-primary/20 transition-colors"
                                        title={source.pageNumber ? `Page ${source.pageNumber}` : `Source ${source.index}`}
                                      >
                                        {source.index}
                                      </button>
                                    ))}
                                    {group.sources.length > 6 && (
                                      <span className="w-5 h-5 flex items-center justify-center text-[9px] text-muted-foreground">+{group.sources.length - 6}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
                )
              })}
              <div ref={scrollRef} />
            </div>
          )}
        </div>

        {/* Input area - Claude style */}
        <div className="p-4">
          <div className="max-w-3xl mx-auto">
            <div className="relative bg-card border border-border rounded-2xl shadow-sm">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Reply..."
                disabled={isLoading}
                rows={1}
                className="w-full resize-none bg-transparent px-4 pt-4 pb-14 text-foreground placeholder:text-muted-foreground focus:outline-none text-[15px] min-h-[100px] max-h-[300px]"
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(Math.max(target.scrollHeight, 100), 300) + 'px'
                }}
              />

              {/* Bottom toolbar */}
              <div className="absolute left-3 bottom-3 flex items-center gap-1">
                {/* + Button */}
                <div className="relative" ref={addMenuRef}>
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    title="Add"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>

                  {/* Add menu popup */}
                  {showAddMenu && (
                    <div className="absolute bottom-full left-0 mb-2 w-64 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2">
                      <div className="py-1">
                        <label className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors cursor-pointer">
                          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                          </svg>
                          Add files or photos
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.docx,.doc,.txt,.md,.html,.pptx,.xlsx"
                            multiple
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                        </label>
                        <button
                          onClick={() => {
                            setShowAddMenu(false)
                            setShowSourcesPanel(true)
                          }}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-foreground hover:bg-secondary transition-colors text-left"
                        >
                          <div className="flex items-center gap-3">
                            <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Manage documents
                          </div>
                          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* History Button */}
                <button className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="History">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>

                {/* Style Button */}
                <button className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Style">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                </button>
              </div>

              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                {/* Model Selector */}
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-secondary text-sm text-muted-foreground">
                  <span>GPT-4o mini</span>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Send Button */}
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className={`w-9 h-9 flex items-center justify-center rounded-full transition-all ${
                    input.trim() && !isLoading
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-primary/30 text-primary-foreground/50 cursor-not-allowed'
                  }`}
                  title="Send message"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-2">
              AI can make mistakes. Please double-check responses.
            </p>
          </div>
        </div>
      </div>

      {/* Right Panel (Sources) */}
      {showSourcesPanel && (
        <div className={`border-l border-border bg-card flex flex-col h-full overflow-hidden flex-shrink-0 transition-all duration-200 ${previewSource || previewDoc ? 'w-[600px]' : 'w-[400px]'}`}>
          {previewSource ? (
            /* Source Citation Preview View - PDF or Text */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Compact header: back + filename + number + close */}
              <div className="flex-shrink-0 h-12 px-3 border-b border-border flex items-center gap-2">
                <button
                  onClick={() => setPreviewSource(null)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Back to sources"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm font-medium text-foreground truncate flex-1 min-w-0">{previewSource.fileName}</span>
                <span className="w-5 h-5 flex items-center justify-center bg-primary/15 text-primary text-[10px] font-semibold rounded-full flex-shrink-0">
                  {previewSource.index}
                </span>
                <button
                  onClick={() => setShowSourcesPanel(false)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground ml-1"
                  title="Close panel"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {isLoadingSourceUrl ? (
                /* Loading state while fetching fresh URL */
                <div className="flex-1 flex items-center justify-center bg-muted/30">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-muted-foreground/20 border-t-primary rounded-full animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading document...</p>
                  </div>
                </div>
              ) : previewSource.fileUrl ? (
                /* Full PDF Preview with page navigation */
                <div className="flex-1 overflow-hidden bg-muted/30">
                  <iframe
                    key={`${previewSource.index}-${previewSource.pageNumber}`}
                    src={`${previewSource.fileUrl}${previewSource.pageNumber ? `#page=${previewSource.pageNumber}` : ''}`}
                    className="w-full h-full border-0"
                    title={`PDF Preview: ${previewSource.fileName}`}
                  />
                </div>
              ) : (
                /* Fallback to text content when PDF URL not available */
                <div className="flex-1 overflow-y-auto p-4">
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Source Content</p>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {previewSource.content || 'No preview content available'}
                    </p>
                  </div>
                  <div className="mt-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
                    <p className="text-xs text-muted-foreground">
                      This excerpt was retrieved from your uploaded document based on relevance to your query.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : previewDoc ? (
            /* Document Preview View */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-shrink-0 h-12 px-3 border-b border-border flex items-center gap-2">
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Back to sources"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm font-medium text-foreground truncate flex-1">{previewDoc.fileName}</span>
                <button
                  onClick={() => setShowSourcesPanel(false)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Close panel"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-hidden bg-muted/30 flex items-center justify-center">
                <p className="text-muted-foreground text-sm">Preview not available</p>
              </div>
            </div>
          ) : (
            /* Documents List View */
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Compact header with icon and close */}
              <div className="flex-shrink-0 h-12 px-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <span className="text-sm font-medium text-foreground">Sources</span>
                </div>
                <button
                  onClick={() => setShowSourcesPanel(false)}
                  className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                  title="Close panel"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Search */}
              <div className="flex-shrink-0 p-3 border-b border-border">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search documents..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm bg-muted border-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/25 placeholder:text-muted-foreground"
                  />
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-muted-foreground">{filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}</span>
                  <button
                    onClick={() => {
                      if (selectedDocIds.length === documents.length) {
                        setSelectedDocIds([])
                      } else {
                        setSelectedDocIds(documents.map(d => d.id))
                      }
                    }}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {selectedDocIds.length === documents.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </div>

              {/* Documents list */}
              <div className="flex-1 overflow-y-auto">
                {/* Uploading files */}
                {uploadingFiles.map((file) => (
                  <div key={file.name} className="flex items-center gap-3 px-4 py-3 bg-secondary/50 border-b border-border">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      {file.progress === 'uploading' || file.progress === 'processing' ? (
                        <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      ) : file.progress === 'complete' ? (
                        <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {file.progress === 'uploading' && 'Uploading...'}
                        {file.progress === 'processing' && 'Processing...'}
                        {file.progress === 'complete' && 'Complete'}
                        {file.progress === 'error' && (file.error || 'Failed')}
                      </p>
                    </div>
                  </div>
                ))}

                {filteredDocs.length === 0 && uploadingFiles.length === 0 ? (
                  <div className="p-8 text-center">
                    <svg className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <p className="text-sm text-muted-foreground">No documents yet</p>
                  </div>
                ) : (
                  filteredDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors border-b border-border"
                    >
                      <div
                        onClick={() => {
                          if (selectedDocIds.includes(doc.id)) {
                            setSelectedDocIds(prev => prev.filter(id => id !== doc.id))
                          } else {
                            setSelectedDocIds(prev => [...prev, doc.id])
                          }
                        }}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${
                          selectedDocIds.includes(doc.id)
                            ? 'border-primary bg-primary'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        {selectedDocIds.includes(doc.id) && (
                          <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div
                        className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0"
                        onClick={() => { setPreviewDoc(doc); setPreviewSource(null); }}
                      >
                        <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0" onClick={() => { setPreviewDoc(doc); setPreviewSource(null); }}>
                        <p className="text-sm font-medium text-foreground truncate">{doc.fileName}</p>
                        <p className="text-xs text-muted-foreground">Document · PDF</p>
                      </div>
                      <span className="text-xs text-muted-foreground">{formatFileSize(doc.fileSize)}</span>
                    </div>
                  ))
                )}
              </div>

              {/* Add more sources button */}
              <div className="flex-shrink-0 border-t border-border p-4">
                <label className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all cursor-pointer">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-sm font-medium">Add more sources</span>
                  <input
                    type="file"
                    accept=".pdf,.docx,.doc,.txt,.md,.html,.pptx,.xlsx"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ChatLoading() {
  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-muted-foreground/20 border-t-primary rounded-full animate-spin" />
          <p className="text-muted-foreground text-sm">Loading chat...</p>
        </div>
      </div>
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatContent />
    </Suspense>
  )
}
