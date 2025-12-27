/**
 * Direct batch embedding script using service role key
 * Fetches all chunks, generates local embeddings, and updates directly
 *
 * Usage: npx tsx scripts/direct-embed-all.ts
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

const BATCH_SIZE = 50
const MAX_CHUNKS = parseInt(process.env.MAX_CHUNKS || '10000')

interface Chunk {
  id: string
  content: string
}

async function main() {
  console.log('🚀 Starting batch embedding process...')
  console.log(`   Max chunks: ${MAX_CHUNKS}`)
  console.log(`   Batch size: ${BATCH_SIZE}`)

  // Preload model
  console.log('\n📦 Loading embedding model...')
  await preloadEmbeddingModel()
  console.log('✅ Model loaded!')

  let offset = 0
  let totalProcessed = 0
  let totalUpdated = 0
  let hasMore = true

  const startTime = Date.now()

  while (hasMore && totalProcessed < MAX_CHUNKS) {
    // Fetch chunks without local embeddings
    const { data: chunks, error: fetchError } = await supabase
      .from('document_chunks')
      .select('id, content')
      .is('embedding_local', null)
      .range(offset, offset + BATCH_SIZE - 1)
      .order('id')

    if (fetchError) {
      console.error('❌ Error fetching chunks:', fetchError)
      break
    }

    if (!chunks || chunks.length === 0) {
      hasMore = false
      break
    }

    console.log(`\n📥 Processing batch: ${offset} to ${offset + chunks.length - 1}`)

    // Process each chunk
    for (const chunk of chunks as Chunk[]) {
      try {
        // Generate embedding
        const embedding = await generateLocalEmbedding(chunk.content)

        // Update in database
        const { error: updateError } = await supabase
          .from('document_chunks')
          .update({ embedding_local: embedding })
          .eq('id', chunk.id)

        if (updateError) {
          console.error(`   ⚠️  Error updating ${chunk.id}:`, updateError.message)
        } else {
          totalUpdated++
        }

        totalProcessed++

        // Progress indicator
        if (totalProcessed % 10 === 0) {
          const elapsed = (Date.now() - startTime) / 1000
          const rate = totalProcessed / elapsed
          const remaining = (MAX_CHUNKS - totalProcessed) / rate
          process.stdout.write(`\r   Progress: ${totalProcessed} chunks (${rate.toFixed(1)}/s, ~${Math.ceil(remaining)}s remaining)`)
        }
      } catch (err) {
        console.error(`   ⚠️  Error processing ${chunk.id}:`, err)
      }
    }

    offset += BATCH_SIZE
  }

  const totalTime = (Date.now() - startTime) / 1000

  console.log('\n')
  console.log('=' .repeat(50))
  console.log('✅ BATCH EMBEDDING COMPLETE')
  console.log('=' .repeat(50))
  console.log(`   Total processed: ${totalProcessed}`)
  console.log(`   Total updated:   ${totalUpdated}`)
  console.log(`   Time elapsed:    ${totalTime.toFixed(1)}s`)
  console.log(`   Rate:            ${(totalProcessed / totalTime).toFixed(1)} chunks/sec`)
  console.log('=' .repeat(50))
}

main().catch(console.error)
