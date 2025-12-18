# Legal AI Assistant - Project Documentation

## Project Overview

A RAG-based legal document Q&A system that allows users to upload documents and get intelligent answers grounded in their uploaded content.

**Tech Stack:**
- Frontend: Next.js 14 (App Router)
- Database: PostgreSQL with pgvector
- Auth: NextAuth.js (migrating to Supabase Auth)
- RAG: Custom hybrid search with LlamaIndex
- Storage: AWS S3 (migrating to Supabase Storage)
- LLM: Abacus.AI API / Claude 3.5 Sonnet

---

## Architecture

### Core Directories
```
legal_ai_assistant/
├── nextjs_space/           # Main application
│   ├── app/                # Next.js App Router
│   │   ├── api/            # Backend API routes
│   │   │   ├── chat/       # Chat + RAG endpoint
│   │   │   ├── documents/  # Document management
│   │   │   └── auth/       # Authentication
│   │   └── dashboard/      # Protected pages
│   ├── components/         # React components
│   │   └── ui/             # shadcn/ui components
│   ├── lib/                # Business logic
│   │   ├── embeddings-v2.ts # RAG system
│   │   ├── pdf-processor.ts # Document processing
│   │   └── auth-options.ts  # Auth config
│   └── prisma/             # Database schema
├── research/               # Architecture research
└── .claude/                # Claude Code config
```

### Data Flow
```
User Query → Auth Check → Query Expansion → Embedding Generation
  → Hybrid Search (Semantic + Keyword) → RRF Fusion
  → Top-K Chunks → LLM with Context → Response with Citations
```

### Key Files
- `lib/embeddings-v2.ts` - Production RAG system (hybrid search, RRF)
- `app/api/chat/route.ts` - Main chat endpoint
- `app/api/documents/upload/route.ts` - Document ingestion
- `prisma/schema.prisma` - Database models

---

## Coding Standards

### TypeScript
- Strict mode enabled
- Use `interface` for objects, `type` for unions
- Always type function parameters and returns
- Use Zod for runtime validation

### React/Next.js
- Use Server Components by default
- Add "use client" only when needed
- Use React Query for data fetching
- Prefer shadcn/ui components

### Database
- Use Prisma for ORM
- Never raw SQL in API routes
- Always use parameterized queries
- Enable RLS for multi-tenancy

### API Routes
- Always verify auth first
- Return consistent error shapes
- Log errors with context
- Use proper HTTP status codes

---

## Common Commands

```bash
# Development
cd nextjs_space && npm run dev

# Build
npm run build

# Database
npx prisma generate
npx prisma db push
npx prisma migrate dev

# Test RAG
node check_docs.js
node test_rag.js
```

---

## Environment Variables

Required in `.env`:
```
DATABASE_URL=          # PostgreSQL connection
ABACUSAI_API_KEY=     # For embeddings/LLM
AWS_PROFILE=          # S3 access
AWS_BUCKET_NAME=      # Document storage
NEXTAUTH_SECRET=      # Session encryption
GOOGLE_CLIENT_ID=     # OAuth
GOOGLE_CLIENT_SECRET= # OAuth
```

---

## Domain Knowledge

### Document Types
- Legal contracts (NDAs, SLAs, licensing)
- Compliance documents
- Regulatory filings
- Corporate policies

### Legal Terminology
- Chapter/Article used interchangeably
- Section/Clause structure
- Jurisdiction-specific terms
- Query expansion handles synonyms

### RAG Specifics
- 1536-dimensional embeddings (text-embedding-3-small)
- Chunk size: 1000 chars, 150 overlap
- Hybrid search: semantic + keyword
- RRF fusion constant: k=60
- Minimum similarity threshold: 0.3

---

## Current Priorities

1. **Migration to Supabase** - Auth, Storage, pgvector
2. **LlamaIndex Integration** - Better RAG quality
3. **Memory System** - Multi-type memory (episodic, semantic)
4. **Qdrant Integration** - Dedicated vector DB
5. **n8n Workflows** - Background processing

---

## References

- @research/application/architecture/RECOMMENDED_ARCHITECTURE.md
- @research/application/rag-frameworks/RAG_FRAMEWORKS_COMPARISON.md
- @research/application/memory-systems/MEMORY_SYSTEMS_RESEARCH.md
- @research/application/infrastructure/INFRASTRUCTURE_OPTIONS.md
- @research/claude/CLAUDE_CODE_FEATURES.md
