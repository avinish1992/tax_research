# Integration Options Guide

## Overview

This document covers third-party integrations that can enhance the Legal AI Assistant's capabilities.

---

## 1. Composio - AI Agent Tools

### What It Is
Platform providing 100+ pre-built integrations for AI agents via function calling.

### Key Integrations for Legal AI

#### Document Storage
```python
from composio_langchain import ComposioToolSet, Action

tools = ComposioToolSet().get_tools(actions=[
    Action.GOOGLEDRIVE_UPLOAD_FILE,
    Action.GOOGLEDRIVE_DOWNLOAD_FILE,
    Action.DROPBOX_UPLOAD_FILE,
    Action.ONEDRIVE_UPLOAD_FILE
])
```

#### Communication
```python
tools = ComposioToolSet().get_tools(actions=[
    Action.GMAIL_SEND_EMAIL,
    Action.SLACK_SEND_MESSAGE,
    Action.TEAMS_SEND_MESSAGE
])
```

#### CRM Integration
```python
tools = ComposioToolSet().get_tools(actions=[
    Action.HUBSPOT_CREATE_CONTACT,
    Action.SALESFORCE_CREATE_RECORD,
    Action.PIPEDRIVE_CREATE_DEAL
])
```

#### Calendar
```python
tools = ComposioToolSet().get_tools(actions=[
    Action.GOOGLE_CALENDAR_CREATE_EVENT,
    Action.OUTLOOK_CALENDAR_CREATE_EVENT
])
```

### Setup
```bash
pip install composio-langchain
composio login
composio add google_drive
composio add slack
```

### Use Case: Legal Contract Workflow
```python
async def contract_review_workflow(contract_path: str, client_email: str):
    toolset = ComposioToolSet()

    # 1. Download contract from Drive
    contract = await toolset.execute_action(
        Action.GOOGLEDRIVE_DOWNLOAD_FILE,
        {"file_id": contract_path}
    )

    # 2. Analyze with RAG
    analysis = await analyze_contract(contract)

    # 3. Send results via email
    await toolset.execute_action(
        Action.GMAIL_SEND_EMAIL,
        {
            "to": client_email,
            "subject": "Contract Analysis Complete",
            "body": analysis.summary
        }
    )

    # 4. Create follow-up meeting
    await toolset.execute_action(
        Action.GOOGLE_CALENDAR_CREATE_EVENT,
        {
            "title": "Contract Review Discussion",
            "duration": 30,
            "attendees": [client_email]
        }
    )
```

---

## 2. n8n - Workflow Automation

### What It Is
Open-source workflow automation with 500+ integrations and AI capabilities.

### Key Workflows for Legal AI

#### Document Ingestion Pipeline
```json
{
  "name": "Legal Document Processor",
  "trigger": "Webhook (document upload)",
  "steps": [
    "Validate file type",
    "Download from storage",
    "Extract text (PDF/Word)",
    "Chunk content",
    "Generate embeddings",
    "Store in vector DB",
    "Update metadata",
    "Notify user"
  ]
}
```

#### Automated Legal Research
```json
{
  "name": "Legal Research Agent",
  "trigger": "Webhook (research request)",
  "steps": [
    "Parse research query",
    "Search internal documents",
    "Search legal databases (via API)",
    "Aggregate results",
    "Generate summary with LLM",
    "Create report",
    "Send via email/Slack"
  ]
}
```

#### Compliance Monitoring
```json
{
  "name": "Compliance Monitor",
  "trigger": "Schedule (daily)",
  "steps": [
    "Fetch regulatory updates",
    "Compare with stored policies",
    "Identify gaps",
    "Generate report",
    "Alert if critical issues",
    "Update compliance database"
  ]
}
```

### Setup Options

#### Cloud (Easiest)
```
1. Sign up at n8n.io
2. Create workspace
3. Import workflow templates
4. Configure credentials
```

#### Self-Hosted (Docker)
```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  n8nio/n8n
```

#### Self-Hosted (npm)
```bash
npm install n8n -g
n8n start
```

### Integration with Legal AI

```typescript
// Webhook to trigger n8n workflow
export async function POST(req: Request) {
  const { documentId, userId } = await req.json()

  // Trigger n8n workflow
  await fetch(`${N8N_URL}/webhook/document-process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${N8N_API_KEY}`
    },
    body: JSON.stringify({ documentId, userId })
  })

  return Response.json({ status: 'processing' })
}
```

---

## 3. LangSmith - Observability

### What It Is
LangChain's platform for debugging, testing, and monitoring LLM applications.

### Key Features
- Trace all LLM calls
- Debug retrieval quality
- A/B test prompts
- Monitor costs
- Evaluate accuracy

### Setup
```bash
pip install langsmith
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=your_key
```

### Integration
```python
from langsmith import traceable

@traceable(name="legal_rag_query")
async def query_documents(query: str, user_id: str):
    # All LLM calls are automatically traced
    embedding = await generate_embedding(query)
    results = await hybrid_search(embedding, query)
    response = await generate_response(query, results)
    return response
```

---

## 4. Helicone - LLM Proxy

### What It Is
Open-source LLM proxy for logging, caching, and rate limiting.

### Key Features
- Request logging
- Response caching
- Rate limiting
- Cost tracking
- A/B testing

### Setup
```typescript
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://oai.helicone.ai/v1',
  defaultHeaders: {
    'Helicone-Auth': `Bearer ${process.env.HELICONE_API_KEY}`
  }
})
```

### Benefits
- 50%+ cost reduction with caching
- Visibility into all LLM calls
- Easy debugging

---

## 5. Unstructured.io - Document Processing

### What It Is
Open-source document processing for PDFs, images, and more.

### Key Features
- Multi-format support (PDF, DOCX, PPTX, images)
- Layout detection
- Table extraction
- OCR for scanned documents

### Setup
```bash
pip install unstructured[pdf]
```

### Usage
```python
from unstructured.partition.pdf import partition_pdf

elements = partition_pdf(
    filename="contract.pdf",
    strategy="hi_res",  # Best quality
    extract_images_in_pdf=True,
    extract_image_block_types=["Image", "Table"]
)

# Elements include paragraphs, tables, images with metadata
for element in elements:
    print(f"Type: {element.category}")
    print(f"Text: {element.text[:100]}...")
    print(f"Page: {element.metadata.page_number}")
```

### Benefits for Legal AI
- Better table extraction from contracts
- OCR for scanned legal documents
- Preserve document structure

---

## 6. Anthropic MCP - Model Context Protocol

### What It Is
Standard protocol for connecting AI models to external tools and data.

### Setup for Claude
```bash
# Add MCP server
claude mcp add --transport http legal-db https://your-api.com/mcp/

# Configure in .mcp.json
{
  "mcpServers": {
    "legal-db": {
      "command": "npx",
      "args": ["-y", "@your-org/legal-mcp-server"],
      "env": {
        "DATABASE_URL": "postgresql://..."
      }
    }
  }
}
```

### Custom MCP Server
```typescript
// mcp-server.ts
import { Server } from '@modelcontextprotocol/sdk/server'

const server = new Server({
  name: 'legal-ai-mcp',
  version: '1.0.0'
})

server.registerTool({
  name: 'search_legal_documents',
  description: 'Search uploaded legal documents',
  parameters: {
    query: { type: 'string', required: true },
    filters: { type: 'object' }
  },
  handler: async ({ query, filters }) => {
    return await hybridSearch(query, filters)
  }
})

server.start()
```

---

## 7. Mem0 - AI Memory Layer

### What It Is
Open-source memory layer for personalized AI experiences.

### Key Features
- User-level memory
- Automatic memory extraction
- Cross-session persistence
- Privacy-focused

### Setup
```bash
pip install mem0ai
```

### Usage
```python
from mem0 import Memory

memory = Memory()

# Add memories
memory.add(
    "User prefers detailed legal explanations",
    user_id="user_123"
)

# Search memories
relevant = memory.search(
    "What are user's preferences?",
    user_id="user_123"
)

# Use in RAG context
context = f"""
User Preferences:
{relevant}

Documents:
{retrieved_chunks}
"""
```

---

## 8. Portkey - AI Gateway

### What It Is
AI gateway for multi-provider routing, caching, and fallbacks.

### Key Features
- Multi-LLM routing
- Automatic fallbacks
- Response caching
- Load balancing

### Setup
```typescript
import Portkey from 'portkey-ai'

const portkey = new Portkey({
  apiKey: process.env.PORTKEY_API_KEY,
  config: {
    strategy: {
      mode: 'fallback',
      providers: [
        { provider: 'anthropic', model: 'claude-3-5-sonnet' },
        { provider: 'openai', model: 'gpt-4o' }
      ]
    },
    cache: {
      mode: 'semantic',
      ttl: 3600
    }
  }
})

const response = await portkey.chat.completions.create({
  messages: [{ role: 'user', content: query }]
})
```

### Benefits
- 99.9% uptime with fallbacks
- Cost optimization with routing
- Response caching

---

## Integration Priority

| Integration | Priority | Effort | Impact |
|-------------|----------|--------|--------|
| Supabase | Critical | Medium | High |
| LlamaIndex | High | Medium | High |
| n8n | High | Medium | High |
| Composio | Medium | Low | Medium |
| Mem0 | Medium | Low | Medium |
| LangSmith | Medium | Low | Medium |
| Unstructured.io | Medium | Low | High |
| Portkey | Low | Low | Medium |
| MCP Server | Low | Medium | Medium |

---

## Recommended Integration Stack

### MVP (Now)
1. **Supabase** - Auth, DB, Storage, Vectors
2. **LlamaIndex** - RAG quality
3. **Anthropic Claude** - Primary LLM

### Scale (3-6 months)
4. **n8n** - Workflow automation
5. **Qdrant** - Dedicated vectors
6. **LangSmith** - Observability

### Advanced (6-12 months)
7. **Composio** - External tools
8. **Mem0** - Advanced memory
9. **Portkey** - Multi-LLM routing
10. **Custom MCP** - Deep integration
