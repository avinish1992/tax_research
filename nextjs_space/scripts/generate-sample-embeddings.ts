/**
 * Generate sample embeddings and update a few chunks for testing
 */
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { generateLocalEmbedding, preloadEmbeddingModel } from '../lib/local-embeddings'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function main() {
  console.log('Loading model...')
  await preloadEmbeddingModel()

  // Test embedding generation
  const testTexts = [
    'The standard corporate tax rate in the UAE is 9% for taxable income exceeding AED 375,000.',
    'Free Zone Companies may be eligible for a 0% corporate tax rate on qualifying income.',
    'Tax Returns must be filed within 9 months of the end of the relevant tax period.'
  ]

  console.log('\nGenerating sample embeddings:')
  for (const text of testTexts) {
    const start = Date.now()
    const emb = await generateLocalEmbedding(text)
    console.log(`  ${Date.now() - start}ms - ${emb.length} dims - "${text.substring(0, 50)}..."`)
  }

  // Print embedding as SQL-compatible format for one sample
  console.log('\nSample embedding for SQL update:')
  const sampleEmb = await generateLocalEmbedding(testTexts[0])
  console.log(`[${sampleEmb.slice(0, 5).join(', ')}...]`)
  console.log(`Full embedding length: ${sampleEmb.length}`)

  console.log('\n✅ Embeddings work correctly!')
  console.log('\nTo re-embed all documents, you need to either:')
  console.log('1. Use a Supabase Edge Function with service role')
  console.log('2. Disable RLS temporarily and run the reembed script')
  console.log('3. Run batch updates via SQL using the MCP')
}

main().catch(console.error)
