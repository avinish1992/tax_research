/**
 * Test script for HuggingFace Inference API embeddings
 * Run with: npx ts-node --esm scripts/test-hf-embeddings.ts
 */

import { InferenceClient } from '@huggingface/inference'

const HF_MODEL = 'sentence-transformers/all-MiniLM-L6-v2'

async function testHuggingFaceEmbedding() {
  const apiKey = process.env.HUGGINGFACE_API_KEY
  if (!apiKey) {
    console.error('❌ HUGGINGFACE_API_KEY not found in environment')
    process.exit(1)
  }

  console.log('🤗 Testing HuggingFace Inference API...')
  console.log(`   Model: ${HF_MODEL}`)
  console.log(`   API Key: ${apiKey.substring(0, 10)}...`)

  const client = new InferenceClient(apiKey)

  const testTexts = [
    'What is the corporate tax rate in UAE?',
    'Article 50 General Anti-Abuse Rule',
    'Transfer pricing documentation requirements'
  ]

  for (const text of testTexts) {
    console.log(`\n📝 Testing: "${text.substring(0, 50)}..."`)
    const startTime = Date.now()

    try {
      const output = await client.featureExtraction({
        model: HF_MODEL,
        inputs: text,
        provider: 'hf-inference',
      })

      let embedding: number[]
      if (Array.isArray(output) && Array.isArray(output[0])) {
        embedding = output[0] as number[]
      } else if (Array.isArray(output)) {
        embedding = output as number[]
      } else {
        throw new Error('Invalid embedding response')
      }

      const duration = Date.now() - startTime
      console.log(`   ✅ Success: ${embedding.length} dimensions, ${duration}ms`)
      console.log(`   First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`)
    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message}`)
      if (error.message?.includes('loading') || error.message?.includes('503')) {
        console.log('   ⏳ Model loading, retrying in 2s...')
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    }
  }

  console.log('\n✅ HuggingFace embedding test complete!')
}

testHuggingFaceEmbedding().catch(console.error)
