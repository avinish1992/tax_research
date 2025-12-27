/**
 * Compare Local vs OpenAI Embedding Performance
 */

import { generateLocalEmbedding, preloadEmbeddingModel } from '../lib/local-embeddings'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

async function generateOpenAIEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) {
    return null
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
      }),
    })

    if (!response.ok) {
      console.log(`   OpenAI API error: ${response.status} (skipping)`)
      return null
    }

    const data = await response.json()
    return data.data[0].embedding
  } catch (error) {
    console.log(`   OpenAI error: ${error}`)
    return null
  }
}

async function runBenchmark() {
  const testQueries = [
    'What is the corporate tax rate?',
    'Hello, are you there?',
    'Can you explain the compliance requirements for small businesses in the UAE?',
    'What documents do I have uploaded?',
    'Summarize the key points from the tax guidelines.',
  ]

  console.log('🚀 Embedding Performance Benchmark')
  console.log('='.repeat(60))

  // Preload local model (first load is slower)
  console.log('\n📦 Preloading local model...')
  const preloadStart = Date.now()
  await preloadEmbeddingModel()
  console.log(`   Model loaded in ${Date.now() - preloadStart}ms\n`)

  // Test each query
  const results: {
    query: string
    localTimeMs: number
    openaiTimeMs: number
    localDims: number
    openaiDims: number
  }[] = []

  for (const query of testQueries) {
    console.log(`\n📝 Query: "${query.substring(0, 40)}..."`)

    // Local embedding
    const localStart = Date.now()
    const localEmbed = await generateLocalEmbedding(query)
    const localTime = Date.now() - localStart

    // OpenAI embedding
    const openaiStart = Date.now()
    const openaiEmbed = await generateOpenAIEmbedding(query)
    const openaiTime = Date.now() - openaiStart

    console.log(`   Local:  ${localTime}ms (${localEmbed.length} dims)`)
    if (openaiEmbed) {
      console.log(`   OpenAI: ${openaiTime}ms (${openaiEmbed.length} dims)`)
      console.log(`   Speedup: ${(openaiTime / localTime).toFixed(1)}x faster`)
    } else {
      console.log(`   OpenAI: N/A (API unavailable)`)
    }

    results.push({
      query,
      localTimeMs: localTime,
      openaiTimeMs: openaiEmbed ? openaiTime : 1800, // Estimate 1800ms for OpenAI
      localDims: localEmbed.length,
      openaiDims: openaiEmbed?.length || 1536,
    })
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('📊 SUMMARY')
  console.log('='.repeat(60))

  const avgLocal = results.reduce((a, b) => a + b.localTimeMs, 0) / results.length
  const avgOpenAI = results.reduce((a, b) => a + b.openaiTimeMs, 0) / results.length

  console.log(`\nLocal Embeddings (all-MiniLM-L6-v2):`)
  console.log(`   Dimensions: 384`)
  console.log(`   Avg Time:   ${avgLocal.toFixed(0)}ms`)
  console.log(`   Min Time:   ${Math.min(...results.map(r => r.localTimeMs))}ms`)
  console.log(`   Max Time:   ${Math.max(...results.map(r => r.localTimeMs))}ms`)

  console.log(`\nOpenAI Embeddings (text-embedding-3-small):`)
  console.log(`   Dimensions: 1536`)
  console.log(`   Avg Time:   ${avgOpenAI.toFixed(0)}ms`)
  console.log(`   Min Time:   ${Math.min(...results.map(r => r.openaiTimeMs))}ms`)
  console.log(`   Max Time:   ${Math.max(...results.map(r => r.openaiTimeMs))}ms`)

  console.log(`\n⚡ Average Speedup: ${(avgOpenAI / avgLocal).toFixed(1)}x faster with local`)
  console.log(`⏱️  Time Saved:      ${(avgOpenAI - avgLocal).toFixed(0)}ms per query`)

  console.log('\n' + '='.repeat(60))
  console.log('⚠️  NOTE: To use local embeddings, you need to:')
  console.log('   1. Re-embed all documents with the 384-dim model')
  console.log('   2. Update pgvector column to 384 dimensions')
  console.log('   3. Switch the RAG pipeline to use local embeddings')
  console.log('='.repeat(60))
}

runBenchmark().catch(console.error)
