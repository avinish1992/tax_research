# Claude Code Features Research

## Overview

This document covers all Claude Code features that can accelerate development of the Legal AI Assistant.

---

## 1. Agent Skills

### What They Are
Agent Skills are modular capabilities that extend Claude's functionality. Unlike slash commands (user-invoked), Skills are **model-invoked** - Claude autonomously decides when to use them based on context.

### Storage Locations
```
Personal Skills:     ~/.claude/skills/skill-name/SKILL.md
Project Skills:      ./.claude/skills/skill-name/SKILL.md
```

### Example Skill Structure
```markdown
---
name: legal-document-analysis
description: Analyze legal documents for contract terms, liability clauses, and risk factors. Use when reviewing legal contracts, agreements, or documents.
---

# Legal Document Analysis Skill

## Instructions
1. Identify document type (contract, agreement, disclosure, etc.)
2. Extract key clauses and terms
3. Flag potential liability exposure
4. Summarize key dates and obligations
5. List required signatures or approvals
```

### Best Practices
- Keep descriptions specific (what it does AND when to use)
- Single-responsibility Skills
- Add supporting files for complex capabilities
- Share project Skills via git

---

## 2. Hooks

### What They Are
Hooks are shell commands that execute automatically at specific points in Claude's workflow. They provide deterministic, enforceable behavior.

### Available Hook Events
| Event | Trigger |
|-------|---------|
| `PreToolUse` | Before Claude calls a tool (can block) |
| `PostToolUse` | After tools complete |
| `PermissionRequest` | When asking for permissions |
| `UserPromptSubmit` | When you submit a prompt |
| `Notification` | When Claude sends notifications |
| `Stop` | When Claude finishes responding |
| `SessionStart/SessionEnd` | At session boundaries |

### Configuration
Use `/hooks` command or edit `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "prettier --write $FILE_PATH"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 check_sensitive_files.py"
          }
        ]
      }
    ]
  }
}
```

### Use Cases for Legal AI
- Auto-format code after edits
- Block edits to sensitive files (.env, credentials)
- Run linters on save
- Validate API schemas
- Security scanning

---

## 3. .claude Files and CLAUDE.md

### Hierarchy
| Location | Purpose | Scope |
|----------|---------|-------|
| `./CLAUDE.md` or `./.claude/CLAUDE.md` | Project-wide instructions | Team (git) |
| `~/.claude/CLAUDE.md` | Personal preferences | Private |
| `./.claude/CLAUDE.local.md` | Personal project-specific | Private |
| `./.claude/rules/*.md` | Modular topic rules | Team |

### CLAUDE.md Structure
```markdown
# Project Documentation

## Project Overview
Legal AI Assistant - RAG-based document Q&A system

## Architecture
- Next.js 14 App Router
- PostgreSQL + pgvector
- Supabase for auth
- LlamaIndex for RAG

## Coding Standards
- TypeScript strict mode
- Zod validation
- Prisma ORM patterns

## Common Commands
Build: `npm run build`
Test: `npm test`
Deploy: `npm run deploy`

## Domain Knowledge
Key legal document types:
- Service Agreements (SLAs)
- Non-Disclosure Agreements (NDAs)
- Software Licenses
```

### Path-Specific Rules
`.claude/rules/python.md`:
```markdown
---
paths: **/*.py
---
# Python Standards
- Type hints required
- Google-style docstrings
- pytest for tests
```

---

## 4. Custom Slash Commands

### Storage
```bash
# Project command
.claude/commands/command-name.md

# Personal command
~/.claude/commands/command-name.md
```

### Command with Arguments
```markdown
---
argument-hint: [document-type] [jurisdiction]
description: Generate a legal review template
---

Generate a legal review template for $1 documents under $2 jurisdiction.
```

Usage: `/review-template service-agreement california`

### Frontmatter Options
```markdown
---
name: analyze-contract
description: Analyze uploaded contract
allowed-tools: Read, Grep, Glob, Bash
model: claude-3-5-sonnet-20241022
argument-hint: [file-path]
---
```

---

## 5. MCP (Model Context Protocol) Servers

### What They Are
MCP connects Claude Code to external tools, databases, and APIs.

### Adding Servers
```bash
# HTTP remote server
claude mcp add --transport http github https://api.github.com/mcp/

# Local stdio server
claude mcp add --transport stdio postgresql \
  --env DB_URL=postgresql://... \
  -- npx -y @bytebase/dbhub

# With authentication
claude mcp add --transport http stripe https://mcp.stripe.com \
  --header "Authorization: Bearer token"
```

### Scope Levels
- `local` (default): Private to you in this project
- `project`: Shared via .mcp.json
- `user`: Available across all projects

### Management
```bash
claude mcp list      # List servers
claude mcp get name  # Get details
claude mcp remove    # Remove server
/mcp                 # In-session management
```

---

## 6. Subagents

### Creating Specialized Agents
```markdown
---
name: legal-reviewer
description: Expert legal contract reviewer
tools: Read, Grep, Glob
model: opus
---

You are a senior legal contract reviewer.

When invoked:
1. Identify contract type
2. Extract critical terms
3. Flag liability clauses
4. Highlight jurisdiction requirements
5. Assess termination conditions
```

---

## 7. Output Styles

### Custom Output Style
```markdown
---
name: Legal Assistant Mode
description: Optimized for legal analysis
keep-coding-instructions: true
---

## Response Format
- Use clear legal terminology
- Highlight risks
- Cite relevant clauses
- Structure by priority
- Include recommendations
```

---

## 8. Extended Thinking

Enable for complex analysis:
```bash
/config  # Toggle thinking mode

# Per-request
> ultrathink: Analyze contract implications
```

---

## 9. Memory Management

```bash
/memory   # Edit CLAUDE.md files
/context  # View context usage

# Quick memory
> #remember: Always validate contract dates
```

---

## Recommended Configuration for Legal AI

### Skills to Create
1. `contract-analyzer` - Analyze contracts
2. `compliance-checker` - Check legal compliance
3. `document-classifier` - Classify document types
4. `citation-extractor` - Extract legal citations

### Commands to Create
1. `/analyze-contract [file]` - Full contract analysis
2. `/check-compliance` - Compliance checklist
3. `/summarize-document` - Quick summary
4. `/extract-clauses` - Pull key clauses

### Hooks to Configure
1. PostToolUse: Format code after edits
2. PreToolUse: Block sensitive file access
3. Stop: Log all changes made

### MCP Servers to Consider
1. PostgreSQL connector for direct DB access
2. S3 connector for document management
3. GitHub for version control integration
