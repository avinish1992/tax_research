# Next Iteration Features: Priority Roadmap

> Last Updated: December 2025

## Executive Summary

Based on competitive analysis, VC-validated pain points, workflow research, and our current platform capabilities, this document defines the features to build in the next iteration to maximize user value and market differentiation.

---

## Current State Assessment

### What We Have (Working)
- [x] Document upload and processing
- [x] RAG-based Q&A with citations
- [x] Basic chat interface
- [x] User authentication
- [x] PostgreSQL with pgvector

### What Needs Improvement
- [ ] Query accuracy and relevance
- [ ] Citation quality and formatting
- [ ] Response generation quality
- [ ] User experience polish
- [ ] Performance optimization

---

## Feature Priority Framework

| Priority | Criteria |
|----------|----------|
| **P0 - Critical** | Core value prop, blocks adoption, competitive table-stakes |
| **P1 - High** | Major differentiator, high user demand, good ROI |
| **P2 - Medium** | Nice-to-have, improves experience, future foundation |
| **P3 - Low** | Exploratory, low demand, complex to build |

---

## P0 Features: Next 4-6 Weeks

### 1. Research Memo Generation

**What:** Auto-generate professional tax research memos from Q&A sessions

**Why Critical:**
- 70-80% time savings on memo writing (2-4 hrs → 30 min)
- Differentiator vs. competitors (most only do Q&A)
- High-value output professionals can immediately use

**User Story:**
> "As a tax manager, I want to convert my research session into a formatted memo so I can document my file without rewriting everything."

**Specifications:**

| Component | Requirement |
|-----------|-------------|
| Input | Research Q&A session, optional user notes |
| Output | Formatted memo (PDF, Word, Markdown) |
| Sections | Facts, Issues, Analysis, Conclusion, Citations |
| Customization | Firm letterhead, tone selection |
| Citations | Auto-formatted (Bluebook/AGLC style) |

**Technical Approach:**
```
Research Session → Summary Prompt →
Claude Opus/Sonnet → Structured Output →
Template Engine → PDF/Word Generation
```

**Success Metrics:**
- 80% of research sessions convert to memos
- < 2 minutes generation time
- User edit rate < 20% (quality measure)

**Effort:** 2-3 weeks

---

### 2. Query Expansion & Tax Domain Enhancement

**What:** Improve RAG retrieval with tax-specific query understanding

**Why Critical:**
- Current retrieval misses relevant chunks
- Tax terminology requires domain knowledge
- Users expect AI to "understand" tax concepts

**User Story:**
> "As a tax preparer, I want the AI to understand that 'home office' means §280A so I get relevant results without specifying the code section."

**Specifications:**

| Component | Requirement |
|-----------|-------------|
| Query Expansion | Synonym mapping (deduct → deduction, deductible) |
| Section Inference | Concept → IRC section mapping |
| Multi-Query | Generate 3-5 query variations |
| Reranking | Cross-encoder for relevance scoring |

**Technical Approach:**
```
User Query → Query Understanding (LLM) →
[Expanded Query 1, Query 2, Query 3] →
Parallel Vector Search → RRF Fusion →
Cross-Encoder Rerank → Top-K Results
```

**Tax Concept Mapping (Examples):**
```json
{
  "home office": ["§280A", "home office deduction", "principal place of business"],
  "depreciation": ["§167", "§168", "MACRS", "bonus depreciation", "§179"],
  "meals": ["§274", "50% limitation", "business meals"],
  "S-corp": ["§1361", "S corporation", "pass-through", "shareholder"]
}
```

**Success Metrics:**
- Retrieval accuracy: 85% → 92%
- "No relevant results" rate: < 5%
- User satisfaction: > 4.5/5

**Effort:** 2-3 weeks

---

### 3. Citation Quality Enhancement

**What:** Improve citation extraction, formatting, and verification

**Why Critical:**
- Tax professionals need verifiable sources
- Current citations may be incomplete or malformed
- Trust is built through accurate references

**User Story:**
> "As a reviewer, I want every claim to have a proper citation so I can verify the research without additional work."

**Specifications:**

| Component | Requirement |
|-----------|-------------|
| Format | Proper legal citation format (e.g., IRC §162(a)(1)) |
| Extraction | Pull exact quotes from source documents |
| Verification | Link citations to source chunks |
| Display | Clickable references, hover preview |

**Citation Format Examples:**
```
✓ IRC §162(a)(1)
✓ Treas. Reg. §1.162-5(a)
✓ Rev. Rul. 2023-14
✓ Smith v. Commissioner, 155 T.C. 123 (2020)
✓ [Document Name], Page 5, "exact quote..."
```

**Technical Approach:**
- Citation extraction regex + LLM verification
- Source chunk linking in response
- Citation validation against known formats
- Hover preview with full context

**Success Metrics:**
- 100% of factual claims have citations
- < 5% citation format errors
- Click-through to source: > 30%

**Effort:** 1-2 weeks

---

### 4. Conversation Memory & Context

**What:** Maintain context across multi-turn research conversations

**Why Critical:**
- Tax research is iterative (follow-up questions)
- Users expect AI to remember earlier context
- Reduces repetition and improves UX

**User Story:**
> "As a tax manager, I want to ask follow-up questions without repeating the entire context so my research flow is natural."

**Specifications:**

| Component | Requirement |
|-----------|-------------|
| Session Memory | Maintain context within session |
| Entity Tracking | Remember client, entity type, tax year |
| Document Context | Know which docs are relevant |
| Conversation History | Reference earlier Q&As |

**Technical Approach:**
```
Current Query + Conversation History →
Context Summarization →
Relevant Memory Retrieval →
Augmented Query → RAG Search
```

**Example Flow:**
```
User: "What's the home office deduction for self-employed?"
AI: [Answer about §280A...]

User: "What if they're an employee?" ← Understands context
AI: [Answer about employee home office rules...]

User: "What documentation do they need?" ← Remembers topic
AI: [Documentation requirements for home office...]
```

**Success Metrics:**
- Context retention across 5+ turns
- < 10% "I don't understand the context" responses
- User session length: +50%

**Effort:** 2 weeks

---

## P1 Features: Weeks 6-12

### 5. Client/Matter Organization

**What:** Organize documents and research by client/matter

**Why Important:**
- Firms work on multiple clients simultaneously
- Research should be tied to specific matters
- Enables knowledge reuse across similar matters

**User Story:**
> "As a tax manager, I want to organize my research by client so I can easily find past work and maintain separate knowledge bases."

**Specifications:**

| Component | Requirement |
|-----------|-------------|
| Client Profiles | Name, entity type, industry, tax year |
| Matter Management | Group documents by engagement |
| Research History | View past Q&As by client |
| Search Scope | Filter research to specific client docs |

**Effort:** 2-3 weeks

---

### 6. Regulatory Alert System

**What:** Monitor and alert on tax law changes affecting users

**Why Important:**
- 80-90% time savings on compliance monitoring
- Proactive value (not just reactive research)
- Stickiness driver (daily engagement)

**User Story:**
> "As a tax director, I want to be notified when new IRS guidance affects my clients so I can advise them proactively."

**Specifications:**

| Component | Requirement |
|-----------|-------------|
| Sources | IRS.gov, Federal Register, state DOAs |
| Frequency | Daily monitoring |
| Matching | Alert based on client profiles |
| Delivery | Email digest, in-app notifications |
| Analysis | AI summary of impact |

**Effort:** 3-4 weeks

---

### 7. Document Auto-Classification

**What:** Automatically categorize uploaded documents

**Why Important:**
- Reduces manual organization
- Improves retrieval accuracy
- Better metadata for search

**User Story:**
> "As a preparer, I want uploaded documents automatically tagged by type so I don't have to manually organize everything."

**Specifications:**

| Component | Requirement |
|-----------|-------------|
| Classification | Contract, tax return, correspondence, IRS notice, etc. |
| Extraction | Key dates, parties, amounts |
| Tagging | Relevant tax topics |
| Confidence | Show classification confidence |

**Effort:** 2 weeks

---

### 8. Team Collaboration

**What:** Multi-user features for firm collaboration

**Why Important:**
- Firms have multiple users
- Research should be shareable
- Knowledge should be firm-wide

**User Story:**
> "As a partner, I want my team to share research so we don't duplicate work and can learn from each other."

**Specifications:**

| Component | Requirement |
|-----------|-------------|
| Team Workspaces | Shared document libraries |
| Research Sharing | Share Q&A sessions with team |
| Permissions | Role-based access control |
| Activity Feed | See team research activity |

**Effort:** 3-4 weeks

---

## P2 Features: Months 3-6

### 9. Integration: QuickBooks Online

**What:** Connect to QBO for client context

**Effort:** 4-6 weeks

### 10. Tax Position Confidence Scoring

**What:** Indicate audit risk level for positions

**Effort:** 4-6 weeks

### 11. Prior Year Comparison

**What:** Compare current return to prior year

**Effort:** 2-3 weeks

### 12. Client Portal

**What:** Client-facing document upload and status

**Effort:** 4-6 weeks

---

## P3 Features: Future Consideration

### 13. Voice Input
Research via voice for hands-free operation

### 14. Mobile App
Native iOS/Android apps

### 15. Tax Planning Scenarios
Multi-year projection and planning

### 16. Audit Defense Package
Compile documentation for IRS audits

---

## Implementation Roadmap

### Phase 1: Core Enhancement (Weeks 1-6)

```
Week 1-2: Query Expansion + Domain Enhancement
Week 2-3: Citation Quality Enhancement
Week 3-4: Conversation Memory
Week 4-6: Research Memo Generation
```

**Deliverable:** Significantly improved research experience

### Phase 2: Organization & Alerts (Weeks 6-12)

```
Week 6-8: Client/Matter Organization
Week 8-10: Document Auto-Classification
Week 10-12: Regulatory Alert System (MVP)
```

**Deliverable:** Multi-client support + proactive value

### Phase 3: Collaboration & Integration (Weeks 12-20)

```
Week 12-15: Team Collaboration
Week 15-19: QuickBooks Integration
Week 19-20: Polish & Launch
```

**Deliverable:** Team-ready product with ecosystem integration

---

## Success Metrics by Phase

| Phase | Key Metric | Target |
|-------|------------|--------|
| Phase 1 | Research accuracy | 92%+ |
| Phase 1 | Memo generation usage | 50%+ of sessions |
| Phase 1 | NPS | 50+ |
| Phase 2 | Active clients organized | 80%+ |
| Phase 2 | Alert engagement | 60%+ open rate |
| Phase 3 | Team adoption | 3+ users/team avg |
| Phase 3 | Integration connection | 40%+ of users |

---

## Technical Dependencies

### For P0 Features

| Dependency | Current State | Action Needed |
|------------|---------------|---------------|
| Supabase Auth | In progress | Complete migration |
| pgvector optimization | Basic | Add HNSW index |
| Document processing | Working | Add table extraction |
| LLM prompts | Basic | Domain-specific tuning |

### For P1 Features

| Dependency | Current State | Action Needed |
|------------|---------------|---------------|
| Multi-tenancy | Not started | Add team/org model |
| Background jobs | Not started | Add n8n or similar |
| External data feeds | Not started | RSS/API integrations |

---

## Competitive Response

| If Competitor Does | We Respond With |
|--------------------|-----------------|
| Adds document RAG | Emphasize our depth + integrations |
| Lowers price | Emphasize research quality + memo gen |
| Adds memo generation | Emphasize citation quality + accuracy |
| Partners with accounting software | Accelerate our integrations |

---

## Summary: Top 4 Features for Next Iteration

| # | Feature | Impact | Effort | Priority |
|---|---------|--------|--------|----------|
| 1 | **Research Memo Generation** | Very High | 2-3 weeks | P0 |
| 2 | **Query Expansion + Domain** | Very High | 2-3 weeks | P0 |
| 3 | **Citation Enhancement** | High | 1-2 weeks | P0 |
| 4 | **Conversation Memory** | High | 2 weeks | P0 |

**Total Phase 1 Effort: 6-8 weeks**

After Phase 1, users will have:
- Significantly better research accuracy (85% → 92%)
- Auto-generated professional memos
- Proper legal citations
- Natural multi-turn conversations
