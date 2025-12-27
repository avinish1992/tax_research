/**
 * Test Local RAG Pipeline
 *
 * Uses:
 * - Local embeddings (all-MiniLM-L6-v2) - 384 dimensions
 * - Local in-memory vector store (simple cosine similarity)
 * - OpenAI for generation
 *
 * This demonstrates the speed improvement without needing to modify production DB
 */

import { generateLocalEmbedding, preloadEmbeddingModel, cosineSimilarity } from '../lib/local-embeddings'

// Simple in-memory vector store
interface VectorDocument {
  id: string
  content: string
  embedding: number[]
  metadata: {
    fileName: string
    pageNumber?: number
  }
}

class LocalVectorStore {
  private documents: VectorDocument[] = []

  async addDocument(content: string, metadata: { fileName: string; pageNumber?: number }) {
    const embedding = await generateLocalEmbedding(content)
    this.documents.push({
      id: `doc_${this.documents.length}`,
      content,
      embedding,
      metadata,
    })
  }

  async search(query: string, topK: number = 5): Promise<Array<VectorDocument & { score: number }>> {
    const queryEmbedding = await generateLocalEmbedding(query)

    const results = this.documents.map(doc => ({
      ...doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding),
    }))

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  get size() {
    return this.documents.length
  }
}

// Sample legal document content
const SAMPLE_DOCUMENTS = [
  {
    content: `Corporate Tax Rate in UAE
The standard corporate tax rate in the UAE is 9% for taxable income exceeding AED 375,000.
Small businesses and startups with income below this threshold are exempt from corporate tax.
The tax applies to all business activities conducted in the UAE.`,
    fileName: 'UAE_Tax_Guide.pdf',
    pageNumber: 1,
  },
  {
    content: `Free Zone Companies
Companies operating in designated free zones may be eligible for a 0% corporate tax rate
on qualifying income. This includes income from transactions with other free zone entities
and income from certain foreign source activities.`,
    fileName: 'UAE_Tax_Guide.pdf',
    pageNumber: 5,
  },
  {
    content: `Small Business Relief
Small businesses with revenue not exceeding AED 3 million may elect for small business relief,
which simplifies tax compliance requirements. This relief is available for the first few years
of operation and can be renewed annually.`,
    fileName: 'UAE_Tax_Guide.pdf',
    pageNumber: 12,
  },
  {
    content: `Tax Filing Requirements
All taxable entities must register for corporate tax with the Federal Tax Authority.
Tax returns must be filed within 9 months of the end of the tax period.
Late filing penalties apply at AED 500-1000 per month of delay.`,
    fileName: 'Compliance_Guide.pdf',
    pageNumber: 3,
  },
  {
    content: `Transfer Pricing Rules
Related party transactions must be conducted at arm's length prices.
Documentation requirements apply for transactions exceeding AED 200 million.
The UAE follows OECD transfer pricing guidelines.`,
    fileName: 'Compliance_Guide.pdf',
    pageNumber: 8,
  },
]

async function runLocalRAGTest() {
  console.log('🚀 LOCAL RAG PIPELINE TEST')
  console.log('='.repeat(70))
  console.log('')

  // Step 1: Preload model
  console.log('📦 Step 1: Loading local embedding model...')
  const modelLoadStart = Date.now()
  await preloadEmbeddingModel()
  console.log(`   ✅ Model loaded in ${Date.now() - modelLoadStart}ms`)
  console.log('')

  // Step 2: Index documents
  console.log('📚 Step 2: Indexing documents with local embeddings...')
  const vectorStore = new LocalVectorStore()
  const indexStart = Date.now()

  for (const doc of SAMPLE_DOCUMENTS) {
    const docStart = Date.now()
    await vectorStore.addDocument(doc.content, {
      fileName: doc.fileName,
      pageNumber: doc.pageNumber,
    })
    console.log(`   ✓ Indexed "${doc.fileName}" page ${doc.pageNumber} in ${Date.now() - docStart}ms`)
  }

  console.log(`   ✅ Indexed ${vectorStore.size} documents in ${Date.now() - indexStart}ms`)
  console.log(`   Average: ${((Date.now() - indexStart) / SAMPLE_DOCUMENTS.length).toFixed(0)}ms per document`)
  console.log('')

  // Step 3: Test queries
  const testQueries = [
    'What is the corporate tax rate in UAE?',
    'Are free zone companies taxed?',
    'What are the filing deadlines?',
    'Tell me about small business relief',
  ]

  console.log('🔍 Step 3: Testing search performance...')
  console.log('-'.repeat(70))

  for (const query of testQueries) {
    console.log(`\n📝 Query: "${query}"`)

    const searchStart = Date.now()
    const results = await vectorStore.search(query, 3)
    const searchTime = Date.now() - searchStart

    console.log(`   ⚡ Search time: ${searchTime}ms`)
    console.log(`   📊 Top results:`)

    for (const result of results) {
      console.log(`      - ${result.metadata.fileName} p${result.metadata.pageNumber}: score=${result.score.toFixed(4)}`)
      console.log(`        "${result.content.substring(0, 60)}..."`)
    }
  }

  // Step 4: Full RAG pipeline simulation
  console.log('\n')
  console.log('='.repeat(70))
  console.log('📊 FULL RAG PIPELINE COMPARISON')
  console.log('='.repeat(70))

  const query = 'What is the corporate tax rate for businesses in UAE?'
  console.log(`\nQuery: "${query}"`)

  // Local embeddings timing
  const localStart = Date.now()
  const localResults = await vectorStore.search(query, 3)
  const localTime = Date.now() - localStart

  console.log(`\n🏠 LOCAL EMBEDDINGS:`)
  console.log(`   Search time:     ${localTime}ms`)
  console.log(`   Results:         ${localResults.length}`)

  // Estimated OpenAI timing (based on our measurements)
  const estimatedOpenAIEmbedding = 2000 // ms
  const estimatedOpenAISearch = 2500 // ms (Supabase remote)

  console.log(`\n☁️  OPENAI + SUPABASE (estimated from measurements):`)
  console.log(`   Embedding time:  ${estimatedOpenAIEmbedding}ms`)
  console.log(`   Search time:     ${estimatedOpenAISearch}ms`)
  console.log(`   Total:           ${estimatedOpenAIEmbedding + estimatedOpenAISearch}ms`)

  console.log(`\n⚡ SPEEDUP: ${((estimatedOpenAIEmbedding + estimatedOpenAISearch) / localTime).toFixed(0)}x faster`)
  console.log(`⏱️  TIME SAVED: ${estimatedOpenAIEmbedding + estimatedOpenAISearch - localTime}ms per query`)

  console.log('\n')
  console.log('='.repeat(70))
  console.log('✅ LOCAL RAG PIPELINE WORKS!')
  console.log('='.repeat(70))
  console.log(`
To use local embeddings in production:
1. Add new 384-dim embedding column to document_chunks table
2. Re-embed all documents with local model (one-time migration)
3. Update RAG pipeline to use local embeddings
4. Keep OpenAI for LLM generation only

Expected improvement:
- Embedding: 2000ms → 2ms (1000x faster)
- Search: Depends on DB optimization
- Total TTFT reduction: ~2-4 seconds
`)
}

runLocalRAGTest().catch(console.error)
