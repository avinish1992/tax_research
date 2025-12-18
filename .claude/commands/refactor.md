---
argument-hint: [file-path]
description: Refactor code for better quality and maintainability
allowed-tools: Read, Grep, Glob, Write, Edit
---

# Refactor: $1

## Refactoring Process

### 1. Analyze Current Code
- Read the target file
- Identify code smells
- Understand existing tests

### 2. Identify Improvements
Common refactoring targets:
- Long functions → Extract smaller functions
- Duplicate code → Extract shared utilities
- Complex conditionals → Guard clauses or strategy pattern
- God objects → Single responsibility components
- Magic numbers → Named constants
- Nested callbacks → Async/await

### 3. Plan Changes
- Ensure tests exist before refactoring
- Plan incremental changes
- Maintain backward compatibility

### 4. Refactor
Apply changes incrementally:
1. Make one change
2. Run tests
3. Verify behavior unchanged
4. Commit (if appropriate)
5. Repeat

### 5. Verify
- All tests still pass
- No new TypeScript errors
- Performance not degraded

## Refactoring Patterns

### Extract Function
```typescript
// Before
function processOrder(order) {
  // 50 lines of validation
  // 30 lines of calculation
  // 20 lines of saving
}

// After
function processOrder(order) {
  validateOrder(order)
  const total = calculateTotal(order)
  saveOrder(order, total)
}
```

### Replace Conditional with Guard Clause
```typescript
// Before
function getDiscount(user) {
  if (user) {
    if (user.isPremium) {
      if (user.years > 5) {
        return 0.2
      } else {
        return 0.1
      }
    } else {
      return 0.05
    }
  }
  return 0
}

// After
function getDiscount(user) {
  if (!user) return 0
  if (!user.isPremium) return 0.05
  if (user.years > 5) return 0.2
  return 0.1
}
```

## Output
Provide:
1. Summary of changes made
2. Before/after comparison
3. Test results
4. Performance impact (if any)
