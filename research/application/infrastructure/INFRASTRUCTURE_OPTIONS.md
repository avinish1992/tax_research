# Infrastructure Options Research

## Overview

This document covers infrastructure choices for scaling the Legal AI Assistant: databases, vector stores, workflow automation, and integration platforms.

---

## 1. Vector Databases Comparison

### Quick Decision Guide

| Use Case | Recommendation |
|----------|----------------|
| Zero ops, fastest start | Pinecone |
| Self-hosting, cost-conscious | Qdrant |
| Already using Postgres | Supabase pgvector |
| Billion-scale vectors | Milvus |
| Knowledge graphs needed | Weaviate |

### Detailed Comparison

#### Pinecone
**Type:** Fully managed, serverless

**Pros:**
- Zero operations overhead
- Excellent reliability
- Multi-region support
- SOC 2/HIPAA on enterprise tier
- Free tier available

**Cons:**
- Higher costs at scale
- Vendor lock-in
- Less flexibility

**Best For:** Commercial AI SaaS, teams wanting reliability without cluster management

```python
import pinecone

pinecone.init(api_key="YOUR_API_KEY", environment="us-west1-gcp")
index = pinecone.Index("legal-documents")

# Upsert vectors
index.upsert(vectors=[
    {"id": "doc1", "values": embedding, "metadata": {"type": "contract"}}
])

# Query
results = index.query(query_embedding, top_k=10, include_metadata=True)
```

#### Qdrant
**Type:** Open-source, Rust-based

**Pros:**
- Best free tier (1GB forever, no CC required)
- High performance, low latency
- Advanced metadata filtering
- ACID-compliant transactions
- Self-hosting or cloud

**Cons:**
- More ops if self-hosted
- Smaller community than Milvus

**Best For:** Cost-sensitive workloads, performance-critical applications

```python
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct

client = QdrantClient(url="http://localhost:6333")

# Create collection
client.create_collection(
    collection_name="legal_docs",
    vectors_config=VectorParams(size=1536, distance=Distance.COSINE)
)

# Upsert with filtering
client.upsert(
    collection_name="legal_docs",
    points=[
        PointStruct(
            id=1,
            vector=embedding,
            payload={"doc_type": "contract", "jurisdiction": "CA"}
        )
    ]
)

# Query with filters
results = client.search(
    collection_name="legal_docs",
    query_vector=query_embedding,
    query_filter=Filter(
        must=[FieldCondition(key="doc_type", match=MatchValue(value="contract"))]
    ),
    limit=10
)
```

#### Supabase pgvector
**Type:** PostgreSQL extension, managed

**Pros:**
- Built into existing Postgres
- Row Level Security (RLS) for permissions
- Single database for all data
- Auth integration
- Real-time subscriptions
- Free tier generous

**Cons:**
- Not as fast as dedicated vector DBs
- Scaling requires more planning

**Best For:** Teams already using Postgres, need integrated auth/permissions

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Create table with embedding
CREATE TABLE legal_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users,
    content TEXT,
    embedding vector(1536),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast search
CREATE INDEX ON legal_documents
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- RLS for user-specific access
ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own documents"
ON legal_documents FOR SELECT
USING (auth.uid() = user_id);

-- Similarity search
SELECT id, content, metadata,
       1 - (embedding <=> $1::vector) as similarity
FROM legal_documents
WHERE user_id = auth.uid()
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

#### Milvus
**Type:** Open-source, industrial scale

**Pros:**
- Proven at billion-scale
- Best benchmarks for large deployments
- Full control with self-hosting
- Distributed architecture

**Cons:**
- Requires data engineering expertise
- Complex operations
- Higher resource requirements

**Best For:** Enterprise scale, teams with infrastructure expertise

#### Weaviate
**Type:** Open-source, knowledge graph

**Pros:**
- GraphQL interface
- Built-in knowledge graph
- Hybrid search native
- Good ecosystem

**Cons:**
- Higher memory usage at scale
- More complex than others

**Best For:** Applications needing knowledge graphs + vectors

---

## 2. Supabase Platform

### Why Supabase for Legal AI

**All-in-One Platform:**
- PostgreSQL database with pgvector
- Authentication (email, OAuth, magic links)
- Row Level Security for multi-tenancy
- Real-time subscriptions
- Storage (S3-compatible)
- Edge Functions (Deno)

### Architecture with Supabase

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Frontend                      │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                    Supabase                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │    Auth     │ │  Database   │ │   Storage   │       │
│  │  (Users)    │ │ (pgvector)  │ │   (PDFs)    │       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
│  ┌─────────────┐ ┌─────────────┐                        │
│  │  Real-time  │ │ Edge Funcs  │                        │
│  │   (Chat)    │ │  (Embeddings)│                       │
│  └─────────────┘ └─────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

### Key Features

**1. Authentication with RLS**
```typescript
// supabase/client.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// User signup
const { user, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'secure-password'
})

// OAuth
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google'
})
```

**2. Vector Search with Permissions**
```sql
-- Function for RAG with permissions
CREATE OR REPLACE FUNCTION search_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    1 - (d.embedding <=> query_embedding) as similarity
  FROM legal_documents d
  WHERE
    d.user_id = auth.uid()
    AND 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

**3. Real-time Chat**
```typescript
// Real-time chat subscription
const channel = supabase
  .channel('chat')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `session_id=eq.${sessionId}`
    },
    (payload) => {
      setMessages(prev => [...prev, payload.new])
    }
  )
  .subscribe()
```

---

## 3. n8n Workflow Automation

### What is n8n?

Open-source workflow automation platform with 500+ integrations, including AI/LLM nodes.

### RAG Capabilities

**Native Features:**
- Document ingestion nodes
- Chunking strategies
- Embedding generation
- Vector store integration (Qdrant, Pinecone, etc.)
- LLM completion nodes
- Memory management

### Use Cases for Legal AI

**1. Document Processing Pipeline**
```
Google Drive → Extract Text → Chunk → Embed → Store in Qdrant
```

**2. Automated Legal Review**
```
Email (Contract) → OCR → RAG Query → Generate Report → Notify Slack
```

**3. Compliance Monitoring**
```
Webhook → Check Database → RAG Search → LLM Analysis → Store Results
```

### n8n + Supabase + Qdrant Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    n8n Workflows                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Ingestion: PDF → Chunk → Embed → Vector Store   │   │
│  │  Query: User → RAG → LLM → Response              │   │
│  │  Schedule: Daily compliance check                 │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌───────────┐  ┌───────────┐  ┌───────────┐
│  Supabase │  │   Qdrant  │  │  OpenAI   │
│  (Auth)   │  │ (Vectors) │  │  (LLM)    │
└───────────┘  └───────────┘  └───────────┘
```

### n8n Workflow Example (JSON)

```json
{
  "name": "Legal Document RAG Pipeline",
  "nodes": [
    {
      "name": "Webhook Trigger",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "path": "document-query",
        "method": "POST"
      }
    },
    {
      "name": "Supabase Auth Check",
      "type": "n8n-nodes-base.supabase",
      "parameters": {
        "operation": "getUser"
      }
    },
    {
      "name": "Generate Embedding",
      "type": "@n8n/n8n-nodes-langchain.embeddingsOpenAi",
      "parameters": {
        "model": "text-embedding-3-small"
      }
    },
    {
      "name": "Qdrant Search",
      "type": "@n8n/n8n-nodes-langchain.vectorStoreQdrant",
      "parameters": {
        "operation": "search",
        "topK": 10
      }
    },
    {
      "name": "LLM Response",
      "type": "@n8n/n8n-nodes-langchain.openAi",
      "parameters": {
        "model": "gpt-4",
        "systemPrompt": "Answer based only on provided context"
      }
    }
  ]
}
```

---

## 4. Composio Integration Platform

### What is Composio?

Platform providing 100+ pre-built integrations for AI agents via function calling.

### Key Features

- **100+ MCP Servers:** Pre-integrated, MCP-compliant tools
- **Secure by Default:** Authentication and token management built-in
- **Framework Compatible:** LangChain, LlamaIndex, CrewAI, OpenAI Agents SDK
- **Production Ready:** Hosted, versioned, monitored

### Use Cases for Legal AI

**1. CRM Integration**
- Connect to Salesforce, HubSpot for client data
- Auto-log legal interactions

**2. Document Management**
- Google Drive, Dropbox, OneDrive connectors
- Automated document syncing

**3. Communication**
- Slack, Teams, Email integrations
- Automated notifications

**4. Calendar/Scheduling**
- Meeting scheduling for consultations
- Deadline tracking

### Integration Example

```python
from composio_langchain import ComposioToolSet, Action

toolset = ComposioToolSet()

# Get legal-relevant tools
tools = toolset.get_tools(
    actions=[
        Action.GOOGLEDRIVE_UPLOAD_FILE,
        Action.SLACK_SEND_MESSAGE,
        Action.GMAIL_SEND_EMAIL,
        Action.NOTION_CREATE_PAGE
    ]
)

# Use with LangChain agent
agent = create_openai_tools_agent(llm, tools, prompt)
```

---

## 5. Recommended Infrastructure Stack

### For Fast MVP (Current Stage)

```
Frontend:     Next.js 14 (keep existing)
Auth:         Supabase Auth (replace NextAuth)
Database:     Supabase PostgreSQL + pgvector
Vector:       Supabase pgvector (integrated)
Storage:      Supabase Storage (replace AWS S3)
RAG:          LlamaIndex
LLM:          Claude 3.5 Sonnet via API
Deployment:   Vercel + Supabase
```

### For Scale (Future)

```
Frontend:     Next.js 14
Auth:         Supabase Auth
Database:     Supabase PostgreSQL
Vector:       Qdrant Cloud (dedicated)
Storage:      Supabase Storage
RAG:          LlamaIndex + LangGraph
Workflows:    n8n (self-hosted or cloud)
Integrations: Composio
LLM:          Claude 3.5 Sonnet + GPT-4o routing
Deployment:   Vercel + Supabase + Qdrant Cloud
```

---

## Sources

- [Supabase AI & Vectors](https://supabase.com/docs/guides/ai)
- [RAG with Permissions - Supabase](https://supabase.com/docs/guides/ai/rag-with-permissions)
- [pgvector Supabase](https://supabase.com/docs/guides/database/extensions/pgvector)
- [Vector Database Comparison 2025](https://liquidmetal.ai/casesAndBlogs/vector-comparison/)
- [Best Vector Databases 2025](https://www.firecrawl.dev/blog/best-vector-databases-2025)
- [n8n RAG Documentation](https://docs.n8n.io/advanced-ai/rag-in-n8n/)
- [Agentic RAG with n8n](https://blog.n8n.io/agentic-rag/)
- [Composio GitHub](https://github.com/ComposioHQ/composio)
- [Composio AI Agent Tools](https://composio.dev/blog/ai-agent-tools)
