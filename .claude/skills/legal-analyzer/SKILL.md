---
name: legal-document-analyzer
description: Analyze legal documents for contract terms, liability clauses, compliance issues, and risk factors. Use when reviewing contracts, agreements, legal documents, or when the user asks about legal implications.
---

# Legal Document Analyzer Skill

## When to Use
- User uploads a legal document
- User asks about contract terms or clauses
- User requests liability or risk analysis
- User needs compliance checking
- User wants document summarization

## Analysis Framework

### 1. Document Classification
Identify the document type:
- Contract (service, licensing, employment, etc.)
- Agreement (NDA, partnership, etc.)
- Compliance document (policy, regulation)
- Legal filing (court document, regulatory)

### 2. Key Elements Extraction
Extract and organize:
- **Parties**: Who is involved
- **Effective Date**: When it starts
- **Term/Duration**: How long it lasts
- **Key Obligations**: What each party must do
- **Payment Terms**: Financial obligations
- **Termination Clauses**: How to end the agreement
- **Liability Caps**: Limits on damages
- **Indemnification**: Who protects whom
- **Governing Law**: Which jurisdiction

### 3. Risk Analysis
Flag potential issues:
- Unlimited liability exposure
- One-sided termination rights
- Missing standard protections
- Unusual or non-standard terms
- Ambiguous language
- Missing definitions

### 4. Compliance Check
Verify against standards:
- Industry regulations
- Jurisdiction requirements
- Company policies
- Best practices

## Response Format

```markdown
## Document Summary
[Brief 2-3 sentence overview]

## Document Type
[Classification with confidence]

## Key Terms
| Element | Details |
|---------|---------|
| Parties | ... |
| Term | ... |
| ... | ... |

## Risk Assessment
### High Priority
- [Risk 1]: [Explanation and recommendation]

### Medium Priority
- [Risk 2]: [Explanation]

### Low Priority
- [Risk 3]: [Explanation]

## Recommendations
1. [Specific actionable item]
2. [Specific actionable item]

## Disclaimer
This analysis is for informational purposes. Consult a licensed attorney for legal advice.
```

## Supporting Files
- @research/application/architecture/RECOMMENDED_ARCHITECTURE.md for RAG context
- @nextjs_space/lib/embeddings-v2.ts for search implementation
