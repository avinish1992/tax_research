# Research Documentation

This folder contains comprehensive research and documentation for the Legal AI Assistant project.

## Structure

```
research/
├── README.md                              # This file
├── claude/                                # Claude Code configuration research
│   ├── CLAUDE_CODE_FEATURES.md           # Skills, hooks, commands, MCP
│   └── AUTONOMOUS_DEVELOPMENT.md         # SDLC mapping, agent patterns
│
├── architecture/                          # System Architecture (NEW)
│   ├── SYSTEM_ARCHITECTURE.md            # Complete system architecture
│   ├── COMPONENT_RESPONSIBILITIES.md      # Next.js vs Supabase vs n8n
│   ├── diagrams/
│   │   └── MERMAID_DIAGRAMS.md           # All Mermaid diagrams
│   ├── decisions/                         # Architecture Decision Records
│   └── migrations/
│       └── MIGRATION_PLAN.md             # Supabase migration plan
│
├── platform/                              # Tax & Legal Platform research
│   └── ...
│
└── application/                           # Application-specific research
    ├── architecture/
    │   └── RECOMMENDED_ARCHITECTURE.md    # Original architecture doc
    │
    ├── rag-frameworks/
    │   └── RAG_FRAMEWORKS_COMPARISON.md   # LangChain vs LlamaIndex
    │
    ├── memory-systems/
    │   └── MEMORY_SYSTEMS_RESEARCH.md     # Episodic, semantic, temporal
    │
    ├── infrastructure/
    │   └── INFRASTRUCTURE_OPTIONS.md      # Supabase, vector DBs, n8n
    │
    ├── integrations/
    │   └── INTEGRATIONS_GUIDE.md          # Composio, n8n, MCP, etc.
    │
    ├── n8n/
    │   └── N8N_CHAT_RAG_RESEARCH.md       # n8n workflow patterns
    │
    └── enhancements/
        └── ENHANCEMENT_ROADMAP.md         # Prioritized roadmap
```

## Quick Navigation

### Getting Started
1. Start with [RECOMMENDED_ARCHITECTURE.md](application/architecture/RECOMMENDED_ARCHITECTURE.md) for the big picture
2. Review [ENHANCEMENT_ROADMAP.md](application/enhancements/ENHANCEMENT_ROADMAP.md) for prioritized tasks
3. Check [AUTONOMOUS_DEVELOPMENT.md](claude/AUTONOMOUS_DEVELOPMENT.md) for Claude-assisted development

### Deep Dives

| Topic | Document | Key Insights |
|-------|----------|--------------|
| **System Architecture** | [SYSTEM_ARCHITECTURE.md](architecture/SYSTEM_ARCHITECTURE.md) | **NEW** - Complete Next.js + Supabase + n8n architecture |
| **Component Split** | [COMPONENT_RESPONSIBILITIES.md](architecture/COMPONENT_RESPONSIBILITIES.md) | **NEW** - What goes where and why |
| **Migration Plan** | [MIGRATION_PLAN.md](architecture/migrations/MIGRATION_PLAN.md) | **NEW** - Step-by-step Supabase migration |
| **Mermaid Diagrams** | [MERMAID_DIAGRAMS.md](architecture/diagrams/MERMAID_DIAGRAMS.md) | **NEW** - All architecture diagrams |
| **n8n Workflows** | [N8N_CHAT_RAG_RESEARCH.md](application/n8n/N8N_CHAT_RAG_RESEARCH.md) | n8n patterns for RAG |
| **Architecture (Legacy)** | [RECOMMENDED_ARCHITECTURE.md](application/architecture/RECOMMENDED_ARCHITECTURE.md) | Full stack with Supabase + LlamaIndex |
| **RAG Quality** | [RAG_FRAMEWORKS_COMPARISON.md](application/rag-frameworks/RAG_FRAMEWORKS_COMPARISON.md) | LlamaIndex for retrieval (92% accuracy) |
| **Memory** | [MEMORY_SYSTEMS_RESEARCH.md](application/memory-systems/MEMORY_SYSTEMS_RESEARCH.md) | Episodic, semantic, temporal patterns |
| **Infrastructure** | [INFRASTRUCTURE_OPTIONS.md](application/infrastructure/INFRASTRUCTURE_OPTIONS.md) | Supabase + Qdrant stack |
| **Integrations** | [INTEGRATIONS_GUIDE.md](application/integrations/INTEGRATIONS_GUIDE.md) | n8n, Composio, MCP setup |
| **Autonomous Dev** | [AUTONOMOUS_DEVELOPMENT.md](claude/AUTONOMOUS_DEVELOPMENT.md) | SDLC to Claude mapping |
| **Claude Features** | [CLAUDE_CODE_FEATURES.md](claude/CLAUDE_CODE_FEATURES.md) | Skills, hooks, commands |

---

## Key Recommendations

### Immediate Actions
1. **Migrate to Supabase** - Single platform for auth, DB, storage, vectors
2. **Integrate LlamaIndex** - 35% better retrieval accuracy
3. **Add Memory System** - Episodic + semantic memory
4. **Configure Claude Hooks** - Automated quality gates

### Architecture Stack
```
Frontend:     Next.js 14
Auth:         Supabase Auth
Database:     Supabase PostgreSQL + pgvector
Vectors:      Qdrant Cloud (for scale)
RAG:          LlamaIndex + LangGraph
Workflows:    n8n
Integrations: Composio
LLM:          Claude 3.5 Sonnet
```

### Cost Estimates
| Phase | Monthly Cost |
|-------|--------------|
| MVP | ~$95 |
| Scale | ~$215 |
| Production | ~$465 |

---

## Claude Code Configuration

### `.claude/` Structure
```
.claude/
├── CLAUDE.md                    # Main project context
├── settings.local.json          # Hooks and permissions
│
├── skills/                      # Auto-invoked capabilities
│   ├── legal-analyzer/          # Legal document analysis
│   ├── rag-optimizer/           # RAG debugging
│   ├── architecture-designer/   # System design
│   ├── test-generator/          # Test creation
│   └── security-reviewer/       # Security review
│
├── commands/                    # User-invoked prompts
│   ├── analyze-rag.md           # /analyze-rag [query]
│   ├── migrate-supabase.md      # /migrate-supabase
│   ├── add-memory.md            # /add-memory [type]
│   ├── implement.md             # /implement [feature]
│   ├── review.md                # /review [file]
│   ├── test.md                  # /test [file]
│   └── refactor.md              # /refactor [file]
│
├── rules/                       # Always-active standards
│   ├── typescript.md            # TypeScript patterns
│   ├── database.md              # Database patterns
│   ├── rag.md                   # RAG system rules
│   └── security.md              # Security requirements
│
└── scripts/                     # Hook scripts
    ├── pre-commit-check.sh      # Tests before commit
    ├── security_check.py        # Security validation
    └── post_edit.sh             # Auto-formatting
```

### Skills (Auto-invoked by Claude)
| Skill | Description | Triggers |
|-------|-------------|----------|
| `legal-analyzer` | Legal document analysis | Contract, legal document discussions |
| `rag-optimizer` | RAG debugging | Search quality issues |
| `architecture-designer` | System design | Feature planning, tech decisions |
| `test-generator` | Test creation | Test writing, coverage |
| `security-reviewer` | Security review | Security discussions, code review |

### Commands (User-invoked with `/`)
| Command | Description |
|---------|-------------|
| `/analyze-rag [query]` | Analyze retrieval quality |
| `/implement [feature]` | Implement a new feature |
| `/review [file]` | Code review |
| `/test [file]` | Generate tests |
| `/refactor [file]` | Refactor code |
| `/migrate-supabase` | Generate migration plan |
| `/add-memory [type]` | Add memory system |

### Hooks (Automatic on events)
| Event | Hook | Purpose |
|-------|------|---------|
| Pre git commit | `pre-commit-check.sh` | Run tests, type check |
| Pre Write/Edit | `security_check.py` | Block sensitive files |
| Post Write/Edit | `post_edit.sh` | Auto-format code |

---

## Autonomous Development Mapping

The SDLC is mapped to Claude Code features for efficient development:

| SDLC Phase | Claude Features | Key Components |
|------------|-----------------|----------------|
| **Planning** | Skills, Memory, CLAUDE.md | requirements-analyzer skill |
| **Design** | Subagents, Commands | architecture-designer skill, /design |
| **Implementation** | Skills, Rules | coding standards in rules/ |
| **Testing** | Hooks, Skills | test-generator skill, pre-commit hook |
| **Deployment** | Headless mode | CI/CD integration |
| **Maintenance** | Skills, Commands | bug-analyzer skill, /refactor |

### Best Practices from AI Agents Research

From Devin, SWE-agent, OpenHands, and Aider:

1. **Know When to Intervene** - Don't force failing interactions
2. **Diversify Your Bets** - Not all agent runs succeed
3. **Block-at-Commit Strategy** - Let agent work, gate at commit
4. **Agent-Computer Interface** - Good UX for agents too
5. **Git Integration** - Automatic meaningful commits

---

## Sources

All research is backed by current (2025) sources:

### RAG & AI Frameworks
- [LangChain vs LlamaIndex - Latenode](https://latenode.com/blog/langchain-vs-llamaindex-2025)
- [LlamaIndex vs LangChain - IBM](https://www.ibm.com/think/topics/llamaindex-vs-langchain)
- [LangChain vs LangGraph vs LlamaIndex - Xenoss](https://xenoss.io/blog/langchain-langgraph-llamaindex-llm-frameworks)

### Infrastructure
- [Supabase AI & Vectors](https://supabase.com/docs/guides/ai)
- [Vector DB Comparison - LiquidMetal](https://liquidmetal.ai/casesAndBlogs/vector-comparison/)
- [Best Vector Databases 2025 - Firecrawl](https://www.firecrawl.dev/blog/best-vector-databases-2025)

### Integrations
- [n8n RAG Documentation](https://docs.n8n.io/advanced-ai/rag-in-n8n/)
- [Composio GitHub](https://github.com/ComposioHQ/composio)

### Memory Systems
- [AI Agent Memory - IBM](https://www.ibm.com/think/topics/ai-agent-memory)
- [Memoria Framework - arXiv](https://arxiv.org/html/2512.12686)
- [MIRIX Multi-Agent Memory - arXiv](https://arxiv.org/html/2507.07957v1)

### Claude Code & Autonomous Development
- [Claude Code Best Practices - Anthropic](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [Understanding Claude Code Full Stack - alexop.dev](https://alexop.dev/posts/understanding-claude-code-full-stack/)
- [awesome-claude-code - GitHub](https://github.com/hesreallyhim/awesome-claude-code)
- [claude-code-hooks-mastery - GitHub](https://github.com/disler/claude-code-hooks-mastery)

### AI Coding Agents
- [Coding Agents 101 - Devin](https://devin.ai/agents101)
- [OpenHands - GitHub](https://github.com/OpenHands/OpenHands)
- [SWE-agent - GitHub](https://github.com/princeton-nlp/SWE-agent)
- [Agent Development Lifecycle - Sierra](https://sierra.ai/blog/agent-development-life-cycle)
- [AI Agents in SDLC - Sonar](https://www.sonarsource.com/resources/library/ai-agents-in-sdlc/)

---

## Updating This Research

When adding new research:
1. Create appropriate subfolder if needed
2. Use consistent markdown formatting
3. Include sources with links
4. Add to this README
5. Update CLAUDE.md references if relevant
6. Update skills/commands if adding new capabilities
