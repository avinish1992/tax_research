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

## ⚠️ DEPLOYMENT (CRITICAL)

**When user asks to deploy, ALWAYS use Git-based deployment:**

```bash
cd nextjs_space

# Step 1: Commit changes
git add -A
git commit -m "Your commit message

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

# Step 2: Push to trigger Netlify build
git push origin main

# Step 3: Verify deployment
./scripts/verify-deploy.sh
```

**⛔ NEVER use `netlify deploy --prod` directly** - it doesn't properly deploy the Next.js server handler functions, causing 404 errors on API routes.

**Why Git-based deploy?**
- Triggers full build on Netlify's servers
- Properly bundles Next.js server handler (API routes)
- Properly bundles edge functions (middleware/auth)

**Verification checklist after deploy:**
- `/api/documents` returns 401 (not 404)
- Deploy summary shows "1 function deployed"
- Deploy summary shows "1 edge function deployed"

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

## ⚠️ RAG ACCURACY TESTING (CRITICAL)

**When testing RAG accuracy, ALWAYS use the curated test dataset:**

```
nextjs_space/tests/test-dataset.json   # 234 unique questions (primary)
nextjs_space/tests/test-dataset.csv    # Same data for spreadsheet review
```

**DO NOT create new test files.** All questions are curated in these files.

### Dataset Structure

Each question includes:
```json
{
  "id": "Q001",
  "query": "What is the corporate tax rate?",
  "category": "basic",
  "difficulty": "easy|medium|hard|special",
  "question_type": "factual|procedural|comparative|scenario|...",
  "expected_keywords": ["9%", "375,000"],
  "ground_truth": "9% for income above AED 375,000",
  "expected_articles": ["Article 3"],
  "source_documents": [
    {"filename": "Federal-Decree-Law-No.-47-of-2022-EN.pdf", "pages": null, "sections": null}
  ],
  "curation": {
    "status": "active|deprecated|needs_review|draft",
    "quality_score": 1-5,
    "last_reviewed": "2026-01-10",
    "reviewer_notes": null
  }
}
```

### Dataset Statistics (234 questions)

| Difficulty | Count | | Question Type | Count |
|------------|-------|--|---------------|-------|
| Medium | 98 | | General | 78 |
| Easy | 64 | | Factual | 52 |
| Hard | 49 | | Procedural | 48 |
| Special | 23 | | Yes/No | 24 |

### Running Accuracy Tests

**Preferred Method: Node.js Script** (faster, more reliable)

```bash
cd nextjs_space

# Quick test (10 questions, ~3-4 min)
node scripts/run-accuracy-test.js

# Medium test (50 questions, ~15-20 min)
node scripts/run-accuracy-test.js --limit 50

# Full test (all 234 questions, ~60-90 min)
node scripts/run-accuracy-test.js --limit all

# Filter by category or difficulty
node scripts/run-accuracy-test.js --category basic --limit 20
node scripts/run-accuracy-test.js --difficulty easy

# Run specific questions
node scripts/run-accuracy-test.js --id Q001,Q002,Q003

# Verbose mode (show full responses)
node scripts/run-accuracy-test.js --limit 10 --verbose
```

**Reports Location:**
```
tests/accuracy-reports/
├── latest-report.json       # Always updated with latest run
├── latest-report.md         # Human-readable latest report
└── accuracy-report-{timestamp}.json/.md  # Historical reports
```

**Alternative: Single query test**
```bash
curl -X POST http://localhost:5000/api/test/accuracy \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the corporate tax rate?"}'
```

### Curating the Dataset

**Adding new questions:**
1. Edit `test-dataset.json`
2. Add to `questions` array with `status: "draft"`
3. Fill in: query, category, expected_keywords, source_documents
4. After testing, change status to `"active"`

**Updating existing questions:**
1. Find by ID (Q001, Q002, etc.)
2. Update fields as needed
3. Set `last_reviewed` to today's date
4. Add notes in `reviewer_notes`

**Deprecating questions:**
1. Set `status: "deprecated"` (keeps history)
2. Tests automatically skip deprecated questions

**Quality scores (1-5):**
- 1: Poor - vague or duplicate
- 2: Below average - needs improvement
- 3: Average - acceptable
- 4: Good - well-formed
- 5: Excellent - ideal test case

---

## References

- @research/application/architecture/RECOMMENDED_ARCHITECTURE.md
- @research/application/rag-frameworks/RAG_FRAMEWORKS_COMPARISON.md
- @research/application/memory-systems/MEMORY_SYSTEMS_RESEARCH.md
- @research/application/infrastructure/INFRASTRUCTURE_OPTIONS.md
- @research/claude/CLAUDE_CODE_FEATURES.md
