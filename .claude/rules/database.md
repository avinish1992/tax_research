---
paths: nextjs_space/prisma/**, nextjs_space/**/api/**
---

# Database Standards

## Prisma Usage
- Always use Prisma client, never raw SQL in API routes
- Use transactions for multi-table operations
- Include relevant relations in queries
- Use `select` to limit returned fields

## Queries
```typescript
// Good - explicit select and include
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: {
    id: true,
    email: true,
    documents: {
      select: { id: true, fileName: true }
    }
  }
})

// Bad - returns entire record
const user = await prisma.user.findUnique({
  where: { id: userId }
})
```

## Vector Operations
- Store embeddings as JSON strings (current) or vector type (with pgvector)
- Always include user_id filter for multi-tenancy
- Use appropriate similarity threshold (0.3 minimum)

## Migrations
- Use descriptive migration names
- Never modify production migrations
- Test migrations on a copy first
- Always have rollback plan

## Security
- Enable RLS for multi-tenant tables
- Never expose internal IDs in URLs
- Use parameterized queries only
- Validate all input before queries
