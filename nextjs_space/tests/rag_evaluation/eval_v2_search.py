#!/usr/bin/env python3
"""
RAG V2 Search Evaluation Script

Tests the search quality with:
1. Query expansion
2. Hybrid search (semantic + keyword)
3. GPT-4o-mini re-ranking

Run: python3 tests/rag_evaluation/eval_v2_search.py
"""

import os
import sys
import json
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent.parent.parent / '.env'
load_dotenv(env_path)

import requests
from supabase import create_client, Client

# ============================================================================
# Configuration
# ============================================================================

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Use the legacy JWT key which has proper permissions
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqZGFlbWxiam50YWRhZGdnZW5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDkyMTIsImV4cCI6MjA4MTQ4NTIxMn0.KuCLgNUYRjGnva2mUDE0s92Hr9c_FBsr7BuZ6Ix19KM"

DOCUMENT_ID = '8f88fffd-77a6-4953-96ed-4b73ddbe05be'
USER_ID = '0c400d3b-2ebe-466a-8814-5411a24beae7'

CONFIG = {
    'embedding_model': 'text-embedding-3-small',
    'rerank_model': 'gpt-4o-mini',
    'top_k': 5,
    'initial_top_k': 15,
    'enable_reranking': False,  # Disabled to test base performance
    'semantic_weight': 0.6,
    'keyword_weight': 0.4,
    'rrf_k': 60
}

# ============================================================================
# Types
# ============================================================================

@dataclass
class SearchResult:
    content: str
    file_name: str
    score: float
    chunk_index: int
    page_number: Optional[int]
    source: str
    metadata: Dict[str, Any]

@dataclass
class EvalResult:
    question_id: str
    question: str
    difficulty: str
    category: str
    retrieved_pages: List[int]
    expected_pages: List[int]
    page_hit: bool
    page_accuracy: float
    keywords_found: List[str]
    keyword_recall: float
    mrr: float
    search_time_ms: int

# ============================================================================
# Supabase Client
# ============================================================================

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ============================================================================
# Embedding Generation
# ============================================================================

def generate_embedding(text: str) -> List[float]:
    """Generate embedding using OpenAI API"""
    response = requests.post(
        'https://api.openai.com/v1/embeddings',
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {OPENAI_API_KEY}'
        },
        json={
            'model': CONFIG['embedding_model'],
            'input': text[:32000]  # Truncate if needed
        }
    )

    if response.status_code != 200:
        raise Exception(f"Embedding error: {response.text}")

    return response.json()['data'][0]['embedding']

# ============================================================================
# Query Expansion
# ============================================================================

def expand_legal_query(query: str) -> str:
    """Expand query with legal synonyms and cross-references"""
    expanded = query

    # Chapter/Article cross-reference
    import re
    for match in re.finditer(r'chapter\s+(\d+)', query, re.IGNORECASE):
        expanded += f" Article {match.group(1)}"

    for match in re.finditer(r'article\s+(\d+)', query, re.IGNORECASE):
        expanded += f" Chapter {match.group(1)}"

    return expanded

# ============================================================================
# Re-ranking
# ============================================================================

def rerank_results(query: str, results: List[SearchResult]) -> List[SearchResult]:
    """Re-rank results using GPT-4o-mini"""
    if len(results) <= CONFIG['top_k'] or not CONFIG['enable_reranking']:
        return results[:CONFIG['top_k']]

    print(f"   🔄 Re-ranking {len(results)} results...")

    prompt = f"""Score each document's relevance to the query (0-10). Return ONLY a JSON array of numbers.

Query: "{query}"

Documents:
{chr(10).join([f'[{i}] {r.content[:300]}...' for i, r in enumerate(results)])}

Return: [score1, score2, ...]"""

    try:
        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {OPENAI_API_KEY}'
            },
            json={
                'model': CONFIG['rerank_model'],
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0,
                'max_tokens': 200
            }
        )

        if response.status_code != 200:
            print(f"   ⚠️ Re-rank failed: {response.status_code}")
            return results[:CONFIG['top_k']]

        scores_text = response.json()['choices'][0]['message']['content'].strip()
        scores = json.loads(scores_text)

        if len(scores) != len(results):
            return results[:CONFIG['top_k']]

        # Apply scores and sort
        for i, r in enumerate(results):
            r.score = scores[i] / 10.0

        results.sort(key=lambda x: x.score, reverse=True)
        return results[:CONFIG['top_k']]

    except Exception as e:
        print(f"   ⚠️ Re-rank error: {e}")
        return results[:CONFIG['top_k']]

# ============================================================================
# Hybrid Search
# ============================================================================

def hybrid_search(query: str, user_id: str) -> List[SearchResult]:
    """Perform hybrid search with query expansion and re-ranking"""
    expanded_query = expand_legal_query(query)
    embedding = generate_embedding(expanded_query)

    # Call hybrid_search RPC
    try:
        response = supabase.rpc('hybrid_search', {
            'query_text': expanded_query,
            'query_embedding': json.dumps(embedding),
            'p_user_id': user_id,
            'match_count': CONFIG['initial_top_k'],
            'semantic_weight': CONFIG['semantic_weight'],
            'keyword_weight': CONFIG['keyword_weight'],
            'rrf_k': CONFIG['rrf_k']
        }).execute()

        results = [
            SearchResult(
                content=r['content'],
                file_name=r['file_name'],
                score=r['rrf_score'],
                chunk_index=r['chunk_index'],
                page_number=r['page_number'],
                source=r['search_type'],
                metadata=r.get('metadata', {})
            )
            for r in response.data
        ]
    except Exception as e:
        print(f"   ⚠️ Hybrid search failed, trying semantic: {e}")
        # Fallback to semantic search
        response = supabase.rpc('semantic_search', {
            'query_embedding': json.dumps(embedding),
            'p_user_id': user_id,
            'match_count': CONFIG['initial_top_k'],
            'min_similarity': 0.3
        }).execute()

        results = [
            SearchResult(
                content=r['content'],
                file_name=r['file_name'],
                score=r['similarity'],
                chunk_index=r['chunk_index'],
                page_number=r['page_number'],
                source='semantic',
                metadata=r.get('metadata', {})
            )
            for r in response.data
        ]

    # Re-rank
    if CONFIG['enable_reranking'] and len(results) > CONFIG['top_k']:
        results = rerank_results(query, results)

    return results[:CONFIG['top_k']]

# ============================================================================
# Evaluation
# ============================================================================

def evaluate_question(question: Dict) -> EvalResult:
    """Evaluate a single question"""
    start_time = time.time()

    results = hybrid_search(question['question'], USER_ID)

    search_time = int((time.time() - start_time) * 1000)

    # Calculate metrics
    retrieved_pages = list(set(r.page_number for r in results if r.page_number))
    expected_pages = question['expected_pages']

    page_hit = any(p in expected_pages for p in retrieved_pages)
    correct_pages = [p for p in retrieved_pages if p in expected_pages]
    page_accuracy = len(correct_pages) / len(retrieved_pages) if retrieved_pages else 0

    # Keyword recall
    all_content = ' '.join(r.content.lower() for r in results)
    keywords_found = [k for k in question['keywords'] if k.lower() in all_content]
    keyword_recall = len(keywords_found) / len(question['keywords'])

    # MRR
    mrr = 0
    for i, r in enumerate(results):
        if r.page_number and r.page_number in expected_pages:
            mrr = 1 / (i + 1)
            break

    return EvalResult(
        question_id=question['id'],
        question=question['question'],
        difficulty=question['difficulty'],
        category=question['category'],
        retrieved_pages=retrieved_pages,
        expected_pages=expected_pages,
        page_hit=page_hit,
        page_accuracy=page_accuracy,
        keywords_found=keywords_found,
        keyword_recall=keyword_recall,
        mrr=mrr,
        search_time_ms=search_time
    )

# ============================================================================
# Main
# ============================================================================

def main():
    print("\n" + "=" * 70)
    print("🧪 RAG V2 SEARCH EVALUATION")
    print("=" * 70)

    # Load dataset
    dataset_path = Path(__file__).parent / 'datasets' / 'uae_corporate_tax_qa.json'
    with open(dataset_path) as f:
        dataset = json.load(f)

    questions = dataset['questions']
    print(f"\n📝 Evaluating {len(questions)} questions...")

    # Evaluate
    results: List[EvalResult] = []

    for i, q in enumerate(questions):
        print(f"\n[{i+1}/{len(questions)}] {q['question'][:50]}...")

        try:
            result = evaluate_question(q)
            results.append(result)

            print(f"   ✓ Pages: {result.retrieved_pages} (exp: {result.expected_pages}) | Hit: {'YES' if result.page_hit else 'NO'}")
            print(f"   ✓ Keywords: {result.keyword_recall*100:.0f}% | MRR: {result.mrr:.2f} | {result.search_time_ms}ms")
        except Exception as e:
            print(f"   ❌ Error: {e}")

    # Calculate aggregate metrics
    hit_rate = sum(1 for r in results if r.page_hit) / len(results)
    avg_page_accuracy = sum(r.page_accuracy for r in results) / len(results)
    avg_keyword_recall = sum(r.keyword_recall for r in results) / len(results)
    mrr = sum(r.mrr for r in results) / len(results)
    f1 = 2 * (avg_page_accuracy * avg_keyword_recall) / (avg_page_accuracy + avg_keyword_recall) if (avg_page_accuracy + avg_keyword_recall) > 0 else 0

    times = sorted(r.search_time_ms for r in results)
    avg_time = sum(times) / len(times)
    p95_time = times[int(len(times) * 0.95)]

    # Print results
    print("\n" + "=" * 70)
    print("📊 V2 SEARCH RESULTS")
    print("=" * 70)

    print(f"\n📈 Retrieval Metrics:")
    print(f"   Hit Rate:       {hit_rate*100:.1f}%")
    print(f"   Page Accuracy:  {avg_page_accuracy*100:.1f}%")
    print(f"   Keyword Recall: {avg_keyword_recall*100:.1f}%")
    print(f"   F1 Score:       {f1*100:.1f}%")
    print(f"   MRR:            {mrr:.3f}")

    print(f"\n⏱️ Timing:")
    print(f"   Avg Time:       {avg_time:.0f}ms")
    print(f"   P95 Time:       {p95_time:.0f}ms")

    # Baseline comparison
    baseline = {
        'hit_rate': 1.0,
        'page_accuracy': 0.287,
        'recall': 0.710,
        'mrr': 0.943,
        'avg_time': 1783
    }

    print("\n📊 vs Baseline (V1):")
    print(f"   Hit Rate:       {hit_rate*100:.1f}% vs {baseline['hit_rate']*100:.1f}%")
    print(f"   Page Accuracy:  {avg_page_accuracy*100:.1f}% vs {baseline['page_accuracy']*100:.1f}% {'📈' if avg_page_accuracy > baseline['page_accuracy'] else '📉'}")
    print(f"   Recall:         {avg_keyword_recall*100:.1f}% vs {baseline['recall']*100:.1f}% {'📈' if avg_keyword_recall > baseline['recall'] else '📉'}")
    print(f"   MRR:            {mrr:.3f} vs {baseline['mrr']:.3f} {'📈' if mrr > baseline['mrr'] else '📉'}")
    print(f"   Avg Time:       {avg_time:.0f}ms vs {baseline['avg_time']}ms {'📈' if avg_time < baseline['avg_time'] else '📉'}")

    # By difficulty
    print("\n📊 By Difficulty:")
    for diff in ['easy', 'medium', 'hard']:
        diff_results = [r for r in results if r.difficulty == diff]
        if diff_results:
            diff_mrr = sum(r.mrr for r in diff_results) / len(diff_results)
            diff_recall = sum(r.keyword_recall for r in diff_results) / len(diff_results)
            print(f"   {diff.capitalize():8}: MRR={diff_mrr:.3f}, Recall={diff_recall*100:.1f}% (n={len(diff_results)})")

    # Save report
    report_path = Path(__file__).parent / 'reports' / 'v2_search_evaluation.json'
    report_path.parent.mkdir(exist_ok=True)

    report = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'pipeline': 'v2_search',
        'config': CONFIG,
        'metrics': {
            'hit_rate': hit_rate,
            'page_accuracy': avg_page_accuracy,
            'keyword_recall': avg_keyword_recall,
            'f1': f1,
            'mrr': mrr,
            'avg_time_ms': avg_time,
            'p95_time_ms': p95_time
        },
        'baseline': baseline,
        'results': [
            {
                'question_id': r.question_id,
                'question': r.question,
                'difficulty': r.difficulty,
                'retrieved_pages': r.retrieved_pages,
                'expected_pages': r.expected_pages,
                'page_hit': r.page_hit,
                'keyword_recall': r.keyword_recall,
                'mrr': r.mrr,
                'search_time_ms': r.search_time_ms
            }
            for r in results
        ]
    }

    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)

    print(f"\n💾 Saved: {report_path}")
    print("\n✅ EVALUATION COMPLETE")

if __name__ == '__main__':
    main()
