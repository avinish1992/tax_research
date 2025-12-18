---
name: security-reviewer
description: Review code for security vulnerabilities and best practices. Use when reviewing code, discussing security concerns, or implementing secure features.
---

# Security Reviewer Skill

## When to Use
- Reviewing code for security issues
- Implementing authentication/authorization
- Handling sensitive data
- API security design
- Compliance requirements

## Security Checklist

### 1. OWASP Top 10 (2021)

#### A01: Broken Access Control
```typescript
// BAD: No authorization check
app.get('/user/:id', async (req, res) => {
  const user = await db.user.findById(req.params.id)
  res.json(user)
})

// GOOD: Check ownership
app.get('/user/:id', async (req, res) => {
  const userId = req.params.id
  if (req.session.userId !== userId && !req.session.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  const user = await db.user.findById(userId)
  res.json(user)
})
```

#### A02: Cryptographic Failures
```typescript
// BAD: Weak hashing
const hash = md5(password)

// GOOD: Strong hashing with salt
const hash = await bcrypt.hash(password, 12)
```

#### A03: Injection
```typescript
// BAD: SQL injection vulnerability
const query = `SELECT * FROM users WHERE id = ${userId}`

// GOOD: Parameterized query
const user = await prisma.user.findUnique({
  where: { id: userId }
})
```

#### A04: Insecure Design
- Always validate on server-side
- Implement rate limiting
- Use least privilege principle

#### A05: Security Misconfiguration
```typescript
// BAD: Exposing stack traces
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.stack })
})

// GOOD: Generic error messages
app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})
```

#### A06: Vulnerable Components
- Keep dependencies updated
- Use `npm audit` regularly
- Pin dependency versions

#### A07: Authentication Failures
```typescript
// Implement proper session management
const session = {
  secret: process.env.SESSION_SECRET,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}
```

#### A08: Software & Data Integrity Failures
- Verify package integrity
- Use SRI for CDN resources
- Sign and verify deployments

#### A09: Security Logging Failures
```typescript
// Log security events
logger.security({
  event: 'login_attempt',
  userId: user?.id,
  success: !!user,
  ip: req.ip,
  timestamp: new Date()
})
```

#### A10: SSRF
```typescript
// BAD: Unvalidated URL fetch
const response = await fetch(req.body.url)

// GOOD: Validate and allowlist URLs
const allowedDomains = ['api.example.com']
const url = new URL(req.body.url)
if (!allowedDomains.includes(url.hostname)) {
  throw new Error('Invalid URL')
}
```

### 2. Input Validation

```typescript
import { z } from 'zod'

// Define strict schemas
const UserInput = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(100),
  name: z.string().max(100).regex(/^[a-zA-Z\s]+$/)
})

// Validate at boundaries
export async function POST(req: Request) {
  const body = UserInput.safeParse(await req.json())
  if (!body.success) {
    return Response.json({ error: 'Invalid input' }, { status: 400 })
  }
  // Proceed with validated data
}
```

### 3. Authentication Best Practices

```typescript
// Use secure session configuration
import NextAuth from 'next-auth'

export const authOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    }
  },
  pages: {
    signIn: '/login',
    error: '/auth/error'
  }
}
```

### 4. Environment Security

```typescript
// Validate required env vars at startup
const requiredEnvVars = [
  'DATABASE_URL',
  'NEXTAUTH_SECRET',
  'API_KEY'
]

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required env var: ${envVar}`)
  }
}
```

### 5. File Upload Security

```typescript
// Validate file uploads
const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg']
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

async function validateUpload(file: File) {
  // Check MIME type
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Invalid file type')
  }

  // Check size
  if (file.size > MAX_SIZE) {
    throw new Error('File too large')
  }

  // Verify magic bytes (first few bytes of file)
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer.slice(0, 4))
  // PDF: %PDF (0x25 0x50 0x44 0x46)
  // PNG: 0x89 0x50 0x4E 0x47
  // etc.
}
```

## Security Review Checklist

- [ ] Input validation at all entry points
- [ ] Output encoding (XSS prevention)
- [ ] Authentication checks on protected routes
- [ ] Authorization checks for resource access
- [ ] CSRF protection on mutations
- [ ] Rate limiting on sensitive endpoints
- [ ] Secure headers configured
- [ ] No sensitive data in logs
- [ ] No secrets in code
- [ ] Dependencies up to date
- [ ] Error messages don't leak info

## Output Format

```markdown
# Security Review: [Component/Feature]

## Summary
[Brief overview of security posture]

## Findings

### Critical
- [Finding with location and remediation]

### High
- [Finding with location and remediation]

### Medium
- [Finding with location and remediation]

### Low
- [Finding with location and remediation]

## Recommendations
1. [Prioritized recommendation]
2. [Prioritized recommendation]

## Compliance Notes
- [Any relevant compliance considerations]
```
