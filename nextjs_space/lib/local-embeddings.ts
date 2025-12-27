/**
 * Local Embeddings using Hugging Face Transformers.js
 *
 * Uses all-MiniLM-L6-v2 model which runs locally in Node.js
 * - Dimensions: 384 (vs OpenAI's 1536)
 * - Speed: ~50-100ms per embedding (vs ~1500-2000ms for OpenAI API)
 * - Quality: Very good for semantic similarity tasks
 */

import { pipeline, env } from '@xenova/transformers'

// Configure transformers.js for server-side usage
env.useBrowserCache = false
env.allowLocalModels = true

// Set cache directory for serverless environments (Netlify, Vercel, etc.)
if (process.env.TRANSFORMERS_CACHE) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE
} else if (process.env.NODE_ENV === 'production') {
  // Use /tmp for serverless functions
  env.cacheDir = '/tmp/transformers-cache'
}

// Model configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2'
const EMBEDDING_DIMENSIONS = 384

// Singleton pipeline instance
let embeddingPipeline: any = null
let pipelinePromise: Promise<any> | null = null

/**
 * Initialize the embedding pipeline (lazy loading)
 */
async function getEmbeddingPipeline() {
  if (embeddingPipeline) {
    return embeddingPipeline
  }

  if (pipelinePromise) {
    return pipelinePromise
  }

  console.log(`🔄 Loading local embedding model: ${MODEL_NAME}...`)
  const startTime = Date.now()

  pipelinePromise = pipeline('feature-extraction', MODEL_NAME, {
    quantized: true, // Use quantized model for faster inference
  })

  embeddingPipeline = await pipelinePromise
  console.log(`✅ Model loaded in ${Date.now() - startTime}ms`)

  return embeddingPipeline
}

/**
 * Generate embedding for a single text using local model
 */
export async function generateLocalEmbedding(text: string): Promise<number[]> {
  const startTime = Date.now()

  try {
    const extractor = await getEmbeddingPipeline()

    // Generate embedding
    const output = await extractor(text, {
      pooling: 'mean',
      normalize: true,
    })

    // Convert to regular array
    const embedding = Array.from(output.data) as number[]

    console.log(`✓ Local embedding generated in ${Date.now() - startTime}ms (${embedding.length} dims)`)

    return embedding
  } catch (error) {
    console.error('❌ Local embedding error:', error)
    throw error
  }
}

/**
 * Generate embeddings for multiple texts (batched)
 */
export async function generateLocalEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const startTime = Date.now()

  try {
    const extractor = await getEmbeddingPipeline()

    const embeddings: number[][] = []

    // Process in batches of 10 for memory efficiency
    const batchSize = 10
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize)

      for (const text of batch) {
        const output = await extractor(text, {
          pooling: 'mean',
          normalize: true,
        })
        embeddings.push(Array.from(output.data) as number[])
      }
    }

    console.log(`✓ Generated ${embeddings.length} local embeddings in ${Date.now() - startTime}ms`)

    return embeddings
  } catch (error) {
    console.error('❌ Batch embedding error:', error)
    throw error
  }
}

/**
 * Get the embedding dimensions for the local model
 */
export function getLocalEmbeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS
}

/**
 * Preload the model (call on app startup for faster first request)
 */
export async function preloadEmbeddingModel(): Promise<void> {
  await getEmbeddingPipeline()
}

/**
 * Compare similarity between two embeddings (cosine similarity)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimensions')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}
