---
argument-hint: [file-path or 'all']
description: Review code for quality, security, and best practices
allowed-tools: Read, Grep, Glob
---

# Code Review: $1

## Review Checklist

### 1. Code Quality
- [ ] Clear, descriptive names
- [ ] Single responsibility functions
- [ ] No code duplication
- [ ] Appropriate comments (why, not what)
- [ ] Consistent formatting

### 2. TypeScript
- [ ] Strict types (no `any`)
- [ ] Proper null handling
- [ ] Type guards where needed
- [ ] Zod validation at boundaries

### 3. Security
- [ ] Input validation
- [ ] No hardcoded secrets
- [ ] Proper auth checks
- [ ] SQL injection prevention
- [ ] XSS prevention

### 4. Performance
- [ ] No unnecessary re-renders
- [ ] Efficient database queries
- [ ] Proper caching
- [ ] Lazy loading where appropriate

### 5. Testing
- [ ] Adequate test coverage
- [ ] Edge cases covered
- [ ] Mocks properly isolated

### 6. Error Handling
- [ ] Graceful error recovery
- [ ] User-friendly messages
- [ ] Proper logging
- [ ] No silent failures

## Output Format

```markdown
# Code Review Report

## Summary
[Overall assessment: Approved/Changes Requested/Needs Discussion]

## Strengths
- [What's done well]

## Issues Found

### Critical
- [File:Line] [Issue description] [Suggested fix]

### Improvements
- [File:Line] [Suggestion]

## Test Coverage
- [Coverage assessment]

## Recommendations
1. [Prioritized recommendation]
```
