/**
 * PARALLEL batch embedding - processes multiple chunks concurrently
 * Much faster than sequential processing
 *
 * Usage: npx tsx scripts/parallel-embed.ts
 */
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { generateLocalEmbedding, preloadEmbeddingModel } from '../lib/local-embeddings'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Tunable parameters
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '20')  // Parallel operations
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100')   // Chunks per fetch
const MAX_CHUNKS = parseInt(process.env.MAX_CHUNKS || '10000')

interface Chunk {
  id: string
  content: string
}

async function processChunk(chunk: Chunk): Promise<boolean> {
  try {
    const embedding = await generateLocalEmbedding(chunk.content)

    const { error } = await supabase
      .from('document_chunks')
      .update({ embedding_local: embedding })
      .eq('id', chunk.id)

    return !error
  } catch (err) {
    console.error(`Error processing ${chunk.id}:`, err)
    return false
  }
}

// Process chunks in parallel batches
async function processInParallel(chunks: Chunk[], concurrency: number): Promise<number> {
  let successCount = 0

  // Process in waves of 'concurrency' size
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency)
    const results = await Promise.all(batch.map(processChunk))
    successCount += results.filter(Boolean).length
  }

  return successCount
}

async function main() {
  console.log('🚀 PARALLEL Batch Embedding')
  console.log(`   Concurrency: ${CONCURRENCY} parallel operations`)
  console.log(`   Batch size:  ${BATCH_SIZE} chunks per fetch`)
  console.log(`   Max chunks:  ${MAX_CHUNKS}`)
  console.log('')

  // Preload model
  console.log('📦 Loading embedding model...')
  await preloadEmbeddingModel()
  console.log('✅ Model loaded!\n')

  let offset = 0
  let totalProcessed = 0
  let totalUpdated = 0
  let hasMore = true

  const startTime = Date.now()

  while (hasMore && totalProcessed < MAX_CHUNKS) {
    // Fetch batch
    const { data: chunks, error } = await supabase
      .from('document_chunks')
      .select('id, content')
      .is('embedding_local', null)
      .range(offset, offset + BATCH_SIZE - 1)
      .order('id')

    if (error) {
      console.error('❌ Error fetching:', error)
      break
    }

    if (!chunks || chunks.length === 0) {
      hasMore = false
      break
    }

    const batchStart = Date.now()

    // Process in parallel!
    const updated = await processInParallel(chunks as Chunk[], CONCURRENCY)

    totalProcessed += chunks.length
    totalUpdated += updated

    const batchTime = (Date.now() - batchStart) / 1000
    const totalTime = (Date.now() - startTime) / 1000
    const rate = totalProcessed / totalTime
    const remaining = Math.max(0, MAX_CHUNKS - totalProcessed) / rate

    console.log(`✅ Batch ${Math.ceil(offset / BATCH_SIZE) + 1}: ${chunks.length} chunks in ${batchTime.toFixed(1)}s | Total: ${totalProcessed} (${rate.toFixed(1)}/s) | ETA: ${Math.ceil(remaining)}s`)

    offset += BATCH_SIZE
  }

  const totalTime = (Date.now() - startTime) / 1000

  console.log('\n' + '='.repeat(60))
  console.log('✅ PARALLEL EMBEDDING COMPLETE')
  console.log('='.repeat(60))
  console.log(`   Total processed: ${totalProcessed}`)
  console.log(`   Total updated:   ${totalUpdated}`)
  console.log(`   Time elapsed:    ${totalTime.toFixed(1)}s`)
  console.log(`   Rate:            ${(totalProcessed / totalTime).toFixed(1)} chunks/sec`)
  console.log('='.repeat(60))
}

main().catch(console.error)
