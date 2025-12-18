'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  sources?: Source[]
}

interface Source {
  fileName: string
  pageNumber?: number
  content?: string
  similarity?: number
}

interface Document {
  id: string
  fileName: string
  uploadedAt: string
}

function ChatContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionId = searchParams?.get('session') ?? null

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [documents, setDocuments] = useState<Document[]>([])
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [showDocPicker, setShowDocPicker] = useState(false)
  const [model, setModel] = useState('gpt-4o-mini')

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const docPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sessionId) {
      loadChatSession(sessionId)
    } else {
      setMessages([])
    }
  }, [sessionId])

  useEffect(() => {
    loadDocuments()
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (docPickerRef.current && !docPickerRef.current.contains(e.target as Node)) {
        setShowDocPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const scrollToBottom = () => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const loadChatSession = async (id: string) => {
    try {
      const response = await fetch(`/api/chat-sessions/${id}`)
      const data = await response.json()
      setMessages(data?.chatSession?.messages ?? [])
    } catch (error) {
      console.error('Error loading chat session:', error)
    }
  }

  const loadDocuments = async () => {
    try {
      const response = await fetch('/api/documents')
      const data = await response.json()
      const docs = data?.documents ?? []
      setDocuments(docs)
      setSelectedDocIds(docs.map((d: Document) => d.id))
    } catch (error) {
      console.error('Error loading documents:', error)
    }
  }

  const createSessionAndSend = async (message: string) => {
    try {
      const response = await fetch('/api/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: message.slice(0, 50) }),
      })
      const data = await response.json()
      if (data?.chatSession?.id) {
        router.push(`/dashboard/chat?session=${data.chatSession.id}`)
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

    let currentSessionId = sessionId
    if (!currentSessionId) {
      currentSessionId = await createSessionAndSend(message)
      if (!currentSessionId) return
    }

    setIsLoading(true)

    const tempUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])

    const tempAssistantMsg: Message = {
      id: (Date.now() + 1).toString(),
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
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === tempAssistantMsg.id
                      ? { ...msg, content: assistantResponse, sources }
                      : msg
                  )
                )
              }
            } catch (parseError) {
              // Only throw if it's an actual error, not a parse error
              if (parseError instanceof Error && parseError.message !== 'Unexpected token') {
                throw parseError
              }
            }
          }
        }
      }

      // If no response was generated, show a message
      if (!assistantResponse) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === tempAssistantMsg.id
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
          msg.id === tempAssistantMsg.id
            ? { ...msg, content: `Sorry, an error occurred: ${errorMessage}. Please try again.` }
            : msg
        )
      )
    } finally {
      setIsLoading(false)
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

    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)

      try {
        await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
        })
      } catch (error) {
        console.error('Upload error:', error)
      }
    }

    await loadDocuments()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const toggleDocument = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    )
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-4">
            <div className="max-w-2xl w-full text-center space-y-6">
              <h1 className="text-4xl font-serif text-foreground">
                {getGreeting()}
              </h1>
              <p className="text-lg text-muted-foreground">
                How can I help you today?
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
            {messages.map((msg) => (
              <div key={msg.id} className="space-y-2">
                {msg.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="bg-secondary rounded-2xl px-4 py-3 max-w-[85%]">
                      <p className="text-foreground whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-foreground whitespace-pre-wrap leading-relaxed">
                      {msg.content || (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse delay-100" />
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse delay-200" />
                        </span>
                      )}
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {msg.sources.map((source, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-secondary rounded-lg text-xs text-muted-foreground"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            {source.fileName}
                            {source.pageNumber && ` p.${source.pageNumber}`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={scrollRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-background p-4">
        <div className="max-w-3xl mx-auto">
          <div className="relative bg-card border border-border rounded-2xl shadow-sm">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="How can I help you today?"
              disabled={isLoading}
              rows={1}
              className="w-full resize-none bg-transparent px-4 py-3.5 pr-24 text-foreground placeholder:text-muted-foreground focus:outline-none text-[15px] leading-relaxed min-h-[52px] max-h-[200px]"
              style={{ height: 'auto' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = Math.min(target.scrollHeight, 200) + 'px'
              }}
            />

            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              {/* Document picker */}
              <div className="relative" ref={docPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowDocPicker(!showDocPicker)}
                  className={`p-2 rounded-lg transition-colors ${
                    selectedDocIds.length > 0
                      ? 'text-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                  title="Select documents"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>

                {showDocPicker && (
                  <div className="absolute bottom-full right-0 mb-2 w-72 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50">
                    <div className="p-3 border-b border-border">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-foreground">Documents</h4>
                        <label className="text-xs text-primary hover:underline cursor-pointer">
                          Upload
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf"
                            multiple
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {documents.length === 0 ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                          No documents yet
                        </div>
                      ) : (
                        documents.map((doc) => (
                          <button
                            key={doc.id}
                            onClick={() => toggleDocument(doc.id)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary transition-colors text-left"
                          >
                            <div
                              className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                selectedDocIds.includes(doc.id)
                                  ? 'border-primary bg-primary'
                                  : 'border-border'
                              }`}
                            >
                              {selectedDocIds.includes(doc.id) && (
                                <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <span className="text-sm text-foreground truncate">{doc.fileName}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Send button */}
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className={`p-2 rounded-lg transition-colors ${
                  input.trim() && !isLoading
                    ? 'text-primary-foreground bg-primary hover:bg-primary/90'
                    : 'text-muted-foreground bg-secondary cursor-not-allowed'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            </div>
          </div>

          {selectedDocIds.length > 0 && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              {selectedDocIds.length} document{selectedDocIds.length > 1 ? 's' : ''} selected for context
            </p>
          )}
        </div>
      </div>
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
