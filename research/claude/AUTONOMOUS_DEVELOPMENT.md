# Autonomous Development with Claude Code

## Overview

This document maps the Software Development Lifecycle (SDLC) to Claude Code features, enabling efficient autonomous development. It draws from research on AI coding agents like Devin, SWE-agent, OpenHands, and Aider.

---

## The Agent Development Lifecycle (ADLC)

Traditional SDLC provides structured phases for building applications. The Agent Development Lifecycle (ADLC) adapts this for autonomous AI development:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AGENT DEVELOPMENT LIFECYCLE                       │
│                                                                      │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐            │
│  │ PLAN    │ → │ BUILD   │ → │ TEST    │ → │ DEPLOY  │            │
│  │         │   │         │   │         │   │         │            │
│  │ Skills  │   │ Skills  │   │ Hooks   │   │ Hooks   │            │
│  │ Memory  │   │ Rules   │   │ Skills  │   │ CI/CD   │            │
│  │ Context │   │ Commands│   │ Headless│   │ Headless│            │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘            │
│       │             │             │             │                   │
│       └─────────────┴─────────────┴─────────────┘                   │
│                          │                                          │
│                    ┌─────▼─────┐                                    │
│                    │  OBSERVE  │                                    │
│                    │  & LEARN  │                                    │
│                    └───────────┘                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## SDLC to Claude Features Mapping

### Phase 1: Planning & Requirements

| SDLC Activity | Claude Feature | Implementation |
|---------------|----------------|----------------|
| Requirements gathering | Skills | Domain-specific requirements skill |
| Architecture design | Subagents | Plan agent with architecture focus |
| Task breakdown | CLAUDE.md | Project structure documentation |
| Estimation | Commands | `/estimate [feature]` command |

**Skill: Requirements Analyzer**
```markdown
---
name: requirements-analyzer
description: Analyze and structure requirements. Use when discussing features, user stories, or project scope.
---

# Requirements Analysis

## Process
1. Extract user needs from conversation
2. Identify functional requirements
3. Identify non-functional requirements
4. Map to existing architecture
5. Flag dependencies and risks

## Output Format
- User Story: As a [user], I want [feature] so that [benefit]
- Acceptance Criteria: Given/When/Then format
- Technical Requirements: Implementation notes
- Dependencies: Related systems/features
```

### Phase 2: Design & Architecture

| SDLC Activity | Claude Feature | Implementation |
|---------------|----------------|----------------|
| System design | Subagents | Architecture agent |
| API design | Skills | API design skill |
| Database design | Rules | Database patterns rule |
| Security design | Rules | Security rule file |

**Command: `/design [component]`**
```markdown
---
argument-hint: [component-name]
description: Create design document for a component
allowed-tools: Read, Grep, Glob, Write
---

Design the component: $1

## Analysis
1. Review existing architecture (@CLAUDE.md)
2. Identify integration points
3. Design interfaces and contracts
4. Create data models
5. Define security requirements

## Output
Generate design document with:
- Component overview
- Interface definitions
- Data models
- Sequence diagrams (mermaid)
- Security considerations
```

### Phase 3: Implementation

| SDLC Activity | Claude Feature | Implementation |
|---------------|----------------|----------------|
| Code writing | Skills + Rules | Framework skills, coding rules |
| Code review | Hooks | PostToolUse hook for review |
| Refactoring | Commands | `/refactor [file]` command |
| Documentation | Skills | Documentation skill |

**Hook: Auto Code Review**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/scripts/code_review.py"
          }
        ]
      }
    ]
  }
}
```

**Rule: TypeScript Implementation**
```markdown
---
paths: **/*.ts, **/*.tsx
---

# TypeScript Implementation Standards

## Code Quality
- Strict TypeScript mode
- No `any` types
- Explicit return types
- Zod for runtime validation

## Patterns
- Functional components with hooks
- Server Components by default
- Error boundaries for UI
- Proper async error handling

## Before committing
- Run type check: `npm run typecheck`
- Run linter: `npm run lint`
- Run tests: `npm test`
```

### Phase 4: Testing

| SDLC Activity | Claude Feature | Implementation |
|---------------|----------------|----------------|
| Unit testing | Skills | Test generation skill |
| Integration testing | Hooks | PreToolUse for test gates |
| E2E testing | Commands | `/test-e2e [feature]` |
| Test coverage | Hooks | Block commit if coverage low |

**Hook: Block-at-Commit (Test Gate)**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash(git commit:*)",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/scripts/pre-commit-check.sh"
          }
        ]
      }
    ]
  }
}
```

**Script: pre-commit-check.sh**
```bash
#!/bin/bash

# Run tests
npm test --passWithNoTests

if [ $? -ne 0 ]; then
    echo "❌ Tests failed. Commit blocked."
    exit 2  # Exit code 2 blocks the tool
fi

# Check type errors
npm run typecheck

if [ $? -ne 0 ]; then
    echo "❌ Type errors found. Commit blocked."
    exit 2
fi

# Check coverage
COVERAGE=$(npm run coverage --silent | grep "All files" | awk '{print $NF}' | tr -d '%')
if [ "$COVERAGE" -lt 70 ]; then
    echo "❌ Coverage below 70%. Commit blocked."
    exit 2
fi

echo "✅ All checks passed."
exit 0
```

### Phase 5: Deployment

| SDLC Activity | Claude Feature | Implementation |
|---------------|----------------|----------------|
| CI/CD | Headless mode | `-p` flag in pipelines |
| Release notes | Commands | `/release-notes` |
| Environment config | Rules | Environment rule |
| Monitoring | Skills | Monitoring skill |

**Headless Mode for CI**
```yaml
# .github/workflows/claude-review.yml
name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Claude Review
        run: |
          claude -p "Review this PR for code quality, security issues, and best practices. Focus on:
          1. Type safety
          2. Security vulnerabilities
          3. Performance concerns
          4. Test coverage

          Provide actionable feedback." \
          --output-format stream-json \
          > review-output.json

      - name: Post Review Comment
        uses: actions/github-script@v7
        with:
          script: |
            const review = require('./review-output.json')
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: review.result
            })
```

### Phase 6: Maintenance & Monitoring

| SDLC Activity | Claude Feature | Implementation |
|---------------|----------------|----------------|
| Bug fixing | Skills | Bug analysis skill |
| Performance | Skills | Performance optimization skill |
| Security patches | Hooks | Security scanning hook |
| Documentation updates | Commands | `/update-docs` |

---

## Comprehensive Claude Configuration

### Directory Structure
```
.claude/
├── CLAUDE.md                    # Main project context
├── CLAUDE.local.md              # Personal settings (gitignored)
├── settings.local.json          # Hooks and permissions
│
├── skills/
│   ├── requirements-analyzer/
│   │   └── SKILL.md
│   ├── architecture-designer/
│   │   └── SKILL.md
│   ├── code-implementer/
│   │   └── SKILL.md
│   ├── test-generator/
│   │   └── SKILL.md
│   ├── security-reviewer/
│   │   └── SKILL.md
│   ├── performance-optimizer/
│   │   └── SKILL.md
│   └── bug-analyzer/
│       └── SKILL.md
│
├── commands/
│   ├── estimate.md
│   ├── design.md
│   ├── implement.md
│   ├── test.md
│   ├── refactor.md
│   ├── release-notes.md
│   └── update-docs.md
│
├── rules/
│   ├── typescript.md
│   ├── react.md
│   ├── database.md
│   ├── security.md
│   ├── testing.md
│   └── api.md
│
└── scripts/
    ├── pre-commit-check.sh
    ├── code_review.py
    ├── security_scan.sh
    └── format_code.sh
```

### Master CLAUDE.md Template
```markdown
# [Project Name]

## Quick Reference
- Build: `npm run build`
- Test: `npm test`
- Deploy: `npm run deploy`

## Architecture
[Brief architecture overview with key directories]

## Development Workflow
1. Create feature branch: `git checkout -b feature/[name]`
2. Implement with tests
3. Run all checks: `npm run check`
4. Create PR with description

## Code Standards
- TypeScript strict mode
- Functional components
- Zod validation at boundaries
- 70% minimum test coverage

## Domain Knowledge
[Project-specific knowledge, terminology, patterns]

## Common Patterns
[Code patterns used in this project]

## Troubleshooting
[Common issues and solutions]

## References
- @.claude/skills/ for specialized capabilities
- @.claude/rules/ for coding standards
- @.claude/commands/ for workflow commands
```

---

## Best Practices from AI Coding Agents Research

### From Devin (Cognition Labs)

1. **Know When to Intervene**
   - Don't commit to making every interaction successful
   - Discontinue conversations going in circles
   - Manual takeover when agent is confused

2. **Diversify Your Bets**
   - Not all agent runs succeed
   - Learn to maximize successful outcomes
   - Minimize wasted tokens

3. **Delegation for Interruptions**
   - Use agents for quick changes
   - Tag agent on Slack for bugs
   - Maintain flow on main tasks

4. **Plan for Review Cycles**
   - Human-in-the-loop essential
   - CI gates for quality
   - Approve changes before merge

### From SWE-agent (Princeton NLP)

1. **Agent-Computer Interface Design**
   - Custom editor prevents indentation errors
   - Feedback on syntax errors
   - File system browsing tools

2. **Context Window Efficiency**
   - Show only relevant code
   - Summarize long files
   - Track file changes

### From OpenHands

1. **Composable Architecture**
   - Modular agent components
   - Reusable actions
   - Scalable execution

2. **Sandbox Security**
   - Isolated execution environment
   - Network restrictions
   - File system boundaries

### From Aider

1. **Git Integration**
   - Automatic commits
   - Meaningful commit messages
   - Easy rollback

2. **Large Codebase Support**
   - Repository mapping
   - Selective file loading
   - Intelligent context

---

## Hook Configurations for Autonomous Development

### Complete settings.local.json
```json
{
  "permissions": {
    "allow": [
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(git:*)",
      "Bash(node:*)",
      "Read(*)",
      "Write(*.ts)",
      "Write(*.tsx)",
      "Write(*.json)",
      "Write(*.md)",
      "Edit(*)"
    ],
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(sudo:*)",
      "Write(.env*)",
      "Write(**/secrets/**)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash(git commit:*)",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/scripts/pre-commit-check.sh"
          }
        ]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/scripts/security_check.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/scripts/format_code.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/scripts/session_summary.py"
          }
        ]
      }
    ]
  }
}
```

---

## Subagent Definitions

### Architecture Agent
```markdown
---
name: architecture-agent
description: Design system architecture and components. Use for architectural decisions, system design, and technical planning.
tools: Read, Grep, Glob, Write
model: opus
---

You are a senior software architect specializing in scalable systems.

## Responsibilities
1. System design and component architecture
2. Technology selection and tradeoffs
3. Integration patterns
4. Performance and scalability planning
5. Security architecture

## Process
1. Understand requirements from context
2. Review existing architecture
3. Identify constraints and tradeoffs
4. Design solution with diagrams
5. Document decisions and rationale

## Output
- Architecture diagrams (mermaid)
- Component specifications
- API contracts
- Data models
- ADRs (Architecture Decision Records)
```

### Implementation Agent
```markdown
---
name: implementation-agent
description: Implement features and write code. Use for coding tasks, feature implementation, and code modifications.
tools: Read, Grep, Glob, Write, Edit, Bash
model: sonnet
---

You are a senior full-stack developer.

## Responsibilities
1. Write clean, tested code
2. Follow project conventions
3. Handle edge cases
4. Write documentation
5. Create appropriate tests

## Process
1. Understand requirements
2. Review related code
3. Plan implementation
4. Write code with tests
5. Verify with type check and lint

## Standards
- TypeScript strict mode
- Functional patterns
- Comprehensive error handling
- 70%+ test coverage
```

### Test Agent
```markdown
---
name: test-agent
description: Generate and improve tests. Use for test creation, coverage improvement, and test debugging.
tools: Read, Grep, Glob, Write, Edit, Bash
model: sonnet
---

You are a QA engineer specializing in test automation.

## Responsibilities
1. Write unit tests
2. Write integration tests
3. Improve coverage
4. Test edge cases
5. Performance testing

## Test Patterns
- Arrange-Act-Assert
- Given-When-Then for E2E
- Mock external dependencies
- Test error paths

## Coverage Targets
- Unit: 80%
- Integration: 60%
- E2E: Critical paths
```

### Security Agent
```markdown
---
name: security-agent
description: Review code for security issues. Use for security reviews, vulnerability analysis, and secure coding guidance.
tools: Read, Grep, Glob
model: opus
---

You are a security engineer specializing in application security.

## Focus Areas
1. OWASP Top 10
2. Authentication/Authorization
3. Input validation
4. Data protection
5. Secure configurations

## Review Process
1. Static analysis
2. Dependency check
3. Configuration review
4. Authentication flows
5. Data handling

## Output
- Vulnerability report
- Risk assessment
- Remediation steps
- Security recommendations
```

---

## Efficiency Strategies

### Context Window Optimization

1. **Hierarchical Memory**
   - CLAUDE.md for high-level context
   - Rules for specific domains
   - Skills loaded on-demand

2. **Selective Loading**
   - Skills only load when relevant
   - Rules filtered by file path
   - Commands invoked explicitly

3. **Summarization**
   - Session summaries in hooks
   - Episodic memory compression
   - Relevant context retrieval

### Token Efficiency

1. **Concise CLAUDE.md**
   - Bullet points over prose
   - Code examples over explanations
   - Links to detailed docs

2. **Focused Skills**
   - Single responsibility
   - Clear activation criteria
   - Minimal supporting files

3. **Smart Commands**
   - Specific allowed-tools
   - Clear output formats
   - Focused prompts

---

## GitHub Repositories for Reference

### Awesome Claude Code
- **URL:** https://github.com/hesreallyhim/awesome-claude-code
- **Key Features:** Skill selection hooks, comprehensive examples

### Claude Code Hooks Mastery
- **URL:** https://github.com/disler/claude-code-hooks-mastery
- **Key Features:** Hook patterns, subagent examples, meta-agent

### OpenHands
- **URL:** https://github.com/OpenHands/OpenHands
- **Key Features:** Composable agent SDK, sandboxed execution

### SWE-agent
- **URL:** https://github.com/princeton-nlp/SWE-agent
- **Key Features:** Agent-computer interface, GitHub issue resolution

### Aider
- **URL:** https://github.com/paul-gauthier/aider
- **Key Features:** Git integration, large codebase support

---

## Sources

- [Claude Code Best Practices - Anthropic](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [Understanding Claude Code Full Stack - alexop.dev](https://alexop.dev/posts/understanding-claude-code-full-stack/)
- [Coding Agents 101 - Devin](https://devin.ai/agents101)
- [Agent Development Lifecycle - Sierra](https://sierra.ai/blog/agent-development-life-cycle)
- [AI Agents in SDLC - Sonar](https://www.sonarsource.com/resources/library/ai-agents-in-sdlc/)
- [OpenHands GitHub](https://github.com/OpenHands/OpenHands)
- [Awesome Code Agents](https://euniai.github.io/awesome-code-agents/)
