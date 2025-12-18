---
paths: nextjs_space/**
---

# Security Standards

## Authentication
- Always verify session before processing requests
- Use httpOnly cookies for tokens
- Implement CSRF protection
- Validate OAuth state parameters

## Authorization
- Check user ownership before document access
- Use RLS policies in database
- Never trust client-side user IDs
- Implement rate limiting

## Data Handling
- Never log sensitive data (passwords, tokens, PII)
- Sanitize all user input
- Validate file types before upload
- Limit file sizes (10MB max)

## API Security
```typescript
// Always verify auth first
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Validate input
  const body = schema.safeParse(await req.json())
  if (!body.success) {
    return Response.json({ error: 'Invalid input' }, { status: 400 })
  }

  // Process with user context
  // ...
}
```

## Environment Variables
- Never commit .env files
- Use different keys for dev/prod
- Rotate secrets regularly
- Validate required vars at startup

## File Uploads
- Validate MIME types server-side
- Use virus scanning if possible
- Store outside web root
- Generate random file names

## Sensitive Files
Never commit or expose:
- `.env`, `.env.*`
- `credentials.json`
- Private keys (*.pem, *.key)
- Database dumps
