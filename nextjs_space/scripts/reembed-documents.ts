/**
 * Re-embedding Script for Existing Documents
 *
 * This script generates local embeddings (all-MiniLM-L6-v2, 384 dims)
 * for all existing document chunks that don't have them yet.
 *
 * Run with: npx tsx scripts/reembed-documents.ts
 *
 * Options:
 *   --dry-run     Show what would be done without making changes
 *   --batch-size  Number of chunks to process at once (default: 50)
 *   --limit       Maximum number of chunks to process (for testing)
 */

import { createClient } from '@supabase/supabase-js'
import { generateLocalEmbedding, preloadEmbeddingModel } from '../lib/local-embeddings'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Parse command line arguments
const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const batchSizeArg = args.find(a => a.startsWith('--batch-size='))
const limitArg = args.find(a => a.startsWith('--limit='))

const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 50
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : undefined

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables:')
  console.error('   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) required')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface ChunkToUpdate {
  id: string
  content: string
}

async function getChunksWithoutLocalEmbedding(offset: number, limit: number): Promise<ChunkToUpdate[]> {
  const { data, error } = await supabase
    .from('document_chunks')
    .select('id, content')
    .is('embedding_local', null)
    .order('id')
    .range(offset, offset + limit - 1)

  if (error) {
    throw new Error(`Failed to fetch chunks: ${error.message}`)
  }

  return data || []
}

async function updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
  const { error } = await supabase
    .from('document_chunks')
    .update({
      embedding_local: `[${embedding.join(',')}]`
    })
    .eq('id', chunkId)

  if (error) {
    throw new Error(`Failed to update chunk ${chunkId}: ${error.message}`)
  }
}

async function getTotalChunksWithoutEmbedding(): Promise<number> {
  const { count, error } = await supabase
    .from('document_chunks')
    .select('*', { count: 'exact', head: true })
    .is('embedding_local', null)

  if (error) {
    throw new Error(`Failed to count chunks: ${error.message}`)
  }

  return count || 0
}

async function main() {
  console.log('═'.repeat(70))
  console.log('🔄 DOCUMENT RE-EMBEDDING SCRIPT')
  console.log('═'.repeat(70))
  console.log(`Mode:       ${isDryRun ? '🔍 DRY RUN (no changes)' : '✏️  LIVE (will update database)'}`)
  console.log(`Batch size: ${BATCH_SIZE}`)
  if (LIMIT) console.log(`Limit:      ${LIMIT} chunks`)
  console.log('')

  // Preload the embedding model
  console.log('📦 Loading local embedding model...')
  const modelStart = Date.now()
  await preloadEmbeddingModel()
  console.log(`   ✅ Model loaded in ${Date.now() - modelStart}ms`)
  console.log('')

  // Get total count
  const totalWithoutEmbedding = await getTotalChunksWithoutEmbedding()
  const toProcess = LIMIT ? Math.min(totalWithoutEmbedding, LIMIT) : totalWithoutEmbedding

  console.log(`📊 Chunks without local embedding: ${totalWithoutEmbedding}`)
  console.log(`📊 Chunks to process: ${toProcess}`)
  console.log('')

  if (toProcess === 0) {
    console.log('✅ All chunks already have local embeddings!')
    return
  }

  // Process in batches
  let processed = 0
  let failed = 0
  const startTime = Date.now()
  const embeddingTimes: number[] = []

  console.log('🚀 Starting re-embedding...')
  console.log('─'.repeat(70))

  while (processed < toProcess) {
    const batchSize = Math.min(BATCH_SIZE, toProcess - processed)
    const chunks = await getChunksWithoutLocalEmbedding(0, batchSize)

    if (chunks.length === 0) {
      console.log('   No more chunks to process')
      break
    }

    for (const chunk of chunks) {
      try {
        const embStart = Date.now()
        const embedding = await generateLocalEmbedding(chunk.content)
        const embTime = Date.now() - embStart
        embeddingTimes.push(embTime)

        if (!isDryRun) {
          await updateChunkEmbedding(chunk.id, embedding)
        }

        processed++

        // Progress update every 10 chunks
        if (processed % 10 === 0 || processed === toProcess) {
          const elapsed = (Date.now() - startTime) / 1000
          const rate = processed / elapsed
          const remaining = toProcess - processed
          const eta = remaining / rate

          process.stdout.write(`\r   Progress: ${processed}/${toProcess} (${(processed/toProcess*100).toFixed(1)}%) | ` +
            `Rate: ${rate.toFixed(1)} chunks/s | ` +
            `ETA: ${eta.toFixed(0)}s`)
        }
      } catch (error) {
        console.error(`\n   ❌ Failed to process chunk ${chunk.id}:`, error)
        failed++
      }
    }
  }

  console.log('\n')
  console.log('─'.repeat(70))

  // Summary
  const totalTime = (Date.now() - startTime) / 1000
  const avgEmbTime = embeddingTimes.length > 0
    ? embeddingTimes.reduce((a, b) => a + b, 0) / embeddingTimes.length
    : 0

  console.log('')
  console.log('═'.repeat(70))
  console.log('📊 SUMMARY')
  console.log('═'.repeat(70))
  console.log(`   Total processed:    ${processed}`)
  console.log(`   Failed:             ${failed}`)
  console.log(`   Success rate:       ${((processed - failed) / processed * 100).toFixed(1)}%`)
  console.log(`   Total time:         ${totalTime.toFixed(1)}s`)
  console.log(`   Avg embedding time: ${avgEmbTime.toFixed(1)}ms`)
  console.log(`   Processing rate:    ${(processed / totalTime).toFixed(1)} chunks/s`)
  console.log('')

  if (isDryRun) {
    console.log('🔍 DRY RUN complete - no changes were made')
    console.log('   Run without --dry-run to apply changes')
  } else {
    console.log('✅ Re-embedding complete!')

    // Verify
    const remaining = await getTotalChunksWithoutEmbedding()
    console.log(`   Remaining without local embedding: ${remaining}`)
  }
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
