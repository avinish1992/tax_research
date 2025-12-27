/**
 * Batch process all chunks that need local embeddings
 * Generates embeddings locally and outputs SQL UPDATE statements
 * Run with: npx tsx scripts/batch-embed-all.ts > /tmp/updates.sql
 * Then execute the SQL file via Supabase MCP
 */
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { generateLocalEmbedding, preloadEmbeddingModel } from '../lib/local-embeddings'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

const BATCH_SIZE = 100
const MAX_CHUNKS = 10000  // Safety limit

async function main() {
  console.error('Loading embedding model...')
  await preloadEmbeddingModel()
  console.error('Model loaded!')

  let offset = 0
  let totalProcessed = 0
  let hasMore = true

  // Output SQL header
  console.log('-- Auto-generated SQL for batch embedding updates')
  console.log('-- Generated at:', new Date().toISOString())
  console.log('')

  while (hasMore && totalProcessed < MAX_CHUNKS) {
    console.error(`Fetching chunks ${offset} to ${offset + BATCH_SIZE}...`)

    // Fetch chunks that need embeddings - use admin/service role to bypass RLS
    const { data: chunks, error } = await supabase
      .from('document_chunks')
      .select('id, content')
      .is('embedding_local', null)
      .range(offset, offset + BATCH_SIZE - 1)
      .order('id')

    if (error) {
      console.error('Error fetching chunks:', error)
      break
    }

    if (!chunks || chunks.length === 0) {
      hasMore = false
      break
    }

    console.error(`Processing ${chunks.length} chunks...`)

    for (const chunk of chunks) {
      try {
        // Generate embedding
        const embedding = await generateLocalEmbedding(chunk.content)

        // Output SQL UPDATE statement
        const embeddingStr = `[${embedding.join(',')}]`
        console.log(`UPDATE document_chunks SET embedding_local = '${embeddingStr}'::vector WHERE id = '${chunk.id}';`)

        totalProcessed++

        if (totalProcessed % 100 === 0) {
          console.error(`Progress: ${totalProcessed} chunks processed`)
        }
      } catch (err) {
        console.error(`Error processing chunk ${chunk.id}:`, err)
      }
    }

    offset += BATCH_SIZE

    // Small delay to prevent overwhelming
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log('')
  console.log(`-- Total: ${totalProcessed} UPDATE statements`)
  console.error(`\nDone! Generated ${totalProcessed} UPDATE statements`)
  console.error('Run the SQL output through Supabase MCP to apply updates')
}

main().catch(console.error)
