/**
 * Generate embeddings for chunks passed via stdin (JSON array)
 * Outputs SQL UPDATE statements
 *
 * Usage: echo '[{"id":"...", "content":"..."}]' | npx tsx scripts/embed-chunks.ts
 */
import { generateLocalEmbedding, preloadEmbeddingModel } from '../lib/local-embeddings'

async function main() {
  // Read JSON from stdin
  const input = await new Promise<string>((resolve) => {
    let data = ''
    process.stdin.on('data', chunk => data += chunk)
    process.stdin.on('end', () => resolve(data))
  })

  const chunks: Array<{id: string, content: string}> = JSON.parse(input)

  console.error(`Loading model and processing ${chunks.length} chunks...`)
  await preloadEmbeddingModel()

  for (const chunk of chunks) {
    try {
      const embedding = await generateLocalEmbedding(chunk.content)
      const embeddingStr = `[${embedding.join(',')}]`
      console.log(`UPDATE document_chunks SET embedding_local = '${embeddingStr}'::vector WHERE id = '${chunk.id}';`)
    } catch (err) {
      console.error(`Error processing ${chunk.id}:`, err)
    }
  }

  console.error('Done!')
}

main().catch(console.error)
