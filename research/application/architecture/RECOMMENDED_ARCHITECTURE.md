# Recommended Architecture for Legal AI Assistant

## Executive Summary

This document outlines the recommended architecture for scaling the Legal AI Assistant from its current MVP state to a production-ready, feature-rich platform.

---

## Current State Analysis

### Existing Stack
```
Frontend:     Next.js 14 (App Router)
Auth:         NextAuth.js (Google OAuth + Credentials)
Database:     PostgreSQL (Abacus.AI hosted)
Vector:       JSON embeddings in PostgreSQL (no pgvector index)
Storage:      AWS S3
RAG:          Custom TF-IDF + Abacus.AI embeddings
LLM:          Abacus.AI API
```

### Current Strengths
- Full-stack TypeScript consistency
- Modern embeddings (1536D via Abacus.AI)
- Hybrid search (semantic + keyword with RRF)
- Page-level document tracking
- Query expansion for legal terms

### Current Limitations
- No pgvector indexing (O(n) search)
- Limited memory (conversation only)
- No workflow automation
- Manual document processing
- Single LLM provider

---

## Recommended Target Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                   │
│                     Next.js 14 (App Router)                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│  │   Chat UI   │ │  Documents  │ │  Analytics  │ │   Settings  │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        API LAYER                                     │
│                   Next.js API Routes                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │
│  │    Chat     │ │  Documents  │ │    Auth     │ │   Memory    │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌───────────────────────┐ ┌───────────────┐ ┌───────────────────────┐
│      SUPABASE         │ │    QDRANT     │ │      LLM LAYER        │
│  ┌─────────────────┐  │ │ ┌───────────┐ │ │  ┌─────────────────┐  │
│  │   PostgreSQL    │  │ │ │  Vector   │ │ │  │  Claude 3.5     │  │
│  │   (Relational)  │  │ │ │  Search   │ │ │  │  Sonnet (Main)  │  │
│  └─────────────────┘  │ │ └───────────┘ │ │  └─────────────────┘  │
│  ┌─────────────────┐  │ └───────────────┘ │  ┌─────────────────┐  │
│  │      Auth       │  │                   │  │  GPT-4o-mini    │  │
│  │   (Users/RLS)   │  │                   │  │  (Fast tasks)   │  │
│  └─────────────────┘  │                   │  └─────────────────┘  │
│  ┌─────────────────┐  │                   └───────────────────────┘
│  │    Storage      │  │
│  │    (Files)      │  │
│  └─────────────────┘  │
│  ┌─────────────────┐  │
│  │   Real-time     │  │
│  │  (Subscriptions)│  │
│  └─────────────────┘  │
└───────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     RAG + MEMORY LAYER                               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    LlamaIndex                                 │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐    │   │
│  │  │ Ingestion │ │  Indexing │ │ Retrieval │ │  Synthesis│    │   │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  Memory System                                │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐    │   │
│  │  │Short-Term │ │ Episodic  │ │ Semantic  │ │ Temporal  │    │   │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    AUTOMATION LAYER                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                        n8n                                    │   │
│  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐      │   │
│  │  │Doc Processing │ │Scheduled Tasks│ │ Integrations  │      │   │
│  │  └───────────────┘ └───────────────┘ └───────────────┘      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     Composio                                  │   │
│  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐      │   │
│  │  │  CRM Tools    │ │  Email/Slack  │ │  Cloud Storage│      │   │
│  │  └───────────────┘ └───────────────┘ └───────────────┘      │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

**Goal:** Migrate to Supabase, improve vector search

#### 1.1 Supabase Migration
```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'

export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Server-side with service role
export const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
```

#### 1.2 Auth Migration (NextAuth → Supabase)
```typescript
// app/providers.tsx
'use client'
import { SessionContextProvider } from '@supabase/auth-helpers-react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

export function Providers({ children }) {
  const supabase = createClientComponentClient()

  return (
    <SessionContextProvider supabaseClient={supabase}>
      {children}
    </SessionContextProvider>
  )
}
```

#### 1.3 Vector Search with pgvector
```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Create optimized document chunks table
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    content TEXT NOT NULL,
    page_number INTEGER,
    chunk_index INTEGER,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create HNSW index for fast search
CREATE INDEX ON document_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- RLS for user isolation
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own chunks"
ON document_chunks FOR ALL
USING (auth.uid() = user_id);
```

#### 1.4 Storage Migration (S3 → Supabase Storage)
```typescript
// lib/storage.ts
import { supabaseAdmin } from './supabase'

export async function uploadDocument(
  userId: string,
  file: File
): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}-${file.name}`

  const { data, error } = await supabaseAdmin.storage
    .from('documents')
    .upload(path, file, {
      contentType: file.type,
      upsert: false
    })

  if (error) throw error
  return data.path
}

export async function getDocumentUrl(path: string): Promise<string> {
  const { data } = await supabaseAdmin.storage
    .from('documents')
    .createSignedUrl(path, 3600) // 1 hour expiry

  return data?.signedUrl || ''
}
```

### Phase 2: RAG Enhancement (Weeks 3-4)

**Goal:** Implement LlamaIndex for better retrieval

#### 2.1 LlamaIndex Integration
```typescript
// lib/llamaindex/index.ts
import {
  VectorStoreIndex,
  SimpleDirectoryReader,
  storageContextFromDefaults,
  SupabaseVectorStore
} from 'llamaindex'

export async function createIndex(userId: string) {
  const vectorStore = new SupabaseVectorStore({
    client: supabaseAdmin,
    tableName: 'document_chunks',
    queryName: 'match_documents',
    filter: { user_id: userId }
  })

  const storageContext = await storageContextFromDefaults({
    vectorStore
  })

  return VectorStoreIndex.fromDocuments([], { storageContext })
}

export async function queryDocuments(
  userId: string,
  query: string,
  topK: number = 10
) {
  const index = await createIndex(userId)
  const queryEngine = index.asQueryEngine({
    similarityTopK: topK,
    responseSynthesizer: /* custom synthesizer */
  })

  return queryEngine.query(query)
}
```

#### 2.2 Advanced Chunking
```typescript
// lib/llamaindex/chunking.ts
import {
  SentenceSplitter,
  SemanticSplitterNodeParser
} from 'llamaindex'

export function createChunker(strategy: 'sentence' | 'semantic') {
  if (strategy === 'semantic') {
    return new SemanticSplitterNodeParser({
      embedModel: embeddingModel,
      breakpointPercentileThreshold: 95
    })
  }

  return new SentenceSplitter({
    chunkSize: 1024,
    chunkOverlap: 128
  })
}
```

### Phase 3: Memory System (Weeks 5-6)

**Goal:** Implement multi-type memory

#### 3.1 Memory Tables
```sql
-- Conversation sessions
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    title TEXT,
    summary TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

-- Messages with embeddings for recall
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    embedding vector(1536),
    sources JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Episodic memory
CREATE TABLE episodic_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    context JSONB,
    outcome TEXT,
    embedding vector(1536),
    importance FLOAT DEFAULT 0.5,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User knowledge (semantic memory per user)
CREATE TABLE user_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    category TEXT NOT NULL,
    fact TEXT NOT NULL,
    source TEXT,
    confidence FLOAT DEFAULT 1.0,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3.2 Memory Service
```typescript
// lib/memory/service.ts
import { SupabaseClient } from '@supabase/supabase-js'

export class MemoryService {
  constructor(
    private supabase: SupabaseClient,
    private userId: string
  ) {}

  // Short-term: Get recent conversation context
  async getConversationContext(sessionId: string, limit: number = 10) {
    const { data } = await this.supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(limit)

    return data?.reverse() || []
  }

  // Episodic: Recall similar past interactions
  async recallSimilarEpisodes(embedding: number[], limit: number = 5) {
    const { data } = await this.supabase.rpc('match_episodic_memories', {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: limit,
      p_user_id: this.userId
    })

    return data || []
  }

  // Semantic: Query user-specific knowledge
  async queryUserKnowledge(embedding: number[], category?: string) {
    const { data } = await this.supabase.rpc('match_user_knowledge', {
      query_embedding: embedding,
      p_user_id: this.userId,
      p_category: category
    })

    return data || []
  }

  // Store new episode
  async storeEpisode(episode: {
    eventType: string
    summary: string
    context: object
    outcome?: string
    embedding: number[]
  }) {
    const { data, error } = await this.supabase
      .from('episodic_memories')
      .insert({
        user_id: this.userId,
        event_type: episode.eventType,
        summary: episode.summary,
        context: episode.context,
        outcome: episode.outcome,
        embedding: episode.embedding,
        importance: this.calculateImportance(episode)
      })
      .select()
      .single()

    return data
  }

  private calculateImportance(episode: any): number {
    // Importance scoring based on event type, length, etc.
    let score = 0.5

    if (episode.outcome) score += 0.1
    if (episode.eventType === 'contract_analysis') score += 0.2
    if (episode.eventType === 'compliance_check') score += 0.2

    return Math.min(score, 1.0)
  }
}
```

### Phase 4: Qdrant Integration (Weeks 7-8)

**Goal:** Dedicated vector DB for scale

#### 4.1 Qdrant Setup
```typescript
// lib/qdrant/client.ts
import { QdrantClient } from '@qdrant/js-client-rest'

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY
})

// Create collections
export async function initializeCollections() {
  // Documents collection
  await qdrant.createCollection('legal_documents', {
    vectors: {
      size: 1536,
      distance: 'Cosine'
    },
    optimizers_config: {
      indexing_threshold: 20000
    },
    hnsw_config: {
      m: 16,
      ef_construct: 100
    }
  })

  // Create payload indexes for filtering
  await qdrant.createPayloadIndex('legal_documents', {
    field_name: 'user_id',
    field_schema: 'keyword'
  })

  await qdrant.createPayloadIndex('legal_documents', {
    field_name: 'document_type',
    field_schema: 'keyword'
  })
}
```

#### 4.2 Hybrid Search with Qdrant
```typescript
// lib/qdrant/search.ts
import { qdrant } from './client'

export async function hybridSearch(
  userId: string,
  queryEmbedding: number[],
  queryText: string,
  options: {
    topK?: number
    documentTypes?: string[]
    dateRange?: { start: Date; end: Date }
  } = {}
) {
  const { topK = 10, documentTypes, dateRange } = options

  // Build filter
  const filter: any = {
    must: [
      { key: 'user_id', match: { value: userId } }
    ]
  }

  if (documentTypes?.length) {
    filter.must.push({
      key: 'document_type',
      match: { any: documentTypes }
    })
  }

  if (dateRange) {
    filter.must.push({
      key: 'created_at',
      range: {
        gte: dateRange.start.toISOString(),
        lte: dateRange.end.toISOString()
      }
    })
  }

  // Semantic search
  const semanticResults = await qdrant.search('legal_documents', {
    vector: queryEmbedding,
    filter,
    limit: topK,
    with_payload: true
  })

  // Full-text search (if using Qdrant's full-text)
  const keywordResults = await qdrant.search('legal_documents', {
    vector: queryEmbedding,
    filter: {
      ...filter,
      must: [
        ...filter.must,
        { key: 'content', match: { text: queryText } }
      ]
    },
    limit: topK,
    with_payload: true
  })

  // RRF fusion
  return reciprocalRankFusion([semanticResults, keywordResults], topK)
}

function reciprocalRankFusion(
  resultSets: any[][],
  k: number,
  constant: number = 60
): any[] {
  const scores = new Map<string, { score: number; item: any }>()

  resultSets.forEach(results => {
    results.forEach((result, rank) => {
      const id = result.id
      const rrf = 1 / (constant + rank + 1)

      if (scores.has(id)) {
        scores.get(id)!.score += rrf
      } else {
        scores.set(id, { score: rrf, item: result })
      }
    })
  })

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => s.item)
}
```

### Phase 5: Automation (Weeks 9-10)

**Goal:** n8n workflows for background processing

#### 5.1 n8n Workflow: Document Ingestion
```json
{
  "name": "Document Ingestion Pipeline",
  "nodes": [
    {
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "httpMethod": "POST",
        "path": "document-upload",
        "authentication": "headerAuth"
      }
    },
    {
      "name": "Download Document",
      "type": "n8n-nodes-base.httpRequest",
      "parameters": {
        "url": "={{ $json.document_url }}",
        "responseFormat": "file"
      }
    },
    {
      "name": "Extract Text",
      "type": "n8n-nodes-base.extractFromFile",
      "parameters": {
        "operation": "pdf"
      }
    },
    {
      "name": "Chunk Text",
      "type": "@n8n/n8n-nodes-langchain.textSplitter",
      "parameters": {
        "chunkSize": 1024,
        "chunkOverlap": 128
      }
    },
    {
      "name": "Generate Embeddings",
      "type": "@n8n/n8n-nodes-langchain.embeddingsOpenAi",
      "parameters": {
        "model": "text-embedding-3-small"
      }
    },
    {
      "name": "Store in Qdrant",
      "type": "@n8n/n8n-nodes-langchain.vectorStoreQdrant",
      "parameters": {
        "operation": "insert",
        "collection": "legal_documents"
      }
    },
    {
      "name": "Update Supabase",
      "type": "n8n-nodes-base.supabase",
      "parameters": {
        "operation": "update",
        "table": "documents",
        "filters": {
          "id": "={{ $json.document_id }}"
        },
        "data": {
          "status": "processed",
          "chunk_count": "={{ $json.chunk_count }}"
        }
      }
    }
  ]
}
```

#### 5.2 n8n Workflow: Session Summarization
```json
{
  "name": "Session Summary Generator",
  "nodes": [
    {
      "name": "Schedule Trigger",
      "type": "n8n-nodes-base.scheduleTrigger",
      "parameters": {
        "rule": {
          "interval": [{ "field": "hours", "hoursInterval": 1 }]
        }
      }
    },
    {
      "name": "Get Ended Sessions",
      "type": "n8n-nodes-base.supabase",
      "parameters": {
        "operation": "getAll",
        "table": "chat_sessions",
        "filters": {
          "ended_at": { "is": "not null" },
          "summary": { "is": "null" }
        }
      }
    },
    {
      "name": "Get Messages",
      "type": "n8n-nodes-base.supabase",
      "parameters": {
        "operation": "getAll",
        "table": "messages",
        "filters": {
          "session_id": "={{ $json.id }}"
        }
      }
    },
    {
      "name": "Generate Summary",
      "type": "@n8n/n8n-nodes-langchain.openAi",
      "parameters": {
        "model": "gpt-4o-mini",
        "prompt": "Summarize this conversation in 2-3 sentences:\n\n{{ $json.messages }}"
      }
    },
    {
      "name": "Update Session",
      "type": "n8n-nodes-base.supabase",
      "parameters": {
        "operation": "update",
        "table": "chat_sessions",
        "data": {
          "summary": "={{ $json.summary }}"
        }
      }
    }
  ]
}
```

### Phase 6: Advanced Features (Weeks 11-12)

**Goal:** Agent capabilities and integrations

#### 6.1 LangGraph Agent
```typescript
// lib/agents/legal-agent.ts
import { StateGraph, END } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'

interface LegalAgentState {
  query: string
  queryType: 'contract' | 'compliance' | 'research' | 'general'
  documents: any[]
  analysis: string
  response: string
  needsHumanReview: boolean
}

const model = new ChatOpenAI({ model: 'gpt-4' })

// Nodes
async function classifyQuery(state: LegalAgentState) {
  const classification = await model.invoke(
    `Classify this legal query: "${state.query}"\n\nTypes: contract, compliance, research, general`
  )
  return { queryType: classification.content }
}

async function retrieveDocuments(state: LegalAgentState) {
  const docs = await hybridSearch(userId, queryEmbedding, state.query, {
    documentTypes: getRelevantTypes(state.queryType)
  })
  return { documents: docs }
}

async function analyzeContract(state: LegalAgentState) {
  // Contract-specific analysis
  const analysis = await model.invoke(
    `Analyze these contract excerpts for the query: ${state.query}\n\n${state.documents}`
  )
  return { analysis: analysis.content }
}

async function checkCompliance(state: LegalAgentState) {
  // Compliance-specific analysis
  const analysis = await model.invoke(
    `Check compliance based on these documents: ${state.documents}`
  )
  return { analysis: analysis.content }
}

async function generalResearch(state: LegalAgentState) {
  const analysis = await model.invoke(
    `Research answer for: ${state.query}\n\nContext: ${state.documents}`
  )
  return { analysis: analysis.content }
}

async function synthesizeResponse(state: LegalAgentState) {
  const response = await model.invoke(
    `Create a helpful response based on this analysis:\n${state.analysis}`
  )

  // Check if human review needed
  const needsReview = state.queryType === 'compliance' ||
    response.content.includes('consult a lawyer')

  return {
    response: response.content,
    needsHumanReview: needsReview
  }
}

// Router
function routeQuery(state: LegalAgentState) {
  switch (state.queryType) {
    case 'contract': return 'analyze_contract'
    case 'compliance': return 'check_compliance'
    default: return 'general_research'
  }
}

// Build graph
const workflow = new StateGraph<LegalAgentState>({
  channels: {
    query: null,
    queryType: null,
    documents: null,
    analysis: null,
    response: null,
    needsHumanReview: null
  }
})

workflow.addNode('classify', classifyQuery)
workflow.addNode('retrieve', retrieveDocuments)
workflow.addNode('analyze_contract', analyzeContract)
workflow.addNode('check_compliance', checkCompliance)
workflow.addNode('general_research', generalResearch)
workflow.addNode('synthesize', synthesizeResponse)

workflow.setEntryPoint('classify')
workflow.addEdge('classify', 'retrieve')
workflow.addConditionalEdges('retrieve', routeQuery)
workflow.addEdge('analyze_contract', 'synthesize')
workflow.addEdge('check_compliance', 'synthesize')
workflow.addEdge('general_research', 'synthesize')
workflow.addEdge('synthesize', END)

export const legalAgent = workflow.compile()
```

#### 6.2 Composio Integration
```typescript
// lib/integrations/composio.ts
import { ComposioToolSet, Action } from 'composio-langchain'

const toolset = new ComposioToolSet({
  apiKey: process.env.COMPOSIO_API_KEY
})

// Get tools for legal workflows
export async function getLegalTools() {
  return toolset.getTools({
    actions: [
      // Document storage
      Action.GOOGLEDRIVE_UPLOAD_FILE,
      Action.GOOGLEDRIVE_CREATE_FILE,
      Action.DROPBOX_UPLOAD_FILE,

      // Communication
      Action.GMAIL_SEND_EMAIL,
      Action.SLACK_SEND_MESSAGE,

      // Calendar
      Action.GOOGLE_CALENDAR_CREATE_EVENT,

      // CRM
      Action.HUBSPOT_CREATE_CONTACT,
      Action.SALESFORCE_CREATE_RECORD,

      // Notes
      Action.NOTION_CREATE_PAGE
    ]
  })
}

// Use in agent
export async function executeWithTools(query: string, tools: any[]) {
  const agent = createOpenAIToolsAgent(model, tools, prompt)
  const executor = AgentExecutor.fromAgentAndTools({ agent, tools })

  return executor.invoke({ input: query })
}
```

---

## Technology Stack Summary

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | Next.js 14 | React SSR/SSG |
| Auth | Supabase Auth | User management + RLS |
| Database | Supabase PostgreSQL | Relational data |
| Vector (Phase 1) | Supabase pgvector | Vector search |
| Vector (Scale) | Qdrant Cloud | Dedicated vector DB |
| Storage | Supabase Storage | File storage |
| Real-time | Supabase Realtime | Live updates |
| RAG | LlamaIndex | Retrieval + synthesis |
| Agents | LangGraph | Multi-step reasoning |
| Workflows | n8n | Automation |
| Integrations | Composio | External tools |
| LLM (Main) | Claude 3.5 Sonnet | Primary reasoning |
| LLM (Fast) | GPT-4o-mini | Quick tasks |
| Embeddings | text-embedding-3-small | 1536D vectors |
| Deploy | Vercel | Frontend hosting |

---

## Cost Estimates

### Monthly Costs (Scaled)

| Service | Tier | Est. Cost |
|---------|------|-----------|
| Supabase | Pro | $25/mo |
| Qdrant Cloud | Starter | $25/mo |
| Vercel | Pro | $20/mo |
| n8n Cloud | Starter | $20/mo |
| Claude API | ~100K tokens/day | $50/mo |
| OpenAI (embeddings) | ~1M tokens/day | $10/mo |
| **Total** | | **~$150/mo** |

### Self-Hosted Alternative
- VPS for n8n + Qdrant: $50/mo
- Total: ~$105/mo

---

## Migration Checklist

### Phase 1 Prerequisites
- [ ] Create Supabase project
- [ ] Set up auth providers (Google OAuth)
- [ ] Create database schema
- [ ] Migrate environment variables
- [ ] Update NextAuth to Supabase Auth

### Phase 2 Prerequisites
- [ ] Install LlamaIndex packages
- [ ] Set up embedding models
- [ ] Create vector search functions
- [ ] Migrate existing embeddings

### Phase 3 Prerequisites
- [ ] Design memory schema
- [ ] Implement memory service
- [ ] Create RPC functions for search

### Phase 4 Prerequisites
- [ ] Create Qdrant Cloud account
- [ ] Set up collections
- [ ] Implement dual-write strategy
- [ ] Plan data migration

### Phase 5 Prerequisites
- [ ] Set up n8n (cloud or self-hosted)
- [ ] Create webhook endpoints
- [ ] Design workflow templates
- [ ] Configure credentials

### Phase 6 Prerequisites
- [ ] Design agent state machine
- [ ] Create Composio account
- [ ] Configure tool integrations
- [ ] Test end-to-end workflows
