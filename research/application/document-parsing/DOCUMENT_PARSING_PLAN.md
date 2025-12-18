# Document Parsing Enhancement Plan

## Executive Summary

This document outlines the plan to upgrade the document parsing system from the current `unpdf` implementation to a more robust solution with better table extraction, metadata handling, and page-level tracking for legal documents.

---

## Current State Analysis

### Current Implementation (`lib/pdf-processor.ts`)

```typescript
// Uses unpdf for basic text extraction
import { extractText } from 'unpdf'

interface PageText {
  pageNumber: number
  text: string
}

interface TextChunk {
  content: string
  pageNumber: number
  chunkIndex: number
}
```

### Current Limitations

| Feature | Current State | Impact |
|---------|---------------|--------|
| Table Extraction | None - tables become garbled text | Critical for legal schedules, payment terms |
| OCR Support | None - cannot process scanned PDFs | Many legal docs are scanned |
| Metadata Extraction | Page numbers only | Missing structural context |
| Element Type Detection | None | Can't distinguish titles, clauses, headers |
| Bounding Boxes | None | No position tracking for citations |
| Multi-column Support | Poor | Legal docs often use columns |

### Current Database Schema (Supabase)

```sql
-- document_chunks table
id: uuid
document_id: uuid
content: text
embedding: vector(1536)
page_number: integer
chunk_index: integer
metadata: jsonb  -- Currently empty '{}'
created_at: timestamptz
```

---

## Library Comparison Summary

| Feature | Docling (IBM) | LlamaParse | Unstructured | unpdf (Current) |
|---------|---------------|------------|--------------|-----------------|
| **Table Accuracy** | **97.9%** | ~85% | 75% | 0% |
| **Processing Speed** | 30-60s | **~6s** | 141s | <5s |
| **OCR Support** | Yes (multiple engines) | Yes (LLM-based) | Yes (Tesseract) | No |
| **Self-Hosted** | **Yes (MIT)** | No (API only) | Partial | Yes |
| **Node.js Native** | No (Python) | **Yes** | Partial | **Yes** |
| **Cost per 100K pages** | **$0** (infra only) | $300-$6,000 | $1,000 | **$0** |
| **Legal Doc Quality** | Excellent | Very Good | Very Good | Poor |

### Recommendation: **Docling** (Primary) + **LlamaParse** (Fallback)

**Rationale:**
1. **Docling** has best table extraction (97.9%) - critical for legal payment schedules, terms tables
2. **Free & self-hosted** - no per-page costs, runs locally for sensitive legal data
3. **LlamaParse** as fallback for quick TypeScript integration and natural language instructions

---

## Proposed Architecture

### High-Level Flow

```
PDF Upload → Docling Service (Python) → Structured Output (JSON)
    ↓
Node.js API ← REST Call
    ↓
Metadata Extraction → Enhanced Chunks → Embeddings → Supabase
```

### Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Application                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           lib/document-parser.ts                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │  Docling    │  │ LlamaParse  │  │   unpdf     │  │   │
│  │  │  (Primary)  │  │ (Fallback)  │  │  (Legacy)   │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
           │                    │
           ▼                    ▼
┌─────────────────────┐  ┌─────────────────────┐
│  Docling Service    │  │   LlamaParse API    │
│  (Docker/Python)    │  │   (Cloud)           │
│  - Self-hosted      │  │   - Managed         │
│  - Port 5001        │  │   - api.cloud.      │
└─────────────────────┘  │     llamaindex.ai   │
                         └─────────────────────┘
```

---

## Enhanced Metadata Schema

### New `document_chunks` Table Structure

```sql
-- Migration: enhance_document_chunks_metadata
ALTER TABLE document_chunks
ADD COLUMN IF NOT EXISTS element_type TEXT,
ADD COLUMN IF NOT EXISTS bbox JSONB,
ADD COLUMN IF NOT EXISTS section_title TEXT,
ADD COLUMN IF NOT EXISTS is_table BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS table_html TEXT,
ADD COLUMN IF NOT EXISTS confidence FLOAT;

-- Add index for element type filtering
CREATE INDEX IF NOT EXISTS idx_document_chunks_element_type
ON document_chunks(element_type);

-- Add index for table queries
CREATE INDEX IF NOT EXISTS idx_document_chunks_is_table
ON document_chunks(is_table) WHERE is_table = TRUE;

COMMENT ON COLUMN document_chunks.element_type IS
'Element type from parser: title, paragraph, table, list_item, header, footer, caption';

COMMENT ON COLUMN document_chunks.bbox IS
'Bounding box: {x, y, width, height, page}';

COMMENT ON COLUMN document_chunks.section_title IS
'Parent section/chapter title for hierarchical context';

COMMENT ON COLUMN document_chunks.table_html IS
'HTML representation of table if is_table=true';

COMMENT ON COLUMN document_chunks.confidence IS
'Parser confidence score 0-1';
```

### Enhanced Metadata JSON Structure

```typescript
interface EnhancedChunkMetadata {
  // Element classification
  element_type: 'title' | 'paragraph' | 'table' | 'list_item' | 'header' | 'footer' | 'caption' | 'image_caption';

  // Position tracking
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
    page: number;
  };

  // Document structure
  section_hierarchy?: string[];  // ["Chapter 1", "Article 5", "Section 5.2"]
  section_title?: string;        // Immediate parent section
  reading_order?: number;        // Document flow position

  // Table-specific
  is_table?: boolean;
  table_html?: string;           // Preserved table structure
  table_rows?: number;
  table_cols?: number;

  // Legal document specific
  clause_number?: string;        // "5.2.1"
  article_number?: string;       // "Article 47"
  chapter_number?: string;       // "Chapter 3"

  // Parser metadata
  parser_used: 'docling' | 'llamaparse' | 'unpdf';
  confidence?: number;           // 0-1 confidence score
  ocr_applied?: boolean;

  // Source tracking
  source_file: string;
  source_page: number;
}
```

### New `documents` Table Columns

```sql
-- Migration: enhance_documents_table
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS parser_used TEXT DEFAULT 'unpdf',
ADD COLUMN IF NOT EXISTS total_pages INTEGER,
ADD COLUMN IF NOT EXISTS has_tables BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS table_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS has_images BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ocr_applied BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS parsing_metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN documents.parsing_metadata IS
'Parser output metadata: {parse_time_ms, warnings, element_counts}';
```

---

## Implementation Plan

### Phase 1: Docling Service Setup (Week 1)

#### 1.1 Create Docling Microservice

**File: `services/docling/Dockerfile`**
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5001"]
```

**File: `services/docling/requirements.txt`**
```
docling>=2.0.0
fastapi>=0.100.0
uvicorn>=0.23.0
python-multipart>=0.0.6
```

**File: `services/docling/main.py`**
```python
from fastapi import FastAPI, UploadFile, File, HTTPException
from docling import PDFParse
import json
from typing import List, Dict, Any

app = FastAPI(title="Docling Parser Service")

@app.post("/parse")
async def parse_document(
    file: UploadFile = File(...),
    extract_tables: bool = True,
    extract_images: bool = False,
    ocr_enabled: bool = True
) -> Dict[str, Any]:
    """Parse PDF and return structured content with metadata."""

    try:
        content = await file.read()
        parser = PDFParse(data=content)

        # Get full document structure
        result = await parser.getText()

        pages = []
        tables = []

        for page_num, page in enumerate(result.pages, 1):
            page_data = {
                "page_number": page_num,
                "elements": []
            }

            for element in page.elements:
                elem_data = {
                    "type": element.label,  # title, paragraph, table, etc.
                    "content": element.text,
                    "bbox": {
                        "x": element.bbox.x,
                        "y": element.bbox.y,
                        "width": element.bbox.width,
                        "height": element.bbox.height
                    },
                    "confidence": element.confidence
                }

                # Handle tables specially
                if element.label == "table" and extract_tables:
                    elem_data["table_html"] = element.to_html()
                    elem_data["table_data"] = element.to_dict()
                    tables.append({
                        "page": page_num,
                        "html": element.to_html(),
                        "rows": len(element.rows),
                        "cols": len(element.cols)
                    })

                page_data["elements"].append(elem_data)

            pages.append(page_data)

        return {
            "success": True,
            "filename": file.filename,
            "total_pages": len(pages),
            "pages": pages,
            "tables": tables,
            "table_count": len(tables),
            "parser": "docling",
            "ocr_applied": ocr_enabled
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy", "parser": "docling"}
```

#### 1.2 Docker Compose Integration

**File: `docker-compose.yml` (addition)**
```yaml
services:
  docling:
    build: ./services/docling
    ports:
      - "5001:5001"
    environment:
      - DOCLING_CACHE_DIR=/app/cache
    volumes:
      - docling_cache:/app/cache
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  docling_cache:
```

### Phase 2: Node.js Integration (Week 1-2)

#### 2.1 Enhanced Document Parser

**File: `lib/document-parser.ts`**
```typescript
import { extractText } from 'unpdf'

export interface ParsedElement {
  type: 'title' | 'paragraph' | 'table' | 'list_item' | 'header' | 'footer' | 'caption';
  content: string;
  pageNumber: number;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  tableHtml?: string;
  tableData?: any;
}

export interface ParsedPage {
  pageNumber: number;
  elements: ParsedElement[];
}

export interface ParsedDocument {
  filename: string;
  totalPages: number;
  pages: ParsedPage[];
  tables: Array<{ page: number; html: string; rows: number; cols: number }>;
  tableCount: number;
  parser: 'docling' | 'llamaparse' | 'unpdf';
  ocrApplied: boolean;
}

export interface ParserOptions {
  extractTables?: boolean;
  extractImages?: boolean;
  ocrEnabled?: boolean;
  fallbackToUnpdf?: boolean;
}

const DOCLING_URL = process.env.DOCLING_SERVICE_URL || 'http://localhost:5001';
const LLAMAPARSE_API_KEY = process.env.LLAMA_CLOUD_API_KEY;

/**
 * Parse document using best available parser
 * Priority: Docling > LlamaParse > unpdf
 */
export async function parseDocument(
  buffer: Buffer,
  filename: string,
  options: ParserOptions = {}
): Promise<ParsedDocument> {
  const {
    extractTables = true,
    ocrEnabled = true,
    fallbackToUnpdf = true
  } = options;

  // Try Docling first (best for legal documents)
  try {
    console.log('🔍 Attempting to parse with Docling...');
    return await parseWithDocling(buffer, filename, { extractTables, ocrEnabled });
  } catch (doclingError) {
    console.warn('⚠️ Docling parsing failed:', doclingError);
  }

  // Try LlamaParse as secondary option
  if (LLAMAPARSE_API_KEY) {
    try {
      console.log('🔍 Attempting to parse with LlamaParse...');
      return await parseWithLlamaParse(buffer, filename);
    } catch (llamaError) {
      console.warn('⚠️ LlamaParse parsing failed:', llamaError);
    }
  }

  // Fall back to unpdf (basic text extraction)
  if (fallbackToUnpdf) {
    console.log('🔍 Falling back to unpdf (basic text extraction)...');
    return await parseWithUnpdf(buffer, filename);
  }

  throw new Error('All document parsing methods failed');
}

/**
 * Parse with Docling service
 */
async function parseWithDocling(
  buffer: Buffer,
  filename: string,
  options: { extractTables: boolean; ocrEnabled: boolean }
): Promise<ParsedDocument> {
  const formData = new FormData();
  formData.append('file', new Blob([buffer]), filename);

  const response = await fetch(`${DOCLING_URL}/parse?extract_tables=${options.extractTables}&ocr_enabled=${options.ocrEnabled}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Docling service error: ${response.status}`);
  }

  const result = await response.json();

  return {
    filename: result.filename,
    totalPages: result.total_pages,
    pages: result.pages.map((page: any) => ({
      pageNumber: page.page_number,
      elements: page.elements.map((elem: any) => ({
        type: elem.type,
        content: elem.content,
        pageNumber: page.page_number,
        bbox: elem.bbox,
        confidence: elem.confidence,
        tableHtml: elem.table_html,
        tableData: elem.table_data,
      })),
    })),
    tables: result.tables,
    tableCount: result.table_count,
    parser: 'docling',
    ocrApplied: result.ocr_applied,
  };
}

/**
 * Parse with LlamaParse API
 */
async function parseWithLlamaParse(
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  const { LlamaParseReader } = await import('llamaindex/readers/LlamaParseReader');

  const reader = new LlamaParseReader({
    apiKey: LLAMAPARSE_API_KEY,
    resultType: 'json',
    parsingInstructions: 'Extract legal document structure. Preserve all tables, clauses, and article numbers. Track page numbers for all elements.',
  });

  const documents = await reader.loadDataAsBuffer(buffer, filename);

  // Transform LlamaParse output to our format
  const pages: ParsedPage[] = [];
  const tables: Array<{ page: number; html: string; rows: number; cols: number }> = [];

  for (const doc of documents) {
    const pageNum = doc.metadata?.page_number || 1;

    if (!pages[pageNum - 1]) {
      pages[pageNum - 1] = { pageNumber: pageNum, elements: [] };
    }

    pages[pageNum - 1].elements.push({
      type: 'paragraph',
      content: doc.text,
      pageNumber: pageNum,
    });
  }

  return {
    filename,
    totalPages: pages.length,
    pages: pages.filter(Boolean),
    tables,
    tableCount: tables.length,
    parser: 'llamaparse',
    ocrApplied: false,
  };
}

/**
 * Parse with unpdf (fallback - basic text only)
 */
async function parseWithUnpdf(
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  const uint8Array = new Uint8Array(buffer);
  const { text, totalPages } = await extractText(uint8Array, { mergePages: false });

  const pages: ParsedPage[] = [];

  if (Array.isArray(text)) {
    text.forEach((pageText, index) => {
      if (pageText && pageText.trim().length > 0) {
        pages.push({
          pageNumber: index + 1,
          elements: [{
            type: 'paragraph',
            content: pageText.trim(),
            pageNumber: index + 1,
          }],
        });
      }
    });
  }

  return {
    filename,
    totalPages: totalPages || pages.length,
    pages,
    tables: [],
    tableCount: 0,
    parser: 'unpdf',
    ocrApplied: false,
  };
}
```

#### 2.2 Enhanced Chunking with Metadata

**File: `lib/document-chunker.ts`**
```typescript
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { ParsedDocument, ParsedElement } from './document-parser';

export interface EnhancedChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
  elementType: string;
  sectionTitle?: string;
  isTable: boolean;
  tableHtml?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
  metadata: Record<string, any>;
}

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  preserveTables?: boolean;
  preserveTitles?: boolean;
}

/**
 * Chunk parsed document with enhanced metadata preservation
 */
export async function chunkParsedDocument(
  doc: ParsedDocument,
  options: ChunkingOptions = {}
): Promise<EnhancedChunk[]> {
  const {
    chunkSize = 1000,
    chunkOverlap = 150,
    preserveTables = true,
    preserveTitles = true,
  } = options;

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ['\n\n\n', '\n\n', '\n', '. ', ', ', ' ', ''],
  });

  const chunks: EnhancedChunk[] = [];
  let globalChunkIndex = 0;
  let currentSectionTitle: string | undefined;

  for (const page of doc.pages) {
    for (const element of page.elements) {
      // Track section titles
      if (element.type === 'title' && preserveTitles) {
        currentSectionTitle = element.content;
      }

      // Handle tables specially - don't chunk them
      if (element.type === 'table' && preserveTables) {
        chunks.push({
          content: element.content,
          pageNumber: page.pageNumber,
          chunkIndex: globalChunkIndex++,
          elementType: 'table',
          sectionTitle: currentSectionTitle,
          isTable: true,
          tableHtml: element.tableHtml,
          bbox: element.bbox,
          confidence: element.confidence,
          metadata: {
            parser: doc.parser,
            source_file: doc.filename,
            source_page: page.pageNumber,
            element_type: 'table',
          },
        });
        continue;
      }

      // Chunk regular text elements
      const textChunks = await splitter.splitText(element.content);

      for (const chunkContent of textChunks) {
        chunks.push({
          content: chunkContent,
          pageNumber: page.pageNumber,
          chunkIndex: globalChunkIndex++,
          elementType: element.type,
          sectionTitle: currentSectionTitle,
          isTable: false,
          bbox: element.bbox,
          confidence: element.confidence,
          metadata: {
            parser: doc.parser,
            source_file: doc.filename,
            source_page: page.pageNumber,
            element_type: element.type,
            section_title: currentSectionTitle,
          },
        });
      }
    }
  }

  console.log(`✓ Created ${chunks.length} enhanced chunks`);
  console.log(`  - Tables preserved: ${chunks.filter(c => c.isTable).length}`);
  console.log(`  - Text chunks: ${chunks.filter(c => !c.isTable).length}`);
  console.log(`  - Avg chunk size: ${Math.floor(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length)} chars`);

  return chunks;
}

/**
 * Extract legal document structure (articles, chapters, clauses)
 */
export function extractLegalStructure(content: string): {
  articleNumber?: string;
  chapterNumber?: string;
  clauseNumber?: string;
} {
  const result: { articleNumber?: string; chapterNumber?: string; clauseNumber?: string } = {};

  // Match "Article X" or "Article (X)"
  const articleMatch = content.match(/Article\s+\(?(\d+)\)?/i);
  if (articleMatch) result.articleNumber = articleMatch[1];

  // Match "Chapter X" or "Chapter (X)"
  const chapterMatch = content.match(/Chapter\s+\(?(\d+)\)?/i);
  if (chapterMatch) result.chapterNumber = chapterMatch[1];

  // Match "Clause X.Y.Z" or "Section X.Y"
  const clauseMatch = content.match(/(?:Clause|Section)\s+(\d+(?:\.\d+)*)/i);
  if (clauseMatch) result.clauseNumber = clauseMatch[1];

  return result;
}
```

### Phase 3: Database Migrations (Week 2)

#### 3.1 Supabase Migration

**File: `supabase/migrations/YYYYMMDD_enhance_document_chunks.sql`**
```sql
-- Migration: Enhance document_chunks table with parser metadata
-- Description: Add columns for element type, bounding boxes, tables, and section tracking

-- Add new columns to document_chunks
ALTER TABLE document_chunks
ADD COLUMN IF NOT EXISTS element_type TEXT DEFAULT 'paragraph',
ADD COLUMN IF NOT EXISTS bbox JSONB,
ADD COLUMN IF NOT EXISTS section_title TEXT,
ADD COLUMN IF NOT EXISTS is_table BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS table_html TEXT,
ADD COLUMN IF NOT EXISTS confidence FLOAT;

-- Add constraint for element_type
ALTER TABLE document_chunks
ADD CONSTRAINT valid_element_type
CHECK (element_type IN ('title', 'paragraph', 'table', 'list_item', 'header', 'footer', 'caption', 'image_caption'));

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_document_chunks_element_type
ON document_chunks(element_type);

CREATE INDEX IF NOT EXISTS idx_document_chunks_is_table
ON document_chunks(is_table)
WHERE is_table = TRUE;

CREATE INDEX IF NOT EXISTS idx_document_chunks_section
ON document_chunks(section_title)
WHERE section_title IS NOT NULL;

-- Add comments
COMMENT ON COLUMN document_chunks.element_type IS
'Element type from parser: title, paragraph, table, list_item, header, footer, caption';

COMMENT ON COLUMN document_chunks.bbox IS
'Bounding box coordinates: {x, y, width, height}';

COMMENT ON COLUMN document_chunks.section_title IS
'Parent section/chapter title for hierarchical context';

COMMENT ON COLUMN document_chunks.is_table IS
'Whether this chunk represents a table';

COMMENT ON COLUMN document_chunks.table_html IS
'HTML representation of table structure if is_table=true';

COMMENT ON COLUMN document_chunks.confidence IS
'Parser confidence score (0.0 to 1.0)';

-- Enhance documents table
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS parser_used TEXT DEFAULT 'unpdf',
ADD COLUMN IF NOT EXISTS total_pages INTEGER,
ADD COLUMN IF NOT EXISTS has_tables BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS table_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ocr_applied BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS parsing_metadata JSONB DEFAULT '{}';

-- Add constraint for parser_used
ALTER TABLE documents
ADD CONSTRAINT valid_parser
CHECK (parser_used IN ('docling', 'llamaparse', 'unpdf'));

-- Add comments to documents
COMMENT ON COLUMN documents.parser_used IS
'Document parser used: docling, llamaparse, or unpdf';

COMMENT ON COLUMN documents.parsing_metadata IS
'Parser output metadata: parse_time_ms, warnings, element_counts';
```

#### 3.2 Create Enhanced Search Function

**File: `supabase/migrations/YYYYMMDD_enhanced_hybrid_search.sql`**
```sql
-- Enhanced hybrid search with element type filtering
CREATE OR REPLACE FUNCTION enhanced_hybrid_search(
  query_text TEXT,
  query_embedding vector(1536),
  p_user_id UUID,
  match_count INT DEFAULT 10,
  semantic_weight FLOAT DEFAULT 0.6,
  keyword_weight FLOAT DEFAULT 0.4,
  rrf_k INT DEFAULT 60,
  element_types TEXT[] DEFAULT NULL,
  include_tables BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  file_name TEXT,
  page_number INT,
  chunk_index INT,
  element_type TEXT,
  section_title TEXT,
  is_table BOOLEAN,
  table_html TEXT,
  semantic_rank INT,
  keyword_rank INT,
  rrf_score FLOAT,
  search_type TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH semantic_results AS (
    SELECT
      dc.id,
      dc.document_id,
      dc.content,
      d.file_name,
      dc.page_number,
      dc.chunk_index,
      dc.element_type,
      dc.section_title,
      dc.is_table,
      dc.table_html,
      ROW_NUMBER() OVER (ORDER BY dc.embedding <=> query_embedding) AS rank
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE d.user_id = p_user_id
      AND dc.embedding IS NOT NULL
      AND (element_types IS NULL OR dc.element_type = ANY(element_types))
      AND (include_tables OR dc.is_table = FALSE)
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  keyword_results AS (
    SELECT
      dc.id,
      dc.document_id,
      dc.content,
      d.file_name,
      dc.page_number,
      dc.chunk_index,
      dc.element_type,
      dc.section_title,
      dc.is_table,
      dc.table_html,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(
          to_tsvector('english', dc.content),
          plainto_tsquery('english', query_text)
        ) DESC
      ) AS rank
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE d.user_id = p_user_id
      AND to_tsvector('english', dc.content) @@ plainto_tsquery('english', query_text)
      AND (element_types IS NULL OR dc.element_type = ANY(element_types))
      AND (include_tables OR dc.is_table = FALSE)
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT
      COALESCE(s.id, k.id) AS id,
      COALESCE(s.document_id, k.document_id) AS document_id,
      COALESCE(s.content, k.content) AS content,
      COALESCE(s.file_name, k.file_name) AS file_name,
      COALESCE(s.page_number, k.page_number) AS page_number,
      COALESCE(s.chunk_index, k.chunk_index) AS chunk_index,
      COALESCE(s.element_type, k.element_type) AS element_type,
      COALESCE(s.section_title, k.section_title) AS section_title,
      COALESCE(s.is_table, k.is_table) AS is_table,
      COALESCE(s.table_html, k.table_html) AS table_html,
      s.rank AS semantic_rank,
      k.rank AS keyword_rank,
      (
        COALESCE(semantic_weight / (rrf_k + s.rank), 0) +
        COALESCE(keyword_weight / (rrf_k + k.rank), 0)
      ) AS rrf_score,
      CASE
        WHEN s.rank IS NOT NULL AND k.rank IS NOT NULL THEN 'semantic + keyword'
        WHEN s.rank IS NOT NULL THEN 'semantic'
        ELSE 'keyword'
      END AS search_type
    FROM semantic_results s
    FULL OUTER JOIN keyword_results k ON s.id = k.id
  )
  SELECT
    c.id,
    c.document_id,
    c.content,
    c.file_name,
    c.page_number,
    c.chunk_index,
    c.element_type,
    c.section_title,
    c.is_table,
    c.table_html,
    c.semantic_rank::INT,
    c.keyword_rank::INT,
    c.rrf_score,
    c.search_type
  FROM combined c
  ORDER BY c.rrf_score DESC
  LIMIT match_count;
END;
$$;
```

### Phase 4: Upload Route Integration (Week 2-3)

#### 4.1 Updated Upload Route

**File: `app/api/documents/upload/route.ts` (key changes)**
```typescript
import { parseDocument } from '@/lib/document-parser';
import { chunkParsedDocument } from '@/lib/document-chunker';
import { generateEmbedding } from '@/lib/supabase-rag';

export async function POST(request: NextRequest) {
  // ... auth and file validation ...

  // Parse document with enhanced parser
  const parsedDoc = await parseDocument(buffer, file.name, {
    extractTables: true,
    ocrEnabled: true,
    fallbackToUnpdf: true,
  });

  // Chunk with metadata preservation
  const chunks = await chunkParsedDocument(parsedDoc, {
    chunkSize: 1000,
    chunkOverlap: 150,
    preserveTables: true,
    preserveTitles: true,
  });

  // Create document record with enhanced metadata
  const document = await prisma.document.create({
    data: {
      userId: user.id,
      fileName: file.name,
      originalName: file.name,
      fileSize: file.size,
      cloudStoragePath: storagePath,
      parserUsed: parsedDoc.parser,
      totalPages: parsedDoc.totalPages,
      hasTables: parsedDoc.tableCount > 0,
      tableCount: parsedDoc.tableCount,
      ocrApplied: parsedDoc.ocrApplied,
      parsingMetadata: {
        element_counts: countElementTypes(chunks),
        parse_timestamp: new Date().toISOString(),
      },
    },
  });

  // Generate embeddings and store enhanced chunks
  for (const chunk of chunks) {
    const embedding = await generateEmbedding(chunk.content);

    await supabase.from('document_chunks').insert({
      document_id: document.id,
      content: chunk.content,
      embedding: JSON.stringify(embedding),
      page_number: chunk.pageNumber,
      chunk_index: chunk.chunkIndex,
      element_type: chunk.elementType,
      section_title: chunk.sectionTitle,
      is_table: chunk.isTable,
      table_html: chunk.tableHtml,
      bbox: chunk.bbox,
      confidence: chunk.confidence,
      metadata: chunk.metadata,
    });
  }

  // ... response ...
}
```

### Phase 5: Testing & Validation (Week 3)

#### 5.1 Test Script

**File: `scripts/test-enhanced-parsing.ts`**
```typescript
import { parseDocument } from '../nextjs_space/lib/document-parser';
import { chunkParsedDocument } from '../nextjs_space/lib/document-chunker';
import fs from 'fs';
import path from 'path';

async function testParsing() {
  const testDoc = path.join(__dirname, '../documents/Federal-Decree-Law-No-60-of-2023.pdf');
  const buffer = fs.readFileSync(testDoc);

  console.log('='.repeat(80));
  console.log('ENHANCED DOCUMENT PARSING TEST');
  console.log('='.repeat(80));

  // Test each parser
  for (const parser of ['docling', 'llamaparse', 'unpdf']) {
    console.log(`\n--- Testing ${parser} ---`);

    try {
      const start = Date.now();
      const parsed = await parseDocument(buffer, 'test.pdf', {
        // Force specific parser for testing
      });
      const parseTime = Date.now() - start;

      console.log(`✓ Parser: ${parsed.parser}`);
      console.log(`  Pages: ${parsed.totalPages}`);
      console.log(`  Tables found: ${parsed.tableCount}`);
      console.log(`  OCR applied: ${parsed.ocrApplied}`);
      console.log(`  Parse time: ${parseTime}ms`);

      // Chunk and analyze
      const chunks = await chunkParsedDocument(parsed);
      console.log(`  Total chunks: ${chunks.length}`);
      console.log(`  Table chunks: ${chunks.filter(c => c.isTable).length}`);
      console.log(`  Chunks with sections: ${chunks.filter(c => c.sectionTitle).length}`);

    } catch (error) {
      console.error(`✗ ${parser} failed:`, error);
    }
  }
}

testParsing();
```

---

## Architecture Documentation Updates

### Files to Update

1. **`RECOMMENDED_ARCHITECTURE.md`**
   - Add document parsing layer to architecture diagram
   - Update "Current Stack" section to include Docling
   - Add new Phase 1.5: Document Parsing Enhancement

2. **`CLAUDE.md`**
   - Update "Key Files" section to include new parser modules
   - Add document parsing commands to "Common Commands"
   - Update "RAG Specifics" with new metadata fields

3. **New File: `DOCUMENT_PARSING.md`**
   - Complete reference for document parsing system
   - API documentation for Docling service
   - Metadata schema reference

---

## Cost Analysis

### One-Time Setup Costs

| Item | Cost | Notes |
|------|------|-------|
| Docling Docker setup | $0 | Self-hosted, MIT license |
| Database migrations | $0 | Supabase included |
| Development time | ~40 hours | Implementation + testing |

### Ongoing Costs (Monthly)

| Scenario | Docling (Self-hosted) | LlamaParse (API) |
|----------|----------------------|------------------|
| 1,000 pages/month | ~$5 (compute) | $30-$300 |
| 10,000 pages/month | ~$10 (compute) | $300-$3,000 |
| 100,000 pages/month | ~$50 (compute) | $3,000-$30,000 |

**Recommendation:** Use Docling self-hosted for cost efficiency at scale.

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Docling service unavailable | Medium | High | LlamaParse + unpdf fallback |
| Table extraction inaccuracy | Low | Medium | Manual review for critical tables |
| OCR quality issues | Medium | Medium | Multiple OCR engine support |
| Migration data loss | Low | High | Incremental migration with backups |

### Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Increased processing time | Medium | Low | Background processing with n8n |
| Storage increase (table HTML) | High | Low | Compression, selective storage |
| Python service maintenance | Medium | Medium | Docker containerization |

---

## Timeline Summary

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1 | Docling Service Setup | Docker service, health checks, basic API |
| 1-2 | Node.js Integration | Parser module, chunker module, fallback chain |
| 2 | Database Migrations | Schema updates, search functions, indexes |
| 2-3 | Upload Route Integration | End-to-end document processing |
| 3 | Testing & Validation | Test scripts, quality metrics, documentation |

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Table extraction accuracy | 0% | >90% |
| OCR document support | No | Yes |
| Metadata fields per chunk | 2 | 8+ |
| RAG groundedness (tables) | N/A | >85% |
| Processing time (50 pages) | <5s | <60s |

---

## Next Steps

1. **Approve this plan** - Review and confirm approach
2. **Set up Docling service** - Docker environment
3. **Apply database migrations** - Schema updates
4. **Implement parser module** - TypeScript integration
5. **Update upload route** - End-to-end integration
6. **Run test suite** - Validate quality improvements
7. **Update architecture docs** - Reflect new system
