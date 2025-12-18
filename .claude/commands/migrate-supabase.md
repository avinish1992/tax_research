---
description: Generate migration plan for Supabase transition
allowed-tools: Read, Grep, Glob, Write
---

# Supabase Migration Plan Generator

Generate a detailed migration plan for transitioning to Supabase.

## Analysis Required

1. **Current Auth Setup**
   - Review NextAuth configuration
   - Identify OAuth providers
   - Check session management

2. **Database Schema**
   - Export Prisma schema
   - Identify pgvector requirements
   - Plan RLS policies

3. **Storage Usage**
   - Find S3 integration points
   - List file operations
   - Plan storage buckets

4. **API Routes**
   - Identify auth-dependent routes
   - Check database queries
   - Find storage operations

## Output

Generate:
1. Migration checklist
2. Schema conversion SQL
3. RLS policies
4. Updated TypeScript types
5. Environment variable changes
