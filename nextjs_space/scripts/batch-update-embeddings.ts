/**
 * Batch update embeddings via MCP SQL
 * Generates embeddings locally and outputs SQL UPDATE statements
 */
import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { generateLocalEmbedding, preloadEmbeddingModel } from '../lib/local-embeddings'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  console.log('Loading model...')
  await preloadEmbeddingModel()

  // Hardcoded chunks from the database query (to bypass RLS)
  const chunks = [
    { id: '897fd9f5-e7b1-4f0d-9fb2-3ff0598dc9f7', content: 'Cabinet Decision No. (75) of 2023 On the Administrative Penalties for Violations Related to the Application of Federal Decree-Law No. (47) of 2022 on the Taxation of Corporations and Businesses' },
    { id: '69372b91-ea2e-4379-89e9-23efc14a1021', content: 'Pursuant to what was presented by the Minister of Finance and approved by the Cabinet, Has decided: Article (1) Definitions in Federal Decree-Law No. (28) of 2022 on Tax Procedures' },
    { id: 'd2ba6ec9-fc5c-4bf4-bc1a-1124e6af2265', content: 'Article (2) Scope of Application Notwithstanding the provisions of Cabinet Decision No. (40) of 2017 referred to above, the Administrative Penalties included in the table annexed to this Decision shall apply to violations related to the application of the Corporate Tax Law.' },
    { id: '89bd2445-4c08-4235-92df-67a96224568d', content: 'Table of Violations and Administrative Penalties Annexed to Cabinet Decision No. (75) of 2023 on Violations Related to the Application of Federal Decree-Law No. (47) of 2022 on the Taxation of Corporations and Businesses' },
    { id: '23e2da16-25e8-4764-baaf-e6f1cc9f36d5', content: 'Failure of the Legal Representative to file a Tax Return within the specified timeframes, in which case the penalties will be due from the Legal Representatives own funds. 500 for each month for the first twelve months. 1,000 for each month from the thirteenth month onwards.' },
    { id: '7cbad7d4-bd79-4ddc-ac1c-323322b7fe7e', content: 'Failure of the Taxable Person to settle the Payable Tax. A monthly penalty of 14% per annum, for each month or part thereof, on the unsettled Payable Tax amount from the day following the due date of payment.' },
    { id: '2efd9695-3ad5-4896-8a0b-231feb519539', content: 'Federal Decree-Law No. 60 of 2023 Amending Certain Provisions of the Federal Decree-Law No. 47 of 2022 on the Taxation of Corporations and Businesses' },
    { id: 'bda0eed6-7942-4395-85a5-164016fb828f', content: 'Top-up Tax: The top-up tax imposed on Multinational Enterprises in accordance with this Decree-Law for the purposes of the pillar two rules issued by the Organization for Economic Cooperation and Development. Multinational Enterprise: An entity located in the State or in a foreign jurisdiction.' },
    { id: '9ebd2999-700e-4137-aea8-c3c841009af6', content: 'The Minister shall issue a decision regulating all cases, provisions, conditions, rules, controls, and procedures for imposing the Top-up Tax on Multinational Enterprises so that the total percentage of the effective tax imposed on them is 15% fifteen percent.' },
    { id: 'b9ae233c-9c0a-421a-906a-bbf13e43f749', content: 'Free Zone Persons Corporate Tax Guide CTGFZP1 May 2024' },
    { id: '96fc24e5-bcc7-4e9c-9610-8314ffc87136', content: 'Corporate Tax Guide Free Zone Persons Contents Glossary Introduction Overview Purpose of this guide' },
  ]

  console.log(`\nGenerating embeddings for ${chunks.length} chunks...`)

  const updates: string[] = []

  for (const chunk of chunks) {
    const embedding = await generateLocalEmbedding(chunk.content)
    const embeddingStr = `'[${embedding.join(',')}]'`
    updates.push(`UPDATE document_chunks SET embedding_local = ${embeddingStr}::vector WHERE id = '${chunk.id}';`)
  }

  console.log('\n-- SQL UPDATE statements:')
  console.log(updates.join('\n'))
  console.log(`\n-- Total: ${updates.length} updates`)
}

main().catch(console.error)
