---
name: test-generator
description: Generate comprehensive tests for code. Use when writing tests, improving coverage, or implementing test-driven development.
---

# Test Generator Skill

## When to Use
- Writing new tests
- Improving test coverage
- Test-driven development
- Debugging test failures
- Performance testing

## Test Types

### 1. Unit Tests
Test individual functions/components in isolation.

```typescript
describe('functionName', () => {
  it('should handle normal input', () => {
    // Arrange
    const input = 'test'

    // Act
    const result = functionName(input)

    // Assert
    expect(result).toBe('expected')
  })

  it('should handle edge cases', () => {
    expect(functionName('')).toBeNull()
    expect(functionName(null)).toThrow()
  })
})
```

### 2. Integration Tests
Test multiple components working together.

```typescript
describe('API Integration', () => {
  it('should process document and return results', async () => {
    // Setup
    const doc = await uploadDocument(testPdf)

    // Execute
    const results = await queryDocument(doc.id, 'test query')

    // Verify
    expect(results.chunks).toHaveLength(greaterThan(0))
    expect(results.response).toContain('expected content')

    // Cleanup
    await deleteDocument(doc.id)
  })
})
```

### 3. E2E Tests
Test complete user flows.

```typescript
describe('Document Upload Flow', () => {
  it('should allow user to upload and query document', async () => {
    // Given user is logged in
    await page.goto('/login')
    await page.fill('[name=email]', 'test@example.com')
    await page.click('button[type=submit]')

    // When they upload a document
    await page.goto('/documents')
    await page.setInputFiles('input[type=file]', 'test.pdf')
    await page.click('button:text("Upload")')

    // Then they can query it
    await page.goto('/chat')
    await page.fill('input[name=query]', 'What is the main topic?')
    await page.click('button:text("Send")')

    // And receive a response
    await expect(page.locator('.response')).toBeVisible()
  })
})
```

## Test Patterns

### Arrange-Act-Assert (AAA)
```typescript
it('should calculate total', () => {
  // Arrange
  const items = [{ price: 10 }, { price: 20 }]

  // Act
  const total = calculateTotal(items)

  // Assert
  expect(total).toBe(30)
})
```

### Given-When-Then (BDD)
```typescript
describe('When user submits query', () => {
  describe('Given valid session', () => {
    it('Then returns relevant documents', async () => {
      // Implementation
    })
  })

  describe('Given expired session', () => {
    it('Then returns 401 unauthorized', async () => {
      // Implementation
    })
  })
})
```

## Coverage Targets

| Type | Target | Priority |
|------|--------|----------|
| Unit | 80% | High |
| Integration | 60% | Medium |
| E2E | Critical paths | High |

## Edge Cases to Test

1. **Empty inputs:** null, undefined, '', [], {}
2. **Boundary values:** min, max, zero, negative
3. **Type mismatches:** wrong types, missing fields
4. **Error conditions:** network failures, timeouts
5. **Race conditions:** concurrent access
6. **Large inputs:** performance under load

## Mocking Strategies

```typescript
// Mock external APIs
jest.mock('./api', () => ({
  fetchData: jest.fn().mockResolvedValue({ data: 'mocked' })
}))

// Mock database
const mockDb = {
  query: jest.fn().mockResolvedValue([])
}

// Mock time
jest.useFakeTimers()
jest.setSystemTime(new Date('2024-01-01'))
```

## Output Format

When generating tests, provide:
1. Test file with proper structure
2. Explanation of what's being tested
3. Coverage of edge cases
4. Mock setup if needed
5. Cleanup procedures
