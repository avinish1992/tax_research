# Component Responsibilities Matrix

**Version:** 1.0
**Date:** 2025-12-18

---

## Quick Reference Matrix

| Task | Next.js | Supabase | n8n | Why This Split? |
|------|:-------:|:--------:|:---:|-----------------|
| **User Authentication** | Gateway | ✅ Primary | - | Supabase Auth integrates with RLS |
| **Session Management** | Cookies | ✅ JWT/Sessions | - | Unified auth layer |
| **File Upload (receive)** | ✅ Primary | Storage | - | Fast user response |
| **File Storage** | - | ✅ Primary | - | S3-compatible, CDN |
| **Document Parsing** | - | - | ✅ Primary | CPU-intensive, async |
| **Text Chunking** | - | - | ✅ Primary | Part of ingestion pipeline |
| **Embedding Generation** | Query only | - | ✅ Bulk | n8n for bulk, Next.js for queries |
| **Vector Storage** | - | ✅ Primary | - | pgvector with RLS |
| **Semantic Search** | ✅ Primary | DB Functions | - | Low latency required |
| **Hybrid Search** | ✅ Primary | DB Functions | - | Low latency required |
| **Chat Streaming** | ✅ Primary | - | - | SSE, real-time UX |
| **Message Storage** | - | ✅ Primary | - | Persistent, RLS |
| **LLM Calls (chat)** | ✅ Primary | - | - | Streaming response |
| **LLM Calls (analysis)** | - | - | ✅ Primary | Complex, multi-step |
| **Scheduled Jobs** | - | - | ✅ Primary | Cron, maintenance |
| **Notifications** | - | - | ✅ Primary | Multi-channel |
| **Real-time Updates** | Consumer | ✅ Provider | - | WebSocket pub/sub |
| **Row Level Security** | - | ✅ Primary | - | Database-level |

---

## Detailed Breakdown

### 1. Supabase Responsibilities

#### 1.1 Authentication & Authorization

```
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE AUTH SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐        │
│  │   Sign Up   │     │   Sign In   │     │   OAuth     │        │
│  │  (Email/PW) │     │  (Email/PW) │     │  (Google)   │        │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘        │
│         │                   │                   │                │
│         └───────────────────┼───────────────────┘                │
│                             ▼                                    │
│                    ┌─────────────────┐                          │
│                    │    GoTrue API   │                          │
│                    │  (auth.users)   │                          │
│                    └────────┬────────┘                          │
│                             │                                    │
│                             ▼                                    │
│         ┌───────────────────┴───────────────────┐               │
│         │                                       │                │
│         ▼                                       ▼                │
│  ┌─────────────┐                       ┌─────────────┐          │
│  │ JWT Token   │                       │  Session    │          │
│  │ (access)    │                       │  (refresh)  │          │
│  └─────────────┘                       └─────────────┘          │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────┐        │
│  │              Row Level Security (RLS)                │        │
│  │                                                      │        │
│  │  auth.uid() = user_id  ◄── Automatic filtering      │        │
│  │                                                      │        │
│  └─────────────────────────────────────────────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**What Supabase Handles:**
- User registration and login
- Password hashing and verification
- OAuth provider integration (Google, GitHub, etc.)
- JWT token generation and validation
- Session management (refresh tokens)
- Email verification and password reset
- Row Level Security enforcement

**What Next.js Does:**
- Receives tokens, stores in cookies
- Passes tokens to Supabase client
- Redirects based on auth state

---

#### 1.2 Database (PostgreSQL + pgvector)

```
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE DATABASE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  EXTENSIONS ENABLED:                                            │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│  │  pgvector  │  │  pg_trgm   │  │ uuid-ossp  │                │
│  │  (vectors) │  │ (trigrams) │  │  (UUIDs)   │                │
│  └────────────┘  └────────────┘  └────────────┘                │
│                                                                  │
│  TABLES:                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  profiles          │ User metadata, preferences          │    │
│  │  documents         │ Document metadata                    │    │
│  │  document_chunks   │ Text chunks + vector embeddings     │    │
│  │  chat_sessions     │ Conversation containers             │    │
│  │  messages          │ Individual chat messages            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  FUNCTIONS:                                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  search_documents()       │ Semantic similarity search   │    │
│  │  hybrid_search_documents()│ Semantic + keyword search    │    │
│  │  match_documents()        │ Simple vector match          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  INDEXES:                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  HNSW (embedding)    │ Fast approximate nearest neighbor │    │
│  │  GIN (content)       │ Trigram text search               │    │
│  │  B-tree (foreign keys)│ Standard lookups                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**What Supabase Handles:**
- All data persistence
- Vector similarity search (HNSW)
- Full-text/trigram search
- Transaction management
- Backup and recovery
- RLS policy enforcement

**What Next.js/n8n Does:**
- Query the database
- Call stored functions
- Handle application logic

---

#### 1.3 File Storage

```
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE STORAGE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BUCKET: legal-documents                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                          │    │
│  │  Allowed Types: PDF, DOCX, DOC, TXT                     │    │
│  │  Max Size: 50MB                                          │    │
│  │  Access: Private (RLS)                                   │    │
│  │                                                          │    │
│  │  Structure:                                              │    │
│  │  /{user_id}/                                             │    │
│  │      ├── {document_id}/                                  │    │
│  │      │   └── original.pdf                               │    │
│  │      └── {document_id}/                                  │    │
│  │          └── contract.docx                              │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  RLS POLICIES:                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  SELECT: auth.uid()::text = (path_tokens)[1]            │    │
│  │  INSERT: auth.uid()::text = (path_tokens)[1]            │    │
│  │  DELETE: auth.uid()::text = (path_tokens)[1]            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**What Supabase Handles:**
- File upload/download
- CDN distribution
- Presigned URLs
- Access control via RLS
- Image transformations (if needed)

**What Next.js Does:**
- Upload files via API route
- Generate upload URLs
- Return download URLs

**What n8n Does:**
- Download files for processing
- Access via service role key

---

#### 1.4 Realtime

```
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE REALTIME                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  USE CASES:                                                     │
│                                                                  │
│  1. Document Processing Status                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  n8n updates document.status                             │    │
│  │       │                                                  │    │
│  │       ▼                                                  │    │
│  │  Supabase Realtime broadcasts                           │    │
│  │       │                                                  │    │
│  │       ▼                                                  │    │
│  │  Next.js client receives update                         │    │
│  │       │                                                  │    │
│  │       ▼                                                  │    │
│  │  UI shows "Document Ready!"                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  2. Chat Message Sync (multi-device)                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  New message inserted                                    │    │
│  │       │                                                  │    │
│  │       ▼                                                  │    │
│  │  All user's devices receive update                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  SUBSCRIPTION PATTERN:                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  supabase                                                │    │
│  │    .channel('documents')                                 │    │
│  │    .on('postgres_changes', {                            │    │
│  │      event: 'UPDATE',                                    │    │
│  │      schema: 'public',                                   │    │
│  │      table: 'documents',                                 │    │
│  │      filter: `user_id=eq.${userId}`                     │    │
│  │    }, callback)                                          │    │
│  │    .subscribe()                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### 2. n8n Responsibilities

#### 2.1 Document Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                N8N: DOCUMENT INGESTION WORKFLOW                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TRIGGER: Webhook from Next.js                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  POST /webhook/document-process                          │    │
│  │  {                                                       │    │
│  │    "documentId": "uuid",                                 │    │
│  │    "userId": "uuid",                                     │    │
│  │    "storagePath": "user_id/doc_id/file.pdf"             │    │
│  │  }                                                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  STEP 1: Validate & Update Status                        │    │
│  │  - Check document exists in DB                           │    │
│  │  - Set status = 'processing'                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  STEP 2: Download File                                   │    │
│  │  - Get presigned URL from Supabase Storage               │    │
│  │  - Download file binary                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  STEP 3: Parse Document                                  │    │
│  │  - PDF: Extract text (pdf-parse or Unstructured.io)     │    │
│  │  - DOCX: Extract text (mammoth)                         │    │
│  │  - Preserve page numbers                                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  STEP 4: Chunk Text                                      │    │
│  │  - Recursive character splitter                          │    │
│  │  - Chunk size: 1000 chars                               │    │
│  │  - Overlap: 150 chars                                    │    │
│  │  - Track chunk_index and page_number                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  STEP 5: Generate Embeddings (Batch)                    │    │
│  │  - OpenAI text-embedding-3-small                        │    │
│  │  - Batch API for efficiency                             │    │
│  │  - 1536 dimensions per chunk                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  STEP 6: Store in Supabase                              │    │
│  │  - Batch insert to document_chunks                      │    │
│  │  - Include: content, embedding, page_number, metadata   │    │
│  └─────────────────────────────────────────────────────────┘    │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  STEP 7: Update Document Status                         │    │
│  │  - Set status = 'completed'                             │    │
│  │  - Set processed_at = now()                             │    │
│  │  - Triggers Realtime notification to user               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ERROR HANDLING:                                                │
│  - On failure: status = 'failed', store error message          │
│  - Retry logic: 3 attempts with exponential backoff            │
│  - Dead letter queue for manual review                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

#### 2.2 Scheduled Maintenance Jobs

```
┌─────────────────────────────────────────────────────────────────┐
│                N8N: SCHEDULED WORKFLOWS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  JOB 1: CLEANUP FAILED DOCUMENTS (Daily)                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Cron: 0 2 * * * (2 AM daily)                           │    │
│  │  - Find documents with status='failed' > 7 days old     │    │
│  │  - Delete from storage                                   │    │
│  │  - Delete from database                                  │    │
│  │  - Send report email                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  JOB 2: RE-EMBED STALE DOCUMENTS (Weekly)                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Cron: 0 3 * * 0 (3 AM Sunday)                          │    │
│  │  - Find documents older than 90 days                    │    │
│  │  - Re-generate embeddings (model might have improved)   │    │
│  │  - Update chunk embeddings                              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  JOB 3: USAGE ANALYTICS (Daily)                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Cron: 0 1 * * * (1 AM daily)                           │    │
│  │  - Count queries per user                               │    │
│  │  - Count documents per user                             │    │
│  │  - Track storage usage                                  │    │
│  │  - Store in analytics table                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  JOB 4: RETRY PENDING DOCUMENTS (Hourly)                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Cron: 0 * * * * (Every hour)                           │    │
│  │  - Find documents with status='pending' > 1 hour        │    │
│  │  - Re-trigger ingestion workflow                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

#### 2.3 AI Agent Tools (Future)

```
┌─────────────────────────────────────────────────────────────────┐
│                N8N: AI AGENT TOOL WORKFLOWS                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TOOL 1: DEEP DOCUMENT ANALYSIS                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Input: document_id                                      │    │
│  │  Process:                                                │    │
│  │  - Load all chunks                                       │    │
│  │  - Multi-pass LLM analysis                              │    │
│  │  - Extract key terms, entities, dates                   │    │
│  │  - Generate summary                                      │    │
│  │  Output: Structured analysis JSON                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  TOOL 2: CROSS-DOCUMENT COMPARISON                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Input: [document_id_1, document_id_2]                  │    │
│  │  Process:                                                │    │
│  │  - Load both documents                                   │    │
│  │  - Compare clauses                                       │    │
│  │  - Identify differences                                  │    │
│  │  Output: Comparison report                              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  TOOL 3: COMPLIANCE CHECK                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Input: document_id, compliance_framework                │    │
│  │  Process:                                                │    │
│  │  - Load document                                         │    │
│  │  - Load compliance checklist                            │    │
│  │  - Check each requirement                               │    │
│  │  Output: Compliance report with gaps                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3. Next.js Responsibilities

#### 3.1 Real-time Chat & RAG

```
┌─────────────────────────────────────────────────────────────────┐
│              NEXT.JS: CHAT API ROUTE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /api/chat/route.ts                                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                          │    │
│  │  export async function POST(req: Request) {              │    │
│  │                                                          │    │
│  │    // 1. Auth Check                                      │    │
│  │    const user = await getUser(req)                       │    │
│  │    if (!user) return unauthorized()                      │    │
│  │                                                          │    │
│  │    // 2. Parse Request                                   │    │
│  │    const { message, sessionId } = await req.json()       │    │
│  │                                                          │    │
│  │    // 3. Query Expansion (optional)                      │    │
│  │    const expandedQuery = expandQuery(message)            │    │
│  │                                                          │    │
│  │    // 4. Generate Query Embedding                        │    │
│  │    const embedding = await openai.embeddings.create({    │    │
│  │      model: 'text-embedding-3-small',                    │    │
│  │      input: expandedQuery                                │    │
│  │    })                                                    │    │
│  │                                                          │    │
│  │    // 5. Hybrid Search via Supabase Function             │    │
│  │    const { data: chunks } = await supabase               │    │
│  │      .rpc('hybrid_search_documents', {                   │    │
│  │        query_text: message,                              │    │
│  │        query_embedding: embedding,                       │    │
│  │        match_count: 10                                   │    │
│  │      })                                                  │    │
│  │                                                          │    │
│  │    // 6. Build Context                                   │    │
│  │    const context = formatChunksAsContext(chunks)         │    │
│  │                                                          │    │
│  │    // 7. Stream LLM Response                             │    │
│  │    const stream = await anthropic.messages.stream({      │    │
│  │      model: 'claude-3-5-sonnet-20241022',               │    │
│  │      messages: [                                         │    │
│  │        { role: 'system', content: LEGAL_SYSTEM_PROMPT }, │    │
│  │        { role: 'user', content: `Context:\n${context}\n\n│    │
│  │          Question: ${message}` }                         │    │
│  │      ]                                                   │    │
│  │    })                                                    │    │
│  │                                                          │    │
│  │    // 8. Return SSE Stream                               │    │
│  │    return new Response(stream.toReadableStream())        │    │
│  │  }                                                       │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  WHY IN NEXT.JS (not n8n)?                                      │
│  - Streaming responses required                                 │
│  - Low latency (<2s first token)                               │
│  - Direct database access                                       │
│  - No webhook overhead                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

#### 3.2 Document Upload Handler

```
┌─────────────────────────────────────────────────────────────────┐
│              NEXT.JS: DOCUMENT UPLOAD ROUTE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /api/documents/upload/route.ts                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                                                          │    │
│  │  export async function POST(req: Request) {              │    │
│  │                                                          │    │
│  │    // 1. Auth Check                                      │    │
│  │    const user = await getUser(req)                       │    │
│  │    if (!user) return unauthorized()                      │    │
│  │                                                          │    │
│  │    // 2. Parse Multipart Form                            │    │
│  │    const formData = await req.formData()                 │    │
│  │    const file = formData.get('file') as File             │    │
│  │                                                          │    │
│  │    // 3. Validate File                                   │    │
│  │    if (!isValidFileType(file)) return badRequest()       │    │
│  │    if (file.size > MAX_SIZE) return badRequest()         │    │
│  │                                                          │    │
│  │    // 4. Generate Document ID                            │    │
│  │    const documentId = crypto.randomUUID()                │    │
│  │    const storagePath = `${user.id}/${documentId}/${file.name}`│
│  │                                                          │    │
│  │    // 5. Upload to Supabase Storage                      │    │
│  │    const { error } = await supabase.storage              │    │
│  │      .from('legal-documents')                            │    │
│  │      .upload(storagePath, file)                          │    │
│  │                                                          │    │
│  │    // 6. Create Document Record                          │    │
│  │    await supabase.from('documents').insert({             │    │
│  │      id: documentId,                                     │    │
│  │      user_id: user.id,                                   │    │
│  │      file_name: file.name,                               │    │
│  │      storage_path: storagePath,                          │    │
│  │      file_size: file.size,                               │    │
│  │      status: 'pending'                                   │    │
│  │    })                                                    │    │
│  │                                                          │    │
│  │    // 7. Trigger n8n Workflow (fire and forget)          │    │
│  │    fetch(N8N_WEBHOOK_URL, {                              │    │
│  │      method: 'POST',                                     │    │
│  │      body: JSON.stringify({                              │    │
│  │        documentId,                                       │    │
│  │        userId: user.id,                                  │    │
│  │        storagePath                                       │    │
│  │      })                                                  │    │
│  │    })  // Don't await - async processing                 │    │
│  │                                                          │    │
│  │    // 8. Return Immediately                              │    │
│  │    return Response.json({                                │    │
│  │      documentId,                                         │    │
│  │      status: 'pending',                                  │    │
│  │      message: 'Document uploaded, processing started'    │    │
│  │    }, { status: 202 })                                   │    │
│  │  }                                                       │    │
│  │                                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  WHY SPLIT BETWEEN NEXT.JS AND N8N?                             │
│  - Next.js: Fast response to user (< 1s)                        │
│  - n8n: Heavy processing (parsing, embedding) async             │
│  - User gets immediate feedback                                 │
│  - Processing can take 30s-5min depending on document size      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Connection Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONNECTION SUMMARY                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        ┌─────────────┐                          │
│                        │   NEXT.JS   │                          │
│                        └──────┬──────┘                          │
│                               │                                  │
│           ┌───────────────────┼───────────────────┐             │
│           │                   │                   │              │
│           ▼                   ▼                   ▼              │
│    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│    │  Supabase   │    │  Supabase   │    │    n8n      │        │
│    │   Client    │    │    Auth     │    │   Webhook   │        │
│    │  (queries)  │    │   (JWT)     │    │  (trigger)  │        │
│    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘        │
│           │                  │                   │               │
│           └──────────────────┼───────────────────┘               │
│                              │                                   │
│                              ▼                                   │
│                      ┌─────────────┐                            │
│                      │  SUPABASE   │                            │
│                      │  PLATFORM   │                            │
│                      │             │                            │
│                      │ ┌─────────┐ │                            │
│                      │ │   DB    │ │◄───── n8n reads/writes     │
│                      │ │pgvector │ │                            │
│                      │ └─────────┘ │                            │
│                      │ ┌─────────┐ │                            │
│                      │ │ Storage │ │◄───── n8n downloads files  │
│                      │ └─────────┘ │                            │
│                      │ ┌─────────┐ │                            │
│                      │ │Realtime │ │────── Next.js subscribes   │
│                      │ └─────────┘ │                            │
│                      └─────────────┘                            │
│                                                                  │
│  PROTOCOLS:                                                     │
│  ─────────  HTTP/REST                                           │
│  ═════════  WebSocket                                           │
│  - - - - -  Webhook (async)                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary Table

| Operation | Latency Requirement | Component | Reason |
|-----------|---------------------|-----------|--------|
| User login | < 1s | Supabase Auth | Built-in, JWT |
| Chat query | < 2s first token | Next.js | Streaming required |
| Vector search | < 500ms | Supabase (pgvector) | Database function |
| File upload | < 2s response | Next.js | Fast user feedback |
| Document processing | 30s - 5min | n8n | Async, no timeout |
| Status update | Real-time | Supabase Realtime | WebSocket |
| Scheduled jobs | N/A | n8n | Cron triggers |
| Multi-channel notify | < 30s | n8n | External integrations |
