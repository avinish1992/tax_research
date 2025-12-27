# Deployment Guide

## Overview

This project uses **Netlify** for hosting with the `@netlify/plugin-nextjs` plugin to handle Next.js server-side features.

## ⚠️ Important: How to Deploy

### Recommended: Git-Based Deploy

Always deploy via Git push to ensure proper function bundling:

```bash
# Option 1: Use the deploy script
npm run deploy "Your commit message"

# Option 2: Manual git push
git add -A
git commit -m "Your changes"
git push origin main
```

### Why Not Direct CLI Deploy?

**DO NOT use** `netlify deploy --prod` directly. It often fails to include:
- Next.js server handler functions (causes 404 on API routes)
- Edge functions (middleware for auth)

The Git-based deploy triggers a full build on Netlify's servers, which correctly bundles all functions.

## Verification

After deployment, verify it's healthy:

```bash
# Quick check
npm run deploy:verify

# Full verification
./scripts/verify-deploy.sh
```

Expected results:
- Homepage (`/`): 200
- API routes (`/api/documents`): 401 (unauthorized, but route exists)
- Login page (`/login`): 200

## Troubleshooting

### API Routes Return 404

**Symptom:** `/api/*` routes return Netlify's 404 page

**Cause:** Server handler function wasn't deployed

**Fix:**
1. Trigger a Git-based deploy (push to main)
2. Verify in Netlify dashboard: Deploy summary should show "1 function deployed"

### Authentication Not Working

**Symptom:** Users get logged out unexpectedly

**Cause:** Edge function (middleware) wasn't deployed

**Fix:** Same as above - use Git-based deploy

### Checking Deploy Status

Go to: https://app.netlify.com/projects/taxsavant-ai/deploys

Look for:
- ✅ "1 function deployed" - Server handler is working
- ✅ "1 edge function deployed" - Middleware is working
- ❌ "No functions deployed" - Something went wrong

## Architecture

```
Request Flow:
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   Browser   │────▶│  Edge Function   │────▶│  Server Handler     │
│             │     │  (Middleware)    │     │  (API Routes)       │
└─────────────┘     │  - Session mgmt  │     │  - /api/chat        │
                    │  - Auth redirect │     │  - /api/documents   │
                    └──────────────────┘     └─────────────────────┘
```

## Environment Variables

Required on Netlify:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ABACUSAI_API_KEY`
- `OPENAI_API_KEY`
