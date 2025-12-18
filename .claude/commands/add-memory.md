---
argument-hint: [memory-type: episodic|semantic|temporal]
description: Add a new memory type to the system
allowed-tools: Read, Grep, Write, Edit
---

# Add Memory Type: $1

Implement the specified memory type ($1) for the Legal AI Assistant.

## Implementation Steps

### For Episodic Memory
1. Create database table for episodes
2. Implement storage function
3. Implement recall function (similarity-based)
4. Add to chat context

### For Semantic Memory
1. Create knowledge base table
2. Implement fact storage
3. Implement knowledge query
4. Add to RAG pipeline

### For Temporal Memory
1. Create temporal events table
2. Implement event logging
3. Implement timeline queries
4. Add to user context

## Files to Modify
- Database: prisma/schema.prisma (or Supabase SQL)
- Memory Service: lib/memory/service.ts (create if needed)
- Chat API: app/api/chat/route.ts
- Types: lib/types.ts

## Reference
- @research/application/memory-systems/MEMORY_SYSTEMS_RESEARCH.md
