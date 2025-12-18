---
argument-hint: [user-query]
description: Debug why a query isn't retrieving expected results
allowed-tools: Read, Grep, Bash
---

# Debug Retrieval for: "$1"

## Debugging Steps

1. **Query Expansion**
   - Check if query terms are expanded
   - Look for legal synonyms (Chapter/Article)
   - Log expanded query

2. **Embedding Generation**
   - Verify API call to embedding service
   - Check embedding dimensions (should be 1536)
   - Compare with stored embeddings

3. **Semantic Search**
   - Log similarity scores
   - Check threshold (0.3)
   - Verify cosine similarity calculation

4. **Keyword Search**
   - Check TF-IDF implementation
   - Log term frequencies
   - Verify tokenization

5. **RRF Fusion**
   - Log ranks from each search
   - Verify fusion formula
   - Check final ranking

6. **Document Coverage**
   - Verify chunks exist for relevant docs
   - Check page number tracking
   - Validate content extraction

## Test Script
```bash
cd nextjs_space
node -e "
const query = '$1';
// Add debugging code here
"
```

## Expected Output
- Similarity scores for top 10 results
- Keyword matches
- Final ranked results
- Recommendations for improvement
