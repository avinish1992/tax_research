---
paths: nextjs_space/**/*.ts, nextjs_space/**/*.tsx
---

# TypeScript Standards for Legal AI Assistant

## Type Safety
- Enable strict mode in tsconfig.json
- Never use `any` - use `unknown` if type is truly unknown
- Always type function parameters and return values
- Use Zod for runtime validation at API boundaries

## Naming Conventions
- `camelCase` for variables and functions
- `PascalCase` for types, interfaces, classes, components
- `SCREAMING_SNAKE_CASE` for constants
- Prefix interfaces with `I` only if needed for clarity

## React Patterns
- Use function components with explicit return types
- Props interfaces should be named `ComponentNameProps`
- Use `useState<Type>()` with explicit type parameter
- Prefer `const` arrow functions for handlers

## API Routes
```typescript
// Always type request and response
interface RequestBody {
  query: string
  sessionId: string
}

interface ResponseData {
  response: string
  sources: Source[]
}

export async function POST(req: Request): Promise<Response> {
  // Validate with Zod
  const body = requestSchema.parse(await req.json())
  // ... implementation
  return Response.json(data satisfies ResponseData)
}
```

## Error Handling
- Use typed error classes
- Always catch and log errors with context
- Return consistent error shapes from APIs

## Imports
- Use absolute imports with `@/` prefix
- Group imports: external, internal, types
- Avoid default exports (prefer named)
