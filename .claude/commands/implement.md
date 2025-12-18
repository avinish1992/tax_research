---
argument-hint: [feature-description]
description: Implement a new feature following project standards
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# Implement Feature: $1

## Implementation Process

### 1. Understand Requirements
- Parse the feature description
- Identify acceptance criteria
- Check for related existing code

### 2. Plan Implementation
- Determine files to create/modify
- Design interfaces and types
- Plan test coverage

### 3. Implement
Follow these standards:
- TypeScript strict mode
- Use existing patterns from codebase
- Add proper error handling
- Include JSDoc comments for public APIs

### 4. Test
- Write unit tests first
- Aim for 80% coverage
- Test edge cases

### 5. Verify
- Run type check: `npm run typecheck`
- Run linter: `npm run lint`
- Run tests: `npm test`

## Reference Files
- Project standards: @.claude/CLAUDE.md
- TypeScript rules: @.claude/rules/typescript.md
- Database patterns: @.claude/rules/database.md

## Output
Provide:
1. List of files modified/created
2. Key implementation decisions
3. Test coverage summary
4. Any follow-up tasks needed
