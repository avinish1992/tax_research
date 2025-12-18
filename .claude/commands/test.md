---
argument-hint: [file-path or feature-name]
description: Generate tests for a file or feature
allowed-tools: Read, Grep, Glob, Write, Bash
---

# Generate Tests: $1

## Test Generation Process

### 1. Analyze Target
- Read the target file/feature
- Identify functions/components to test
- Understand dependencies

### 2. Identify Test Cases
For each function/component:
- Happy path (normal operation)
- Edge cases (empty, null, boundary values)
- Error cases (invalid input, failures)
- Async behavior (if applicable)

### 3. Generate Tests
Use project test patterns:
```typescript
describe('[Component/Function]', () => {
  beforeEach(() => {
    // Setup
  })

  afterEach(() => {
    // Cleanup
  })

  describe('[method/behavior]', () => {
    it('should [expected behavior] when [condition]', () => {
      // Arrange
      // Act
      // Assert
    })
  })
})
```

### 4. Run Tests
```bash
cd nextjs_space
npm test -- --coverage
```

## Output
Provide:
1. Test file(s) created
2. Coverage report
3. Any mocks/fixtures needed
4. Notes on untestable code
