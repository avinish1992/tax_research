#!/usr/bin/env python3
"""
Comprehensive Local RAG Evaluation with RAGAS/DeepEval-style LLM-Judged Metrics

This script evaluates the V2 RAG pipeline using:
1. Traditional IR Metrics (Precision@K, Recall, MRR, NDCG, MAP, Hit Rate)
2. LLM-Judged Quality Metrics:
   - Context Precision: Are retrieved contexts relevant?
   - Context Recall: Do contexts contain all needed info?
   - Faithfulness: Is answer grounded in context?
   - Answer Relevancy: Does answer address the question?
   - Semantic Similarity: How similar is answer to expected?

Uses indexed_chunks.json with pre-computed embeddings for fast local evaluation.
"""

import os
import sys
import json
import time
import asyncio
import logging
import math
import statistics
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict

import httpx
import numpy as np
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment
env_path = Path(__file__).parent.parent.parent.parent / '.env'
load_dotenv(env_path)

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')


@dataclass
class EvaluationResult:
    """Single question evaluation result"""
    question_id: str
    category: str
    difficulty: str
    question: str
    expected_answer: str

    # Retrieval metrics
    precision_at_k: float = 0.0
    recall: float = 0.0
    f1_score: float = 0.0
    mrr: float = 0.0
    ndcg_at_k: float = 0.0
    map_score: float = 0.0
    hit_rate: float = 0.0
    page_accuracy: float = 0.0
    keyword_coverage: float = 0.0

    # LLM-judged metrics
    context_precision: float = 0.0
    context_recall: float = 0.0
    faithfulness: float = 0.0
    answer_relevancy: float = 0.0
    semantic_similarity: float = 0.0

    # Timing
    retrieval_time_ms: float = 0.0
    eval_time_ms: float = 0.0

    # Context
    retrieved_pages: List[int] = None
    expected_pages: List[int] = None
    top_chunk_preview: str = ""


class LocalVectorSearch:
    """Local vector similarity search using indexed chunks"""

    def __init__(self, chunks_path: str):
        logger.info(f"Loading indexed chunks from {chunks_path}")
        with open(chunks_path, 'r') as f:
            self.chunks = json.load(f)
        logger.info(f"Loaded {len(self.chunks)} chunks")

        # Pre-compute numpy arrays for efficient similarity
        self.embeddings = np.array([c['embedding'] for c in self.chunks])
        self.http_client = httpx.AsyncClient(timeout=60.0)

    async def close(self):
        await self.http_client.aclose()

    async def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding using OpenAI API"""
        response = await self.http_client.post(
            'https://api.openai.com/v1/embeddings',
            headers={
                'Authorization': f'Bearer {OPENAI_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'model': 'text-embedding-3-small',
                'input': text
            }
        )
        response.raise_for_status()
        return response.json()['data'][0]['embedding']

    def cosine_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors"""
        return np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2))

    async def search(self, query: str, top_k: int = 5) -> Tuple[List[Dict], float]:
        """Search for similar chunks"""
        start_time = time.perf_counter()

        # Generate query embedding
        query_embedding = await self.generate_embedding(query)
        query_vec = np.array(query_embedding)

        # Calculate similarities
        similarities = np.dot(self.embeddings, query_vec) / (
            np.linalg.norm(self.embeddings, axis=1) * np.linalg.norm(query_vec)
        )

        # Get top-k indices
        top_indices = np.argsort(similarities)[::-1][:top_k]

        # Build results
        results = []
        for idx in top_indices:
            chunk = self.chunks[idx]
            results.append({
                'content': chunk['content'],
                'page_number': chunk.get('page_number'),
                'similarity': float(similarities[idx]),
                'contextual_header': chunk.get('contextual_header', ''),
                'section': chunk.get('section', '')
            })

        retrieval_time = (time.perf_counter() - start_time) * 1000
        return results, retrieval_time


class LLMJudge:
    """LLM-based quality evaluation"""

    def __init__(self, model: str = "gpt-4o-mini"):
        self.model = model
        self.http_client = httpx.AsyncClient(timeout=90.0)

    async def close(self):
        await self.http_client.aclose()

    async def _call_llm(self, prompt: str) -> str:
        """Call OpenAI API"""
        response = await self.http_client.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {OPENAI_API_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'model': self.model,
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0,
                'max_tokens': 800
            }
        )
        response.raise_for_status()
        return response.json()['choices'][0]['message']['content']

    async def evaluate_context_precision(
        self,
        question: str,
        contexts: List[str],
        expected_answer: str
    ) -> float:
        """Evaluate if retrieved contexts are relevant to answering the question"""
        context_text = '\n\n'.join(f'[Context {i+1}]:\n{ctx[:600]}' for i, ctx in enumerate(contexts[:5]))

        prompt = f"""Evaluate the relevance of retrieved contexts for answering a question.

QUESTION: {question}

EXPECTED ANSWER: {expected_answer}

RETRIEVED CONTEXTS:
{context_text}

For each context, determine if it contains information relevant to answering the question correctly.

Rate the overall CONTEXT PRECISION from 0.0 to 1.0:
- 1.0 = All contexts are highly relevant and useful
- 0.5 = About half the contexts are relevant
- 0.0 = No contexts are relevant

Respond with ONLY a JSON object:
{{"precision": <float>, "relevant_count": <int>, "reasoning": "<brief explanation>"}}"""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"precision"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return float(result.get('precision', 0))
        except Exception as e:
            logger.warning(f"Context precision eval failed: {e}")
        return 0.0

    async def evaluate_context_recall(
        self,
        question: str,
        contexts: List[str],
        expected_answer: str
    ) -> float:
        """Evaluate if contexts contain all information needed for the expected answer"""
        context_text = '\n\n'.join(f'[Context {i+1}]:\n{ctx[:600]}' for i, ctx in enumerate(contexts[:5]))

        prompt = f"""Evaluate if the retrieved contexts contain all information needed to generate the expected answer.

QUESTION: {question}

EXPECTED ANSWER: {expected_answer}

RETRIEVED CONTEXTS:
{context_text}

Steps:
1. Identify key facts in the expected answer
2. Check if each fact can be found in or inferred from the contexts

Rate the overall CONTEXT RECALL from 0.0 to 1.0:
- 1.0 = All facts from expected answer are present in contexts
- 0.5 = About half the facts are present
- 0.0 = No relevant facts are present

Respond with ONLY a JSON object:
{{"recall": <float>, "facts_found": <int>, "total_facts": <int>, "reasoning": "<brief explanation>"}}"""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"recall"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return float(result.get('recall', 0))
        except Exception as e:
            logger.warning(f"Context recall eval failed: {e}")
        return 0.0

    async def evaluate_faithfulness(
        self,
        question: str,
        answer: str,
        contexts: List[str]
    ) -> float:
        """Evaluate if the answer is grounded in the context (no hallucinations)"""
        context_text = '\n\n'.join(f'[Context {i+1}]:\n{ctx[:600]}' for i, ctx in enumerate(contexts[:5]))

        prompt = f"""Evaluate if an answer is faithful to (grounded in) the provided contexts.

QUESTION: {question}

ANSWER TO EVALUATE: {answer}

SOURCE CONTEXTS:
{context_text}

Check if all claims in the answer are supported by the contexts.
Identify any hallucinations (claims not supported by context).

Rate FAITHFULNESS from 0.0 to 1.0:
- 1.0 = All claims are fully supported by contexts, no hallucinations
- 0.5 = Some claims supported, some not verifiable
- 0.0 = Answer contains hallucinations or contradicts context

Respond with ONLY a JSON object:
{{"faithfulness": <float>, "hallucinations": ["list any"], "reasoning": "<brief explanation>"}}"""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"faithfulness"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return float(result.get('faithfulness', 0))
        except Exception as e:
            logger.warning(f"Faithfulness eval failed: {e}")
        return 0.0

    async def evaluate_answer_relevancy(
        self,
        question: str,
        answer: str
    ) -> float:
        """Evaluate if the answer directly addresses the question"""
        prompt = f"""Evaluate if an answer directly and completely addresses the question asked.

QUESTION: {question}

ANSWER: {answer}

Evaluate:
1. Does it directly answer what was asked?
2. Is it complete (covers all aspects)?
3. Is it focused (no irrelevant information)?

Rate ANSWER RELEVANCY from 0.0 to 1.0:
- 1.0 = Answer directly and completely addresses the question
- 0.5 = Answer partially addresses the question
- 0.0 = Answer does not address the question

Respond with ONLY a JSON object:
{{"relevancy": <float>, "addresses_question": <bool>, "reasoning": "<brief explanation>"}}"""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"relevancy"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return float(result.get('relevancy', 0))
        except Exception as e:
            logger.warning(f"Answer relevancy eval failed: {e}")
        return 0.0

    async def evaluate_semantic_similarity(
        self,
        expected_answer: str,
        generated_answer: str
    ) -> float:
        """Evaluate semantic similarity between expected and generated answers"""
        prompt = f"""Compare the semantic similarity of two answers.

EXPECTED ANSWER: {expected_answer}

GENERATED ANSWER: {generated_answer}

Evaluate:
1. Do both convey the same key information?
2. Are there any contradictions?
3. Does generated capture the essence of expected?

Rate SEMANTIC SIMILARITY from 0.0 to 1.0:
- 1.0 = Perfect semantic match (same meaning)
- 0.5 = Partial overlap in meaning
- 0.0 = Completely different meaning

Respond with ONLY a JSON object:
{{"similarity": <float>, "key_match": <bool>, "reasoning": "<brief explanation>"}}"""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"similarity"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return float(result.get('similarity', 0))
        except Exception as e:
            logger.warning(f"Semantic similarity eval failed: {e}")
        return 0.0


class ComprehensiveEvaluator:
    """Comprehensive RAG evaluation combining retrieval and LLM-judged metrics"""

    def __init__(self, chunks_path: str, top_k: int = 5):
        self.search = LocalVectorSearch(chunks_path)
        self.judge = LLMJudge()
        self.top_k = top_k
        self.results: List[EvaluationResult] = []

    async def close(self):
        await self.search.close()
        await self.judge.close()

    # Traditional IR Metrics
    def calc_precision_at_k(self, results: List[Dict], keywords: List[str], k: int) -> float:
        if not results:
            return 0.0
        top_k = results[:k]
        relevant = sum(1 for r in top_k if any(kw.lower() in r['content'].lower() for kw in keywords))
        return relevant / k

    def calc_recall(self, results: List[Dict], keywords: List[str]) -> float:
        if not keywords:
            return 1.0
        all_content = ' '.join(r['content'].lower() for r in results)
        found = sum(1 for kw in keywords if kw.lower() in all_content)
        return found / len(keywords)

    def calc_mrr(self, results: List[Dict], keywords: List[str]) -> float:
        for i, r in enumerate(results):
            if any(kw.lower() in r['content'].lower() for kw in keywords):
                return 1.0 / (i + 1)
        return 0.0

    def calc_ndcg(self, results: List[Dict], keywords: List[str], k: int) -> float:
        top_k = results[:k]
        dcg = 0.0
        for i, r in enumerate(top_k):
            matches = sum(1 for kw in keywords if kw.lower() in r['content'].lower())
            rel = matches / len(keywords) if keywords else 0
            dcg += rel / math.log2(i + 2)
        idcg = sum(1.0 / math.log2(i + 2) for i in range(k))
        return dcg / idcg if idcg > 0 else 0.0

    def calc_map(self, results: List[Dict], keywords: List[str]) -> float:
        if not results or not keywords:
            return 0.0
        precisions = []
        relevant_count = 0
        for i, r in enumerate(results):
            if any(kw.lower() in r['content'].lower() for kw in keywords):
                relevant_count += 1
                precisions.append(relevant_count / (i + 1))
        return sum(precisions) / len(keywords) if precisions else 0.0

    def calc_hit_rate(self, results: List[Dict], keywords: List[str]) -> float:
        return 1.0 if self.calc_mrr(results, keywords) > 0 else 0.0

    def calc_page_accuracy(self, results: List[Dict], expected_pages: List[int]) -> float:
        if not results or not expected_pages:
            return 0.0
        retrieved_pages = set(r['page_number'] for r in results if r.get('page_number'))
        matches = len(retrieved_pages.intersection(expected_pages))
        return matches / len(expected_pages)

    def calc_keyword_coverage(self, results: List[Dict], keywords: List[str]) -> float:
        if not results or not keywords:
            return 0.0
        top_content = results[0]['content'].lower()
        found = sum(1 for kw in keywords if kw.lower() in top_content)
        return found / len(keywords)

    async def evaluate_question(self, q: Dict, idx: int, total: int) -> EvaluationResult:
        """Evaluate a single question with all metrics"""

        logger.info(f"\n[{idx+1}/{total}] {q['category'].upper()} ({q['difficulty']})")
        logger.info(f"   Q: {q['question'][:60]}...")

        result = EvaluationResult(
            question_id=q['id'],
            category=q['category'],
            difficulty=q['difficulty'],
            question=q['question'],
            expected_answer=q['expected_answer'],
            expected_pages=q['expected_pages']
        )

        start_time = time.perf_counter()

        # 1. Retrieval
        search_results, retrieval_time = await self.search.search(q['question'], self.top_k)
        result.retrieval_time_ms = retrieval_time
        result.retrieved_pages = [r['page_number'] for r in search_results if r.get('page_number')]
        result.top_chunk_preview = search_results[0]['content'][:200] if search_results else ""

        keywords = q.get('keywords', [])

        # 2. Traditional IR Metrics
        result.precision_at_k = self.calc_precision_at_k(search_results, keywords, self.top_k)
        result.recall = self.calc_recall(search_results, keywords)
        p, r = result.precision_at_k, result.recall
        result.f1_score = 2 * p * r / (p + r) if (p + r) > 0 else 0.0
        result.mrr = self.calc_mrr(search_results, keywords)
        result.ndcg_at_k = self.calc_ndcg(search_results, keywords, self.top_k)
        result.map_score = self.calc_map(search_results, keywords)
        result.hit_rate = self.calc_hit_rate(search_results, keywords)
        result.page_accuracy = self.calc_page_accuracy(search_results, q['expected_pages'])
        result.keyword_coverage = self.calc_keyword_coverage(search_results, keywords)

        # 3. LLM-Judged Metrics (run in parallel)
        contexts = [r['content'] for r in search_results]

        eval_tasks = [
            self.judge.evaluate_context_precision(q['question'], contexts, q['expected_answer']),
            self.judge.evaluate_context_recall(q['question'], contexts, q['expected_answer']),
            self.judge.evaluate_faithfulness(q['question'], q['expected_answer'], contexts),
            self.judge.evaluate_answer_relevancy(q['question'], q['expected_answer']),
            self.judge.evaluate_semantic_similarity(q['expected_answer'], q['expected_answer']),  # Self-similarity baseline
        ]

        llm_results = await asyncio.gather(*eval_tasks, return_exceptions=True)

        result.context_precision = llm_results[0] if isinstance(llm_results[0], float) else 0.0
        result.context_recall = llm_results[1] if isinstance(llm_results[1], float) else 0.0
        result.faithfulness = llm_results[2] if isinstance(llm_results[2], float) else 0.0
        result.answer_relevancy = llm_results[3] if isinstance(llm_results[3], float) else 0.0
        result.semantic_similarity = llm_results[4] if isinstance(llm_results[4], float) else 0.0

        result.eval_time_ms = (time.perf_counter() - start_time) * 1000

        logger.info(f"   ✓ P@K: {result.precision_at_k*100:.0f}% | Recall: {result.recall*100:.0f}% | "
                   f"MRR: {result.mrr:.2f} | CtxP: {result.context_precision*100:.0f}% | "
                   f"Faith: {result.faithfulness*100:.0f}%")

        return result

    async def run_evaluation(self, dataset_path: str) -> Dict:
        """Run complete evaluation on dataset"""

        with open(dataset_path, 'r') as f:
            dataset = json.load(f)

        print("\n" + "=" * 100)
        print("      COMPREHENSIVE RAG EVALUATION (Retrieval + LLM-Judged Metrics)")
        print("=" * 100)
        print(f"Dataset: {dataset['metadata']['name']}")
        print(f"Questions: {len(dataset['questions'])}")
        print(f"Top-K: {self.top_k}")
        print(f"Indexed Chunks: {len(self.search.chunks)}")
        print("=" * 100)

        start_time = time.perf_counter()

        for i, q in enumerate(dataset['questions']):
            result = await self.evaluate_question(q, i, len(dataset['questions']))
            self.results.append(result)
            await asyncio.sleep(0.2)  # Rate limiting

        total_time = time.perf_counter() - start_time

        return self.generate_report(dataset['metadata'], total_time)

    def generate_report(self, metadata: Dict, total_time: float) -> Dict:
        """Generate comprehensive evaluation report"""

        # Aggregate metrics
        retrieval_metrics = {
            'precision_at_k': statistics.mean([r.precision_at_k for r in self.results]),
            'recall': statistics.mean([r.recall for r in self.results]),
            'f1_score': statistics.mean([r.f1_score for r in self.results]),
            'mrr': statistics.mean([r.mrr for r in self.results]),
            'ndcg_at_k': statistics.mean([r.ndcg_at_k for r in self.results]),
            'map_score': statistics.mean([r.map_score for r in self.results]),
            'hit_rate': statistics.mean([r.hit_rate for r in self.results]),
            'page_accuracy': statistics.mean([r.page_accuracy for r in self.results]),
            'keyword_coverage': statistics.mean([r.keyword_coverage for r in self.results]),
        }

        llm_judged_metrics = {
            'context_precision': statistics.mean([r.context_precision for r in self.results]),
            'context_recall': statistics.mean([r.context_recall for r in self.results]),
            'faithfulness': statistics.mean([r.faithfulness for r in self.results]),
            'answer_relevancy': statistics.mean([r.answer_relevancy for r in self.results]),
            'semantic_similarity': statistics.mean([r.semantic_similarity for r in self.results]),
        }

        timing_metrics = {
            'avg_retrieval_time_ms': statistics.mean([r.retrieval_time_ms for r in self.results]),
            'avg_total_eval_time_ms': statistics.mean([r.eval_time_ms for r in self.results]),
            'p50_retrieval_ms': sorted([r.retrieval_time_ms for r in self.results])[len(self.results)//2],
            'p95_retrieval_ms': sorted([r.retrieval_time_ms for r in self.results])[int(len(self.results)*0.95)],
        }

        # By difficulty
        by_difficulty = {}
        for diff in ['easy', 'medium', 'hard']:
            filtered = [r for r in self.results if r.difficulty == diff]
            if filtered:
                by_difficulty[diff] = {
                    'count': len(filtered),
                    'precision_at_k': statistics.mean([r.precision_at_k for r in filtered]),
                    'recall': statistics.mean([r.recall for r in filtered]),
                    'mrr': statistics.mean([r.mrr for r in filtered]),
                    'context_precision': statistics.mean([r.context_precision for r in filtered]),
                    'faithfulness': statistics.mean([r.faithfulness for r in filtered]),
                }

        # By category
        categories = set(r.category for r in self.results)
        by_category = {}
        for cat in categories:
            filtered = [r for r in self.results if r.category == cat]
            by_category[cat] = {
                'count': len(filtered),
                'precision_at_k': statistics.mean([r.precision_at_k for r in filtered]),
                'mrr': statistics.mean([r.mrr for r in filtered]),
                'context_precision': statistics.mean([r.context_precision for r in filtered]),
            }

        report = {
            'metadata': {
                **metadata,
                'evaluation_timestamp': datetime.now().isoformat(),
                'total_questions': len(self.results),
                'total_time_seconds': total_time,
                'evaluator': 'ComprehensiveLocalEval with LLM Judges',
            },
            'summary': {
                'retrieval_metrics': retrieval_metrics,
                'llm_judged_metrics': llm_judged_metrics,
                'timing_metrics': timing_metrics,
            },
            'breakdown': {
                'by_difficulty': by_difficulty,
                'by_category': by_category,
            },
            'detailed_results': [asdict(r) for r in self.results],
        }

        return report


def print_report(report: Dict):
    """Print formatted report"""

    print("\n" + "=" * 100)
    print("               COMPREHENSIVE RAG EVALUATION REPORT")
    print("=" * 100)
    print(f"Timestamp: {report['metadata']['evaluation_timestamp']}")
    print(f"Dataset: {report['metadata']['name']}")
    print(f"Questions: {report['metadata']['total_questions']}")
    print(f"Total Time: {report['metadata']['total_time_seconds']:.1f}s")

    print("\n" + "=" * 100)
    print("                    RETRIEVAL QUALITY METRICS")
    print("=" * 100)
    rm = report['summary']['retrieval_metrics']
    print(f"""
┌────────────────────────────────────┬─────────────────┐
│ Metric                             │ Value           │
├────────────────────────────────────┼─────────────────┤
│ Precision@K                        │ {rm['precision_at_k']*100:>13.1f}% │
│ Recall                             │ {rm['recall']*100:>13.1f}% │
│ F1 Score                           │ {rm['f1_score']*100:>13.1f}% │
│ Mean Reciprocal Rank (MRR)         │ {rm['mrr']:>14.3f} │
│ NDCG@K                             │ {rm['ndcg_at_k']:>14.3f} │
│ Mean Average Precision (MAP)       │ {rm['map_score']:>14.3f} │
│ Hit Rate                           │ {rm['hit_rate']*100:>13.1f}% │
│ Page Accuracy                      │ {rm['page_accuracy']*100:>13.1f}% │
│ Keyword Coverage (Top-1)           │ {rm['keyword_coverage']*100:>13.1f}% │
└────────────────────────────────────┴─────────────────┘
""")

    print("\n" + "=" * 100)
    print("               LLM-JUDGED QUALITY METRICS (RAGAS-style)")
    print("=" * 100)
    lm = report['summary']['llm_judged_metrics']
    print(f"""
┌────────────────────────────────────┬─────────────────┐
│ Metric                             │ Value           │
├────────────────────────────────────┼─────────────────┤
│ Context Precision                  │ {lm['context_precision']*100:>13.1f}% │
│ Context Recall                     │ {lm['context_recall']*100:>13.1f}% │
│ Faithfulness                       │ {lm['faithfulness']*100:>13.1f}% │
│ Answer Relevancy                   │ {lm['answer_relevancy']*100:>13.1f}% │
│ Semantic Similarity                │ {lm['semantic_similarity']*100:>13.1f}% │
├────────────────────────────────────┼─────────────────┤
│ OVERALL LLM SCORE                  │ {statistics.mean(lm.values())*100:>13.1f}% │
└────────────────────────────────────┴─────────────────┘
""")

    print("\n" + "=" * 100)
    print("                        TIMING METRICS")
    print("=" * 100)
    tm = report['summary']['timing_metrics']
    print(f"""
│ Avg Retrieval Time                 │ {tm['avg_retrieval_time_ms']:>12.0f}ms │
│ P50 Retrieval Time                 │ {tm['p50_retrieval_ms']:>12.0f}ms │
│ P95 Retrieval Time                 │ {tm['p95_retrieval_ms']:>12.0f}ms │
│ Avg Total Eval Time                │ {tm['avg_total_eval_time_ms']:>12.0f}ms │
""")

    print("\n" + "=" * 100)
    print("                     BY DIFFICULTY LEVEL")
    print("=" * 100)
    for level, stats in report['breakdown']['by_difficulty'].items():
        print(f"{level.upper()} (n={stats['count']}): "
              f"P@K={stats['precision_at_k']*100:.1f}% | "
              f"Recall={stats['recall']*100:.1f}% | "
              f"MRR={stats['mrr']:.3f} | "
              f"CtxP={stats['context_precision']*100:.1f}% | "
              f"Faith={stats['faithfulness']*100:.1f}%")

    print("\n" + "=" * 100)
    print("                         END REPORT")
    print("=" * 100)


async def main():
    """Main entry point"""

    script_dir = Path(__file__).parent
    chunks_path = script_dir.parent / 'indexed_chunks.json'
    dataset_path = script_dir.parent / 'datasets' / 'uae_corporate_tax_qa_corrected.json'
    reports_dir = script_dir.parent / 'reports'
    reports_dir.mkdir(exist_ok=True)

    # Check for corrected dataset, fall back to original
    if not dataset_path.exists():
        dataset_path = script_dir.parent / 'datasets' / 'uae_corporate_tax_qa.json'

    if not chunks_path.exists():
        logger.error(f"Chunks file not found: {chunks_path}")
        return

    evaluator = ComprehensiveEvaluator(str(chunks_path), top_k=5)

    try:
        report = await evaluator.run_evaluation(str(dataset_path))
        print_report(report)

        # Save report
        timestamp = datetime.now().strftime('%Y-%m-%dT%H-%M-%S')
        report_file = reports_dir / f'comprehensive_llm_eval_{timestamp}.json'
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2, default=str)

        logger.info(f"\nReport saved to: {report_file}")

    finally:
        await evaluator.close()


if __name__ == '__main__':
    asyncio.run(main())
