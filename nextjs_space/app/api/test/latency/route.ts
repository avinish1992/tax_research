import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60 seconds for the test

// Simple API key for test endpoint (should be in env var in production)
const TEST_API_KEY = process.env.TEST_API_KEY || 'latency-test-key-2024'

interface LatencyTestResult {
  success: boolean
  error?: string
  testId: string
  timestamp: string

  // Auth metrics
  authTimeMs: number

  // Session metrics
  sessionTimeMs: number
  sessionId: string

  // RAG metrics (from response headers if available)
  ragTimeMs?: number

  // LLM metrics
  ttftMs: number              // Time to First Token
  streamDurationMs: number    // Time from first to last token
  totalLlmTimeMs: number      // Total LLM response time

  // Response metrics
  tokenCount: number
  tokensPerSecond: number
  responseCharCount: number
  sourceCount: number

  // Total
  totalRequestTimeMs: number

  // Query info
  query: string
  model: string
}

export async function POST(request: NextRequest) {
  const testStartTime = Date.now()
  const testId = `test_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

  try {
    // Validate API key
    const apiKey = request.headers.get('x-api-key')
    if (apiKey !== TEST_API_KEY) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      query = 'What documents do I have uploaded?',
      model = 'gpt-4o-mini',
      email = process.env.TEST_USER_EMAIL,
      password = process.env.TEST_USER_PASSWORD,
    } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Test credentials not configured' },
        { status: 500 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const result: Partial<LatencyTestResult> = {
      testId,
      timestamp: new Date().toISOString(),
      query,
      model,
    }

    // === Step 1: Authenticate ===
    console.log(`[${testId}] Starting latency test...`)
    const authStartTime = Date.now()

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
      },
      body: JSON.stringify({ email, password }),
    })

    if (!authResponse.ok) {
      const error = await authResponse.text()
      return NextResponse.json(
        { error: `Authentication failed: ${error}`, testId },
        { status: 401 }
      )
    }

    const authData = await authResponse.json()
    result.authTimeMs = Date.now() - authStartTime
    console.log(`[${testId}] Auth completed in ${result.authTimeMs}ms`)

    // Create admin client for direct DB access
    const supabase = createAdminClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: `Bearer ${authData.access_token}`,
        },
      },
    })

    // === Step 2: Get or create chat session ===
    const sessionStartTime = Date.now()

    // Try to get existing test session
    const { data: sessions } = await supabase
      .from('chat_sessions')
      .select('id')
      .eq('user_id', authData.user.id)
      .eq('title', 'Latency Test Session')
      .limit(1)

    let sessionId: string

    if (sessions && sessions.length > 0) {
      sessionId = sessions[0].id
    } else {
      // Create new test session
      const { data: newSession, error: createError } = await supabase
        .from('chat_sessions')
        .insert({
          user_id: authData.user.id,
          title: 'Latency Test Session',
        })
        .select('id')
        .single()

      if (createError || !newSession) {
        return NextResponse.json(
          { error: `Failed to create session: ${createError?.message}`, testId },
          { status: 500 }
        )
      }
      sessionId = newSession.id
    }

    result.sessionTimeMs = Date.now() - sessionStartTime
    result.sessionId = sessionId
    console.log(`[${testId}] Session ready in ${result.sessionTimeMs}ms`)

    // === Step 3: Send chat request and measure streaming ===
    const chatStartTime = Date.now()
    let firstTokenTime: number | null = null
    let lastTokenTime: number = Date.now()
    let tokenCount = 0
    let fullResponse = ''
    let sourceCount = 0

    // Get the base URL from request
    const baseUrl = request.nextUrl.origin

    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `sb-sjdaemlbjntadadggenr-auth-token=${encodeURIComponent(JSON.stringify({
          access_token: authData.access_token,
          refresh_token: authData.refresh_token,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: 'bearer',
          user: authData.user,
        }))}`,
      },
      body: JSON.stringify({
        chatSessionId: sessionId,
        message: query,
        model,
      }),
    })

    if (!chatResponse.ok) {
      const error = await chatResponse.text()
      return NextResponse.json(
        {
          error: `Chat request failed: ${chatResponse.status} - ${error}`,
          testId,
          authTimeMs: result.authTimeMs,
          sessionTimeMs: result.sessionTimeMs,
        },
        { status: chatResponse.status }
      )
    }

    if (!chatResponse.body) {
      return NextResponse.json(
        { error: 'No response body', testId },
        { status: 500 }
      )
    }

    // Stream the response and measure timing
    const reader = chatResponse.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)

          // Check for sources metadata
          if (parsed.sources) {
            sourceCount = parsed.sources.length
            continue
          }

          // Check for content tokens
          const content = parsed?.choices?.[0]?.delta?.content
          if (content) {
            if (!firstTokenTime) {
              firstTokenTime = Date.now()
              result.ttftMs = firstTokenTime - chatStartTime
              console.log(`[${testId}] ⚡ TTFT: ${result.ttftMs}ms`)
            }
            tokenCount++
            lastTokenTime = Date.now()
            fullResponse += content
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // === Calculate final metrics ===
    const chatEndTime = Date.now()
    result.totalLlmTimeMs = chatEndTime - chatStartTime
    result.streamDurationMs = firstTokenTime ? lastTokenTime - firstTokenTime : 0
    result.tokenCount = tokenCount
    result.responseCharCount = fullResponse.length
    result.sourceCount = sourceCount
    result.tokensPerSecond = result.streamDurationMs > 0
      ? tokenCount / (result.streamDurationMs / 1000)
      : 0
    result.totalRequestTimeMs = chatEndTime - testStartTime
    result.success = true

    // Log summary
    console.log('\n' + '='.repeat(80))
    console.log(`📊 LATENCY TEST RESULTS [${testId}]`)
    console.log('='.repeat(80))
    console.log(`Query: "${query.substring(0, 50)}..."`)
    console.log(`Model: ${model}`)
    console.log('')
    console.log('⏱️  TIMING:')
    console.log(`   Auth:          ${result.authTimeMs}ms`)
    console.log(`   Session:       ${result.sessionTimeMs}ms`)
    console.log(`   TTFT:          ${result.ttftMs}ms`)
    console.log(`   Streaming:     ${result.streamDurationMs}ms`)
    console.log(`   Total LLM:     ${result.totalLlmTimeMs}ms`)
    console.log(`   Total Request: ${result.totalRequestTimeMs}ms`)
    console.log('')
    console.log('📈 RESPONSE:')
    console.log(`   Tokens:        ${result.tokenCount}`)
    console.log(`   Throughput:    ${result.tokensPerSecond?.toFixed(1)} tok/s`)
    console.log(`   Sources:       ${result.sourceCount}`)
    console.log('='.repeat(80) + '\n')

    return NextResponse.json(result)

  } catch (error) {
    console.error(`[${testId}] Test error:`, error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        testId,
        timestamp: new Date().toISOString(),
        success: false,
      },
      { status: 500 }
    )
  }
}

// GET endpoint for quick health check and usage info
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/test/latency',
    method: 'POST',
    description: 'Test chat API latency and return detailed metrics',
    headers: {
      'x-api-key': 'Required - API key for authentication',
      'Content-Type': 'application/json',
    },
    body: {
      query: 'Optional - The test query (default: "What documents do I have uploaded?")',
      model: 'Optional - The model to use (default: "gpt-4o-mini")',
      email: 'Optional - Override test user email',
      password: 'Optional - Override test user password',
    },
    metrics: [
      'authTimeMs - Time to authenticate with Supabase',
      'sessionTimeMs - Time to get/create chat session',
      'ttftMs - Time To First Token from LLM',
      'streamDurationMs - Duration of token streaming',
      'totalLlmTimeMs - Total LLM response time',
      'tokenCount - Approximate token count',
      'tokensPerSecond - Streaming throughput',
      'totalRequestTimeMs - End-to-end request time',
    ],
    example: {
      curl: `curl -X POST https://taxsavant.netlify.app/api/test/latency \\
  -H "x-api-key: latency-test-key-2024" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "What is the corporate tax rate?"}'`,
    },
  })
}
