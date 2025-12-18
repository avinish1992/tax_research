---
name: architecture-designer
description: Design system architecture and technical solutions. Use when planning new features, discussing system design, making technology decisions, or creating technical specifications.
---

# Architecture Designer Skill

## When to Use
- Planning new features or systems
- Making technology decisions
- Creating technical specifications
- Reviewing architecture choices
- Designing APIs and data models

## Analysis Framework

### 1. Requirements Analysis
- Functional requirements
- Non-functional requirements (scalability, security, performance)
- Constraints (budget, timeline, team skills)
- Integration points

### 2. Architecture Patterns
Consider appropriate patterns:
- **Monolith vs Microservices**
- **Event-driven vs Request-response**
- **Serverless vs Traditional**
- **Multi-tenant vs Single-tenant**

### 3. Component Design
For each component:
- Responsibility (single responsibility principle)
- Interfaces (input/output contracts)
- Dependencies (loose coupling)
- State management

### 4. Data Architecture
- Database selection (relational, document, graph, vector)
- Data models and schemas
- Migration strategies
- Caching layers

### 5. Security Architecture
- Authentication flow
- Authorization model
- Data encryption
- Audit logging

## Output Format

```markdown
# Architecture Design: [Component/Feature]

## Overview
[Brief description of what we're designing]

## Requirements
### Functional
- [Requirement 1]
- [Requirement 2]

### Non-Functional
- Performance: [targets]
- Scalability: [targets]
- Security: [requirements]

## Architecture Diagram
\`\`\`mermaid
graph TD
    A[Component A] --> B[Component B]
    B --> C[Database]
\`\`\`

## Component Specifications

### [Component Name]
- **Responsibility:** [What it does]
- **Interface:** [API contract]
- **Dependencies:** [What it needs]
- **Technology:** [Stack choice with rationale]

## Data Model
\`\`\`sql
-- Key tables/schemas
\`\`\`

## API Design
\`\`\`typescript
// Key interfaces
\`\`\`

## Trade-offs
| Decision | Pros | Cons |
|----------|------|------|
| [Choice] | [Benefits] | [Drawbacks] |

## Migration Plan
1. [Step 1]
2. [Step 2]

## Open Questions
- [Question that needs resolution]
```

## Project Context
- Main architecture: @.claude/CLAUDE.md
- Recommended stack: @research/application/architecture/RECOMMENDED_ARCHITECTURE.md
