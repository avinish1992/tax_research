# Chatbot UI Research: Frameworks for Search, Retrieval, Ranking & Query Answering

> **Research Date:** December 2025
> **Purpose:** Evaluate best-in-class chatbot UI frameworks, patterns, and components for RAG-based applications

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current System Analysis](#current-system-analysis)
3. [Leading UI Frameworks](#leading-ui-frameworks)
4. [RAG-Specific UI Patterns](#rag-specific-ui-patterns)
5. [Search & Retrieval UI Best Practices](#search--retrieval-ui-best-practices)
6. [Citation & Sources Design](#citation--sources-design)
7. [Framework Recommendations](#framework-recommendations)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

This research evaluates chatbot UI frameworks optimized for RAG (Retrieval Augmented Generation) applications with focus on:
- **Search & Retrieval**: Hybrid search UI patterns combining semantic and keyword approaches
- **Ranking**: Result presentation and ranking visualization
- **Query Answering**: Citation-forward answer presentation
- **User Experience**: Streaming, markdown rendering, source attribution

### Key Findings

| Category | Top Recommendations |
|----------|---------------------|
| **React Component Libraries** | Vercel AI SDK Elements, LlamaIndex Chat-UI, shadcn-chatbot-kit |
| **Python Frameworks** | Chainlit (best for LLM apps), Streamlit (general purpose) |
| **Agentic Frontends** | CopilotKit with AG-UI Protocol |
| **Self-Hosted Solutions** | Open WebUI, Verba (Weaviate) |
| **Citation Patterns** | Perplexity-style numbered citations with expandable sources |

---

## Current System Analysis

### Existing Architecture

The current implementation uses:
- **UI Framework**: shadcn/ui with Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables theming
- **Chat Interface**: Custom implementation in `app/dashboard/chat/page.tsx` (1,127 lines)
- **Citations**: Inline numbered citations with renumbering logic
- **Source Panel**: Right sidebar with PDF preview capability

### Current Strengths
- Enterprise-style citation rendering with hover effects
- Document selection for scoping RAG queries
- SSE streaming for real-time responses
- PDF preview with signed URL support

### Areas for Improvement
- Citation renumbering logic on frontend (redundant work)
- No standardized message component library
- Limited markdown rendering customization
- Sidebar/panel state not persisted across sessions

---

## Leading UI Frameworks

### 1. Vercel AI SDK + AI Elements

**Overview**: The leading TypeScript toolkit for AI applications with 20M+ monthly downloads.

**Key Features**:
- `useChat` and `useCompletion` React hooks for state management
- AI Elements: 20+ production-ready React components
- Streaming-optimized markdown renderer
- Tool execution displays
- Collapsible AI reasoning panels
- Built on shadcn/ui foundation

**Components**:
```typescript
// Example usage with AI SDK
import { useChat } from '@ai-sdk/react';
import { ChatSection, ChatMessage } from '@llamaindex/chat-ui';
```

**Best For**: Production React/Next.js applications requiring streaming, tool calls, and flexible UI.

**Resources**:
- [AI SDK Documentation](https://ai-sdk.dev/docs/introduction)
- [AI Elements](https://vercel.com/changelog/introducing-ai-elements)
- [Next.js AI Chatbot Template](https://vercel.com/templates/next.js/nextjs-ai-chatbot)

---

### 2. LlamaIndex Chat-UI (@llamaindex/chat-ui)

**Overview**: React component library specifically designed for LLM chat interfaces.

**Key Features**:
- Pre-built chat components (message bubbles, input fields)
- Minimal styling, fully customizable with Tailwind CSS
- Custom widgets for document rendering
- TypeScript support
- Code and LaTeX styling with highlight.js and KaTeX
- Easy integration with Vercel AI SDK

**Installation**:
```bash
# Quick install via shadcn CLI
npx shadcn@latest add https://ui.llamaindex.ai/r/chat.json

# Or npm
npm install @llamaindex/chat-ui
```

**Core Components**:
- `ChatSection` - Root component with context/layout
- `ChatMessage` - Individual messages with avatar, content, actions
- `ChatInput` - Enhanced input with toolbar

**Best For**: Teams already using LlamaIndex for RAG who want consistent UI integration.

**Resources**:
- [LlamaIndex Chat UI Documentation](https://ui.llamaindex.ai/)
- [GitHub Repository](https://github.com/run-llama/chat-ui)
- [Core Components Guide](https://ts.llamaindex.ai/docs/chat-ui/core-components)

---

### 3. Blazity shadcn-chatbot-kit

**Overview**: Open-source chatbot UI kit built on shadcn/ui ecosystem.

**Key Features**:
- High-quality, reusable React components
- Rich interactions (file attachments, markdown, tool invocations)
- GitHub Flavored Markdown support via react-markdown
- Syntax highlighting with remark-gfm
- Optimized streaming with memoization
- Smart scroll management during streaming

**Streaming Performance**:
- Handles character-by-character updates efficiently
- Detects user scroll intent and temporarily disables auto-scroll
- Memoized state updates prevent re-render issues

**Best For**: Teams using shadcn/ui wanting drop-in chat components.

**Resources**:
- [GitHub Repository](https://github.com/Blazity/shadcn-chatbot-kit)

---

### 4. Chainlit (Python)

**Overview**: Python framework specifically for conversational AI applications, now community-maintained (as of May 2025).

**Key Features**:
- Built-in chat features (typing indicators, streaming, markdown/code rendering)
- Deep integrations with LangChain, LlamaIndex, Haystack
- Intermediate step visualization for debugging
- Works with any LLM provider
- Enterprise features via Literal AI

**Use Case Alignment**:
- Ideal when chatbot is central to the prototype
- Handles boilerplate: typing indicators, message streaming, code rendering
- Excellent for visualizing RAG pipeline steps

**Comparison with Streamlit**:
| Feature | Chainlit | Streamlit |
|---------|----------|-----------|
| **Focus** | Conversational AI | General data apps |
| **Chat UI** | Native, optimized | Added via components |
| **LLM Integrations** | Deep (LangChain, LlamaIndex) | Manual |
| **Customization** | Backend + UI flexibility | Limited styling |
| **Debugging** | LLM thought visualization | Standard |

**Best For**: Python-first teams building conversational AI prototypes.

**Resources**:
- [Chainlit Documentation](https://chainlit.io/)
- [GitHub Repository](https://github.com/Chainlit/chainlit)

---

### 5. CopilotKit + AG-UI Protocol

**Overview**: React UI framework for AI Copilots with the AG-UI (Agent User Interaction) Protocol.

**Key Features**:
- `useAgent` hook for controlling any AG-UI agent
- Shared state between frontend and backend agent
- Human-in-the-loop: supervise, approve, correct agent actions
- Frontend Tools: agents can interact with UI (fill forms, navigate, annotate)
- Integrations: LangGraph, CrewAI, Mastra, Pydantic AI, LlamaIndex

**AG-UI Protocol**:
- Open-source, lightweight, event-based protocol
- Real-time interactions between frontend and agent backends
- JSON-encoded events: messages, tool calls, state updates, lifecycle signals
- Transport agnostic: HTTP, WebSockets, WebRTC

**Adoption Stats**:
- JavaScript: ~179K weekly npm downloads
- Python: ~619K weekly PyPI downloads

**Best For**: Building agentic frontends where AI agents need deep UI integration.

**Resources**:
- [CopilotKit GitHub](https://github.com/CopilotKit/CopilotKit)
- [AG-UI Protocol](https://www.copilotkit.ai/ag-ui)
- [LlamaIndex AG-UI Integration](https://www.llamaindex.ai/blog/announcing-easy-agentic-frontends-with-ag-ui-and-copilotkit)

---

### 6. Open WebUI (Self-Hosted)

**Overview**: Extensible, self-hosted AI interface supporting Ollama and OpenAI-compatible APIs.

**Key Features**:
- Model Builder for creating custom agents
- Local RAG with 9 vector database options
- Content extraction: Tika, Docling, Document Intelligence, Mistral OCR
- Persistent artifact storage (journals, trackers, collaborative tools)
- Pipelines Plugin Framework for custom logic
- Progressive Web App with offline access
- Cloud storage: S3, GCS, Azure Blob
- Enterprise imports: Google Drive, OneDrive/SharePoint

**Deployment**:
```bash
# Docker
docker run -d -p 3000:8080 --name open-webui ghcr.io/open-webui/open-webui:main

# Kubernetes
helm install open-webui open-webui/open-webui
```

**Best For**: Self-hosted deployments requiring full control and privacy.

**Resources**:
- [Open WebUI](https://openwebui.com/)
- [GitHub Repository](https://github.com/open-webui/open-webui)
- [Features Documentation](https://docs.openwebui.com/features/)

---

## RAG-Specific UI Patterns

### Visual RAG Frameworks

#### Flowise
- Open-source, drag-and-drop UI for LLM pipelines
- Visual, node-based editor for creating RAG flows
- Excellent for rapid prototyping
- Wide range of pre-built integrations

#### Verba (Weaviate)
- RAG chatbot with conversational UI
- Autocomplete suggestions
- Easy file upload for varied types
- Modular architecture for customizing embeddings/retrieval
- Hybrid search: semantic + keyword

#### RAGFlow
- Visual and user-friendly RAG framework
- Open-source with intuitive interface

---

### Enterprise RAG Platforms

| Platform | Key Strength | Best For |
|----------|--------------|----------|
| **Haystack (deepset)** | Production-grade pipelines | Enterprise RAG at scale |
| **LangChain** | Ecosystem & flexibility | Complex agent workflows |
| **LlamaIndex** | Document understanding | Knowledge-heavy applications |
| **Cohere** | Fine-tuning & privacy | Enterprise with VPC needs |
| **IBM watsonx** | Governance & guardrails | Regulated industries |

---

## Search & Retrieval UI Best Practices

### Hybrid Search UI Patterns

**2025 Trend**: Combine semantic understanding with keyword precision.

```
User Query → [Semantic Search] + [Keyword Search]
                    ↓                    ↓
              Meaning-based         Exact matches
                    ↓                    ↓
                   RRF Fusion (k=60)
                         ↓
                  Ranked Results
```

**UI Best Practices**:

1. **Highlight Keywords in Results**
   - Bold matched terms in snippets
   - Show relevance indicators

2. **Clear Headings & Snippets**
   - Structured result cards
   - Source metadata (file, page, confidence)

3. **Visual Hierarchy**
   - Consistent typography
   - Whitespace for scannability
   - Grouping for large result sets

4. **Filters & Sorting**
   - Match user goals (date, relevance, source)
   - Quick filter chips
   - Clear filter state indicators

5. **Zero-State Handling**
   - Thoughtful empty states
   - Alternative suggestions
   - Query refinement hints

### Search Box 2025 Patterns

> "In the age of ambient AI, chatbots, and voice-first interfaces, the search box remains one of the most-used UI elements." — Design Monks

**Key Patterns**:
- **Autocomplete**: Predictive suggestions as user types
- **Recent Searches**: Quick access to history
- **Semantic Hints**: "Did you mean..." for similar concepts
- **Scope Indicators**: Show which documents/collections are being searched
- **Voice Input**: Support for voice-to-text queries

---

## Citation & Sources Design

### Perplexity-Style Citation Pattern

**The Gold Standard**: Perplexity AI pioneered citation-forward answer engines.

**Design Principles**:

1. **Inline Numbered Citations**
   ```
   The tax code requires filing by April 15[1], unless an
   extension is requested[2]. Extensions provide 6 additional
   months[2] but don't extend payment deadlines[3].
   ```

2. **Expandable Sources Panel**
   - Numbered references matching inline citations
   - Click to expand with preview
   - Direct link to source document

3. **Source Limiting**
   - Present top 3-5 high-confidence sources
   - Prevents overwhelming users
   - Quality over quantity

4. **Interactive Previews**
   - Hover to see title + snippet
   - Page number for long documents
   - Confidence/similarity score (optional)

### Citation UI Implementation

```typescript
interface CitationSource {
  index: number;           // Display number [1], [2], etc.
  fileName: string;        // Source document name
  pageNumber?: number;     // Specific page reference
  content: string;         // Excerpt (500 chars)
  similarity: number;      // Relevance score
  documentId: string;      // Internal reference
  fileUrl: string;         // Signed URL for preview
}
```

**Backend Requirements**:
- RAG system retrieves documents with metadata
- LLM prompted to include citation markers
- Metadata passed: title, URL, snippets
- Frameworks: LangChain and LlamaIndex provide citation management tools

### ChatGPT vs Perplexity Comparison

| Aspect | Perplexity | ChatGPT |
|--------|------------|---------|
| **Default Behavior** | Always cites sources | Decides per query |
| **UI Style** | Search-like, concise | Conversational, narrative |
| **Source Panel** | Always visible | Collapsible/conditional |
| **Primary Use** | Research, fact-finding | Creative, general |
| **Citation Density** | High | Variable |

---

## Framework Recommendations

### For Your Legal AI Assistant

Based on your current architecture (Next.js 14, shadcn/ui, Supabase migration), here are prioritized recommendations:

#### Tier 1: Immediate Adoption

1. **Vercel AI SDK Elements**
   - Native shadcn/ui integration
   - Streaming-optimized components
   - Drop-in replacement for custom chat UI
   - Active development (AI SDK 6 in 2025)

2. **LlamaIndex Chat-UI**
   - Already planning LlamaIndex integration per CLAUDE.md
   - Consistent with RAG framework choice
   - Simple shadcn CLI installation

#### Tier 2: Enhanced Features

3. **CopilotKit for Agentic Features**
   - When adding agent capabilities
   - Human-in-the-loop approvals
   - Frontend tool interactions

4. **Perplexity-Style Citations**
   - Implement citation-forward design
   - Top 3-5 sources with previews
   - Interactive hover states

#### Tier 3: Future Consideration

5. **AG-UI Protocol Adoption**
   - For multi-agent orchestration
   - Real-time bidirectional updates
   - Cross-framework compatibility

---

## Implementation Roadmap

### Phase 1: Component Migration (Week 1-2)

**Goal**: Replace custom chat UI with standardized components

1. **Install LlamaIndex Chat-UI**
   ```bash
   npx shadcn@latest add https://ui.llamaindex.ai/r/chat.json
   ```

2. **Migrate Chat Interface**
   - Replace custom `ChatMessage` with `@llamaindex/chat-ui`
   - Integrate with existing `useChat` patterns
   - Preserve citation functionality

3. **Enhance Markdown Rendering**
   - Add GFM tables and task lists
   - Syntax highlighting for code blocks
   - LaTeX support for formulas

### Phase 2: Citation UX Enhancement (Week 2-3)

**Goal**: Perplexity-style citation experience

1. **Citation Redesign**
   - Move renumbering logic to backend
   - Implement hover previews
   - Add source confidence indicators

2. **Sources Panel Upgrade**
   - Collapsible source cards
   - Quick navigation to PDF page
   - Similarity score visualization

### Phase 3: Search Experience (Week 3-4)

**Goal**: Enhanced hybrid search UI

1. **Query Interface**
   - Autocomplete with suggestions
   - Document scope indicators
   - Recent search history

2. **Results Presentation**
   - Highlighted keyword matches
   - Grouped by document
   - Filter chips for refinement

### Phase 4: Agentic Features (Future)

**Goal**: Agent-powered interactions

1. **CopilotKit Integration**
   - Install and configure `useAgent` hook
   - Define frontend tools for UI interactions

2. **Human-in-the-Loop**
   - Approval workflows for sensitive actions
   - Correction interface for agent outputs

---

## Technical Reference

### Recommended Package Versions (December 2025)

```json
{
  "dependencies": {
    "@ai-sdk/react": "^1.0.0",
    "@llamaindex/chat-ui": "^0.2.0",
    "@copilotkit/react-core": "^1.50.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "rehype-highlight": "^7.0.0"
  }
}
```

### Key Hooks Reference

```typescript
// Vercel AI SDK
import { useChat, useCompletion } from '@ai-sdk/react';

// LlamaIndex Chat-UI
import { ChatSection, ChatMessage, ChatInput } from '@llamaindex/chat-ui';

// CopilotKit
import { useAgent, useCopilotAction } from '@copilotkit/react-core';
```

---

## Resources & References

### Documentation
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction)
- [LlamaIndex Chat-UI](https://ui.llamaindex.ai/)
- [CopilotKit](https://www.copilotkit.ai/)
- [Open WebUI](https://docs.openwebui.com/)
- [Chainlit](https://chainlit.io/)

### Design Patterns
- [ShapeofAI - Citation Patterns](https://www.shapeof.ai/patterns/citations)
- [Search UX Best Practices 2025](https://www.designmonks.co/blog/search-ux-best-practices)
- [Perplexity Platform Guide](https://www.unusual.ai/blog/perplexity-platform-guide-design-for-citation-forward-answers)

### Comparisons
- [RAG Frameworks Comparison 2025](https://pathway.com/rag-frameworks/)
- [Best Open Source RAG Frameworks](https://apidog.com/blog/best-open-source-rag-frameworks/)
- [Streamlit vs Gradio vs Chainlit](https://markaicode.com/streamlit-vs-gradio-vs-chainlit-llm-ui-framework/)

---

*Research compiled for the Legal AI Assistant project. Last updated: December 2025*
