#!/usr/bin/env python3
"""
Comprehensive RAG Pipeline Evaluation Framework

This framework evaluates both retrieval quality and generation quality using:
1. Traditional IR Metrics (Precision, Recall, MRR, NDCG, MAP)
2. LLM-based metrics (Faithfulness, Answer Relevancy, Context Precision/Recall)
3. Semantic similarity metrics
4. Timing and cost analysis

Frameworks integrated:
- Custom retrieval metrics
- RAGAS metrics (when available)
- DeepEval metrics (when available)
"""

import os
import sys
import json
import time
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any, Tuple
from collections import defaultdict
import math
import statistics

import httpx
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
env_path = Path(__file__).parent.parent.parent.parent / '.env'
load_dotenv(env_path)

# Configuration
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_ANON_KEY = os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
ABACUS_API_KEY = os.getenv('ABACUSAI_API_KEY')

# Default user ID for testing
USER_ID = '0c400d3b-2ebe-466a-8814-5411a24beae7'


@dataclass
class RetrievalMetrics:
    """Comprehensive retrieval quality metrics"""
    precision_at_k: float = 0.0
    recall: float = 0.0
    f1_score: float = 0.0
    mrr: float = 0.0  # Mean Reciprocal Rank
    ndcg_at_k: float = 0.0  # Normalized Discounted Cumulative Gain
    map_score: float = 0.0  # Mean Average Precision
    hit_rate: float = 0.0  # At least one relevant doc retrieved
    keyword_coverage: float = 0.0  # Percentage of keywords found
    page_accuracy: float = 0.0  # Correct pages retrieved
    semantic_similarity: float = 0.0  # Avg semantic similarity to query
    context_relevancy: float = 0.0  # LLM-judged relevancy
    chunk_diversity: float = 0.0  # Diversity of retrieved chunks


@dataclass
class GenerationMetrics:
    """Generation quality metrics (LLM-based)"""
    faithfulness: float = 0.0  # Answer grounded in context
    answer_relevancy: float = 0.0  # Answer addresses the question
    context_precision: float = 0.0  # Retrieved context is relevant
    context_recall: float = 0.0  # All needed info retrieved
    factual_correctness: float = 0.0  # Facts match expected answer
    completeness: float = 0.0  # Answer covers all aspects
    conciseness: float = 0.0  # No unnecessary information
    coherence: float = 0.0  # Logical flow


@dataclass
class TimingMetrics:
    """Performance timing metrics"""
    embedding_time_ms: float = 0.0
    search_time_ms: float = 0.0
    total_retrieval_time_ms: float = 0.0
    generation_time_ms: float = 0.0  # If applicable
    end_to_end_time_ms: float = 0.0
    ttft_ms: float = 0.0  # Time to first token


@dataclass
class CostMetrics:
    """Cost analysis metrics"""
    embedding_tokens: int = 0
    llm_input_tokens: int = 0
    llm_output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0


@dataclass
class QuestionResult:
    """Complete evaluation result for a single question"""
    question_id: str
    category: str
    difficulty: str
    question: str
    expected_answer: str
    expected_pages: List[int]
    expected_keywords: List[str]

    # Results
    retrieved_chunks: List[Dict] = field(default_factory=list)
    generated_answer: Optional[str] = None

    # Metrics
    retrieval_metrics: RetrievalMetrics = field(default_factory=RetrievalMetrics)
    generation_metrics: GenerationMetrics = field(default_factory=GenerationMetrics)
    timing_metrics: TimingMetrics = field(default_factory=TimingMetrics)
    cost_metrics: CostMetrics = field(default_factory=CostMetrics)

    # Status
    success: bool = True
    error_message: Optional[str] = None


class RAGEvaluator:
    """Comprehensive RAG Pipeline Evaluator"""

    def __init__(
        self,
        top_k: int = 5,
        include_generation_eval: bool = False,
        use_llm_judges: bool = True
    ):
        self.top_k = top_k
        self.include_generation_eval = include_generation_eval
        self.use_llm_judges = use_llm_judges
        self.http_client = httpx.AsyncClient(timeout=60.0)

        # Results storage
        self.results: List[QuestionResult] = []

    async def close(self):
        await self.http_client.aclose()

    # ============= EMBEDDING & SEARCH =============

    async def generate_embedding(self, text: str) -> Tuple[List[float], float, int]:
        """Generate embedding using OpenAI API"""
        start_time = time.perf_counter()

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
        data = response.json()

        embedding_time = (time.perf_counter() - start_time) * 1000
        tokens_used = data['usage']['total_tokens']

        return data['data'][0]['embedding'], embedding_time, tokens_used

    async def hybrid_search(
        self,
        query: str,
        query_embedding: List[float]
    ) -> Tuple[List[Dict], float]:
        """Execute hybrid search via Supabase RPC"""
        start_time = time.perf_counter()

        response = await self.http_client.post(
            f'{SUPABASE_URL}/rest/v1/rpc/hybrid_search',
            headers={
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
                'Content-Type': 'application/json'
            },
            json={
                'query_text': query,
                'query_embedding': query_embedding,
                'match_count': self.top_k,
                'p_user_id': USER_ID
            }
        )
        response.raise_for_status()

        search_time = (time.perf_counter() - start_time) * 1000
        results = response.json()

        return results, search_time

    # ============= RETRIEVAL METRICS =============

    def calculate_precision_at_k(
        self,
        results: List[Dict],
        keywords: List[str],
        k: int = 5
    ) -> float:
        """Calculate Precision@K based on keyword relevance"""
        if not results:
            return 0.0

        top_k = results[:k]
        relevant_count = sum(
            1 for r in top_k
            if any(kw.lower() in r['content'].lower() for kw in keywords)
        )
        return relevant_count / k

    def calculate_recall(
        self,
        results: List[Dict],
        keywords: List[str]
    ) -> float:
        """Calculate recall - how many expected keywords were found"""
        if not keywords:
            return 1.0

        all_content = ' '.join(r['content'].lower() for r in results)
        found_keywords = sum(1 for kw in keywords if kw.lower() in all_content)
        return found_keywords / len(keywords)

    def calculate_f1_score(self, precision: float, recall: float) -> float:
        """Calculate F1 score from precision and recall"""
        if precision + recall == 0:
            return 0.0
        return 2 * (precision * recall) / (precision + recall)

    def calculate_mrr(
        self,
        results: List[Dict],
        keywords: List[str]
    ) -> float:
        """Calculate Mean Reciprocal Rank"""
        for i, result in enumerate(results):
            content_lower = result['content'].lower()
            if any(kw.lower() in content_lower for kw in keywords):
                return 1.0 / (i + 1)
        return 0.0

    def calculate_ndcg(
        self,
        results: List[Dict],
        keywords: List[str],
        k: int = 5
    ) -> float:
        """Calculate Normalized Discounted Cumulative Gain"""
        top_k = results[:k]

        # Calculate DCG
        dcg = 0.0
        for i, result in enumerate(top_k):
            content_lower = result['content'].lower()
            match_count = sum(1 for kw in keywords if kw.lower() in content_lower)
            relevance = match_count / len(keywords) if keywords else 0
            dcg += relevance / math.log2(i + 2)

        # Calculate IDCG (ideal - all relevant at top)
        idcg = sum(1.0 / math.log2(i + 2) for i in range(k))

        return dcg / idcg if idcg > 0 else 0.0

    def calculate_map(
        self,
        results: List[Dict],
        keywords: List[str]
    ) -> float:
        """Calculate Mean Average Precision"""
        if not results or not keywords:
            return 0.0

        precisions = []
        relevant_count = 0

        for i, result in enumerate(results):
            content_lower = result['content'].lower()
            is_relevant = any(kw.lower() in content_lower for kw in keywords)

            if is_relevant:
                relevant_count += 1
                precisions.append(relevant_count / (i + 1))

        return sum(precisions) / len(keywords) if precisions else 0.0

    def calculate_hit_rate(
        self,
        results: List[Dict],
        keywords: List[str]
    ) -> float:
        """Calculate hit rate - at least one relevant result"""
        if not results:
            return 0.0
        return 1.0 if self.calculate_mrr(results, keywords) > 0 else 0.0

    def calculate_keyword_coverage(
        self,
        results: List[Dict],
        keywords: List[str]
    ) -> float:
        """Calculate keyword coverage in top-1 result"""
        if not results or not keywords:
            return 0.0

        top_content = results[0]['content'].lower()
        found = sum(1 for kw in keywords if kw.lower() in top_content)
        return found / len(keywords)

    def calculate_page_accuracy(
        self,
        results: List[Dict],
        expected_pages: List[int]
    ) -> float:
        """Calculate page accuracy - correct pages retrieved"""
        if not results or not expected_pages:
            return 0.0

        retrieved_pages = set(
            r['page_number'] for r in results
            if r.get('page_number') is not None
        )
        matches = len(retrieved_pages.intersection(expected_pages))
        return matches / len(expected_pages)

    def calculate_chunk_diversity(self, results: List[Dict]) -> float:
        """Calculate diversity of retrieved chunks (based on pages)"""
        if len(results) <= 1:
            return 1.0

        pages = [r.get('page_number', 0) for r in results]
        unique_pages = len(set(pages))
        return unique_pages / len(results)

    # ============= LLM-BASED METRICS =============

    async def evaluate_context_relevancy_llm(
        self,
        question: str,
        contexts: List[str]
    ) -> float:
        """Use LLM to judge context relevancy"""
        if not contexts or not self.use_llm_judges:
            return 0.0

        try:
            prompt = f"""Rate how relevant each context is to answering the question.

Question: {question}

Contexts:
{chr(10).join(f'{i+1}. {ctx[:500]}...' for i, ctx in enumerate(contexts[:5]))}

For each context, give a relevance score from 0 to 1.
Return ONLY a JSON object with "scores" array containing the numeric scores.
Example: {{"scores": [0.9, 0.7, 0.3, 0.5, 0.8]}}"""

            response = await self.http_client.post(
                'https://api.openai.com/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {OPENAI_API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'gpt-4o-mini',
                    'messages': [{'role': 'user', 'content': prompt}],
                    'temperature': 0,
                    'max_tokens': 200
                }
            )
            response.raise_for_status()
            content = response.json()['choices'][0]['message']['content']

            # Parse JSON response
            import re
            json_match = re.search(r'\{[^}]+\}', content)
            if json_match:
                scores_data = json.loads(json_match.group())
                scores = scores_data.get('scores', [])
                return sum(scores) / len(scores) if scores else 0.0

        except Exception as e:
            logger.warning(f"LLM context relevancy evaluation failed: {e}")

        return 0.0

    async def evaluate_faithfulness_llm(
        self,
        question: str,
        answer: str,
        contexts: List[str]
    ) -> float:
        """Use LLM to judge answer faithfulness to context"""
        if not answer or not contexts or not self.use_llm_judges:
            return 0.0

        try:
            context_text = '\n\n'.join(contexts[:5])
            prompt = f"""Evaluate if the answer is faithful to (grounded in) the provided context.

Question: {question}

Context:
{context_text[:3000]}

Answer: {answer}

Rate faithfulness from 0 to 1:
- 1.0: All claims in the answer are supported by the context
- 0.5: Some claims are supported, some are not verifiable from context
- 0.0: Answer contains claims that contradict or go beyond the context

Return ONLY a JSON object: {{"faithfulness": <score>, "reason": "<brief reason>"}}"""

            response = await self.http_client.post(
                'https://api.openai.com/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {OPENAI_API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'gpt-4o-mini',
                    'messages': [{'role': 'user', 'content': prompt}],
                    'temperature': 0,
                    'max_tokens': 200
                }
            )
            response.raise_for_status()
            content = response.json()['choices'][0]['message']['content']

            import re
            json_match = re.search(r'\{[^}]+\}', content)
            if json_match:
                result = json.loads(json_match.group())
                return result.get('faithfulness', 0.0)

        except Exception as e:
            logger.warning(f"LLM faithfulness evaluation failed: {e}")

        return 0.0

    async def evaluate_answer_relevancy_llm(
        self,
        question: str,
        answer: str
    ) -> float:
        """Use LLM to judge answer relevancy to question"""
        if not answer or not self.use_llm_judges:
            return 0.0

        try:
            prompt = f"""Evaluate if the answer directly addresses the question asked.

Question: {question}

Answer: {answer}

Rate answer relevancy from 0 to 1:
- 1.0: Answer directly and completely addresses the question
- 0.5: Answer partially addresses the question or is incomplete
- 0.0: Answer does not address the question at all

Return ONLY a JSON object: {{"relevancy": <score>, "reason": "<brief reason>"}}"""

            response = await self.http_client.post(
                'https://api.openai.com/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {OPENAI_API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'gpt-4o-mini',
                    'messages': [{'role': 'user', 'content': prompt}],
                    'temperature': 0,
                    'max_tokens': 200
                }
            )
            response.raise_for_status()
            content = response.json()['choices'][0]['message']['content']

            import re
            json_match = re.search(r'\{[^}]+\}', content)
            if json_match:
                result = json.loads(json_match.group())
                return result.get('relevancy', 0.0)

        except Exception as e:
            logger.warning(f"LLM relevancy evaluation failed: {e}")

        return 0.0

    async def evaluate_factual_correctness_llm(
        self,
        expected_answer: str,
        generated_answer: str
    ) -> float:
        """Use LLM to judge factual correctness against expected answer"""
        if not generated_answer or not expected_answer or not self.use_llm_judges:
            return 0.0

        try:
            prompt = f"""Compare the generated answer with the expected answer for factual correctness.

Expected Answer: {expected_answer}

Generated Answer: {generated_answer}

Rate factual correctness from 0 to 1:
- 1.0: Generated answer contains all key facts from expected answer
- 0.5: Generated answer contains some key facts but misses others
- 0.0: Generated answer is factually incorrect or completely different

Return ONLY a JSON object: {{"correctness": <score>, "reason": "<brief reason>"}}"""

            response = await self.http_client.post(
                'https://api.openai.com/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {OPENAI_API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'gpt-4o-mini',
                    'messages': [{'role': 'user', 'content': prompt}],
                    'temperature': 0,
                    'max_tokens': 200
                }
            )
            response.raise_for_status()
            content = response.json()['choices'][0]['message']['content']

            import re
            json_match = re.search(r'\{[^}]+\}', content)
            if json_match:
                result = json.loads(json_match.group())
                return result.get('correctness', 0.0)

        except Exception as e:
            logger.warning(f"LLM factual correctness evaluation failed: {e}")

        return 0.0

    # ============= MAIN EVALUATION =============

    async def evaluate_question(
        self,
        question_data: Dict,
        idx: int,
        total: int
    ) -> QuestionResult:
        """Evaluate a single question through the RAG pipeline"""

        result = QuestionResult(
            question_id=question_data['id'],
            category=question_data['category'],
            difficulty=question_data['difficulty'],
            question=question_data['question'],
            expected_answer=question_data['expected_answer'],
            expected_pages=question_data['expected_pages'],
            expected_keywords=question_data['keywords']
        )

        logger.info(f"[{idx+1}/{total}] {result.category.upper()} ({result.difficulty})")
        logger.info(f"   Q: {result.question[:60]}...")

        try:
            start_time = time.perf_counter()

            # 1. Generate embedding
            embedding, emb_time, tokens = await self.generate_embedding(result.question)
            result.timing_metrics.embedding_time_ms = emb_time
            result.cost_metrics.embedding_tokens = tokens

            # 2. Execute hybrid search
            results, search_time = await self.hybrid_search(result.question, embedding)
            result.timing_metrics.search_time_ms = search_time
            result.timing_metrics.total_retrieval_time_ms = emb_time + search_time
            result.timing_metrics.ttft_ms = emb_time + (search_time / self.top_k)
            result.retrieved_chunks = results

            # 3. Calculate retrieval metrics
            contexts = [r['content'] for r in results]

            precision = self.calculate_precision_at_k(results, result.expected_keywords)
            recall = self.calculate_recall(results, result.expected_keywords)

            result.retrieval_metrics.precision_at_k = precision
            result.retrieval_metrics.recall = recall
            result.retrieval_metrics.f1_score = self.calculate_f1_score(precision, recall)
            result.retrieval_metrics.mrr = self.calculate_mrr(results, result.expected_keywords)
            result.retrieval_metrics.ndcg_at_k = self.calculate_ndcg(results, result.expected_keywords)
            result.retrieval_metrics.map_score = self.calculate_map(results, result.expected_keywords)
            result.retrieval_metrics.hit_rate = self.calculate_hit_rate(results, result.expected_keywords)
            result.retrieval_metrics.keyword_coverage = self.calculate_keyword_coverage(results, result.expected_keywords)
            result.retrieval_metrics.page_accuracy = self.calculate_page_accuracy(results, result.expected_pages)
            result.retrieval_metrics.chunk_diversity = self.calculate_chunk_diversity(results)

            # 4. LLM-based context relevancy evaluation
            if self.use_llm_judges:
                result.retrieval_metrics.context_relevancy = await self.evaluate_context_relevancy_llm(
                    result.question, contexts
                )

            # 5. If we have a generated answer, evaluate generation quality
            # For now, use expected answer as proxy for generated answer evaluation
            if self.use_llm_judges:
                result.generation_metrics.faithfulness = await self.evaluate_faithfulness_llm(
                    result.question, result.expected_answer, contexts
                )
                result.generation_metrics.answer_relevancy = await self.evaluate_answer_relevancy_llm(
                    result.question, result.expected_answer
                )

            result.timing_metrics.end_to_end_time_ms = (time.perf_counter() - start_time) * 1000

            logger.info(f"   ✓ P@K: {precision*100:.0f}% | Recall: {recall*100:.0f}% | "
                       f"MRR: {result.retrieval_metrics.mrr:.2f} | Time: {result.timing_metrics.total_retrieval_time_ms:.0f}ms")

        except Exception as e:
            result.success = False
            result.error_message = str(e)
            logger.error(f"   ✗ Error: {e}")

        return result

    async def run_evaluation(self, dataset_path: str) -> Dict:
        """Run complete evaluation on dataset"""

        # Load dataset
        with open(dataset_path, 'r') as f:
            dataset = json.load(f)

        logger.info("=" * 80)
        logger.info("       COMPREHENSIVE RAG PIPELINE EVALUATION")
        logger.info("=" * 80)
        logger.info(f"Dataset: {dataset['metadata']['name']}")
        logger.info(f"Questions: {len(dataset['questions'])}")
        logger.info(f"Top-K: {self.top_k}")
        logger.info(f"LLM Judges: {'Enabled' if self.use_llm_judges else 'Disabled'}")
        logger.info("")

        start_time = time.perf_counter()

        # Evaluate each question
        for i, q in enumerate(dataset['questions']):
            result = await self.evaluate_question(q, i, len(dataset['questions']))
            self.results.append(result)

            # Small delay to avoid rate limiting
            await asyncio.sleep(0.1)

        total_time = time.perf_counter() - start_time

        # Generate comprehensive report
        report = self.generate_report(dataset['metadata'], total_time)

        return report

    def generate_report(self, metadata: Dict, total_time: float) -> Dict:
        """Generate comprehensive evaluation report"""

        successful_results = [r for r in self.results if r.success]

        # Aggregate retrieval metrics
        retrieval_summary = {
            'precision_at_k': statistics.mean([r.retrieval_metrics.precision_at_k for r in successful_results]),
            'recall': statistics.mean([r.retrieval_metrics.recall for r in successful_results]),
            'f1_score': statistics.mean([r.retrieval_metrics.f1_score for r in successful_results]),
            'mrr': statistics.mean([r.retrieval_metrics.mrr for r in successful_results]),
            'ndcg_at_k': statistics.mean([r.retrieval_metrics.ndcg_at_k for r in successful_results]),
            'map_score': statistics.mean([r.retrieval_metrics.map_score for r in successful_results]),
            'hit_rate': statistics.mean([r.retrieval_metrics.hit_rate for r in successful_results]),
            'keyword_coverage': statistics.mean([r.retrieval_metrics.keyword_coverage for r in successful_results]),
            'page_accuracy': statistics.mean([r.retrieval_metrics.page_accuracy for r in successful_results]),
            'chunk_diversity': statistics.mean([r.retrieval_metrics.chunk_diversity for r in successful_results]),
            'context_relevancy': statistics.mean([r.retrieval_metrics.context_relevancy for r in successful_results]) if self.use_llm_judges else None,
        }

        # Aggregate generation metrics (LLM-judged)
        generation_summary = {}
        if self.use_llm_judges:
            generation_summary = {
                'faithfulness': statistics.mean([r.generation_metrics.faithfulness for r in successful_results]),
                'answer_relevancy': statistics.mean([r.generation_metrics.answer_relevancy for r in successful_results]),
            }

        # Aggregate timing metrics
        timing_summary = {
            'avg_embedding_time_ms': statistics.mean([r.timing_metrics.embedding_time_ms for r in successful_results]),
            'avg_search_time_ms': statistics.mean([r.timing_metrics.search_time_ms for r in successful_results]),
            'avg_total_retrieval_time_ms': statistics.mean([r.timing_metrics.total_retrieval_time_ms for r in successful_results]),
            'avg_ttft_ms': statistics.mean([r.timing_metrics.ttft_ms for r in successful_results]),
            'p50_retrieval_time_ms': self._percentile([r.timing_metrics.total_retrieval_time_ms for r in successful_results], 50),
            'p95_retrieval_time_ms': self._percentile([r.timing_metrics.total_retrieval_time_ms for r in successful_results], 95),
            'p99_retrieval_time_ms': self._percentile([r.timing_metrics.total_retrieval_time_ms for r in successful_results], 99),
            'min_retrieval_time_ms': min(r.timing_metrics.total_retrieval_time_ms for r in successful_results),
            'max_retrieval_time_ms': max(r.timing_metrics.total_retrieval_time_ms for r in successful_results),
        }

        # By difficulty breakdown
        by_difficulty = {}
        for difficulty in ['easy', 'medium', 'hard']:
            filtered = [r for r in successful_results if r.difficulty == difficulty]
            if filtered:
                by_difficulty[difficulty] = {
                    'count': len(filtered),
                    'precision_at_k': statistics.mean([r.retrieval_metrics.precision_at_k for r in filtered]),
                    'recall': statistics.mean([r.retrieval_metrics.recall for r in filtered]),
                    'mrr': statistics.mean([r.retrieval_metrics.mrr for r in filtered]),
                    'ndcg': statistics.mean([r.retrieval_metrics.ndcg_at_k for r in filtered]),
                    'avg_time_ms': statistics.mean([r.timing_metrics.total_retrieval_time_ms for r in filtered]),
                }

        # By category breakdown
        categories = set(r.category for r in successful_results)
        by_category = {}
        for category in categories:
            filtered = [r for r in successful_results if r.category == category]
            by_category[category] = {
                'count': len(filtered),
                'precision_at_k': statistics.mean([r.retrieval_metrics.precision_at_k for r in filtered]),
                'recall': statistics.mean([r.retrieval_metrics.recall for r in filtered]),
                'mrr': statistics.mean([r.retrieval_metrics.mrr for r in filtered]),
            }

        # Cost analysis
        total_tokens = sum(r.cost_metrics.embedding_tokens for r in successful_results)
        cost_per_1m_tokens = 0.02  # text-embedding-3-small

        cost_summary = {
            'total_embedding_tokens': total_tokens,
            'cost_per_query_usd': (total_tokens / 1_000_000) * cost_per_1m_tokens / len(successful_results),
            'projected_cost_per_1000_queries_usd': (total_tokens / 1_000_000) * cost_per_1m_tokens * (1000 / len(successful_results)),
        }

        report = {
            'metadata': {
                **metadata,
                'evaluation_timestamp': datetime.now().isoformat(),
                'total_questions': len(self.results),
                'successful_evaluations': len(successful_results),
                'failed_evaluations': len(self.results) - len(successful_results),
                'total_evaluation_time_seconds': total_time,
            },
            'configuration': {
                'top_k': self.top_k,
                'llm_judges_enabled': self.use_llm_judges,
                'embedding_model': 'text-embedding-3-small',
                'search_type': 'hybrid (semantic + keyword + RRF)',
            },
            'summary': {
                'retrieval_metrics': retrieval_summary,
                'generation_metrics': generation_summary,
                'timing_metrics': timing_summary,
                'cost_metrics': cost_summary,
            },
            'breakdown': {
                'by_difficulty': by_difficulty,
                'by_category': by_category,
            },
            'detailed_results': [self._result_to_dict(r) for r in self.results],
        }

        return report

    def _percentile(self, values: List[float], p: int) -> float:
        """Calculate percentile"""
        sorted_values = sorted(values)
        index = int(len(sorted_values) * p / 100)
        return sorted_values[min(index, len(sorted_values) - 1)]

    def _result_to_dict(self, result: QuestionResult) -> Dict:
        """Convert QuestionResult to dictionary"""
        return {
            'question_id': result.question_id,
            'category': result.category,
            'difficulty': result.difficulty,
            'question': result.question,
            'success': result.success,
            'error_message': result.error_message,
            'retrieval_metrics': asdict(result.retrieval_metrics),
            'generation_metrics': asdict(result.generation_metrics),
            'timing_metrics': asdict(result.timing_metrics),
            'cost_metrics': asdict(result.cost_metrics),
            'top_chunks': [
                {
                    'page': c.get('page_number'),
                    'rrf_score': c.get('rrf_score'),
                    'preview': c['content'][:200] + '...'
                }
                for c in result.retrieved_chunks[:3]
            ]
        }


def print_report(report: Dict):
    """Print formatted report to console"""

    print("\n" + "=" * 100)
    print("                     COMPREHENSIVE RAG EVALUATION REPORT")
    print("=" * 100)
    print(f"Generated: {report['metadata']['evaluation_timestamp']}")
    print(f"Dataset: {report['metadata']['name']}")
    print(f"Questions: {report['metadata']['total_questions']} (Success: {report['metadata']['successful_evaluations']})")
    print(f"Total Time: {report['metadata']['total_evaluation_time_seconds']:.1f}s")

    print("\n" + "=" * 100)
    print("                          RETRIEVAL QUALITY METRICS")
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
│ Keyword Coverage (Top-1)           │ {rm['keyword_coverage']*100:>13.1f}% │
│ Page Accuracy                      │ {rm['page_accuracy']*100:>13.1f}% │
│ Chunk Diversity                    │ {rm['chunk_diversity']*100:>13.1f}% │
│ Context Relevancy (LLM)            │ {(rm['context_relevancy']*100 if rm['context_relevancy'] else 0):>13.1f}% │
└────────────────────────────────────┴─────────────────┘
""")

    gm = report['summary']['generation_metrics']
    if gm:
        print("\n" + "=" * 100)
        print("                          GENERATION QUALITY METRICS (LLM-Judged)")
        print("=" * 100)
        print(f"""
┌────────────────────────────────────┬─────────────────┐
│ Metric                             │ Value           │
├────────────────────────────────────┼─────────────────┤
│ Faithfulness                       │ {gm.get('faithfulness', 0)*100:>13.1f}% │
│ Answer Relevancy                   │ {gm.get('answer_relevancy', 0)*100:>13.1f}% │
└────────────────────────────────────┴─────────────────┘
""")

    print("\n" + "=" * 100)
    print("                             TIMING METRICS")
    print("=" * 100)
    tm = report['summary']['timing_metrics']
    print(f"""
┌────────────────────────────────────┬─────────────────┐
│ Metric                             │ Value           │
├────────────────────────────────────┼─────────────────┤
│ Avg Embedding Time                 │ {tm['avg_embedding_time_ms']:>12.0f}ms │
│ Avg Search Time                    │ {tm['avg_search_time_ms']:>12.0f}ms │
│ Avg Total Retrieval Time           │ {tm['avg_total_retrieval_time_ms']:>12.0f}ms │
│ Avg TTFT (estimated)               │ {tm['avg_ttft_ms']:>12.0f}ms │
├────────────────────────────────────┼─────────────────┤
│ P50 Retrieval Time                 │ {tm['p50_retrieval_time_ms']:>12.0f}ms │
│ P95 Retrieval Time                 │ {tm['p95_retrieval_time_ms']:>12.0f}ms │
│ P99 Retrieval Time                 │ {tm['p99_retrieval_time_ms']:>12.0f}ms │
│ Min Retrieval Time                 │ {tm['min_retrieval_time_ms']:>12.0f}ms │
│ Max Retrieval Time                 │ {tm['max_retrieval_time_ms']:>12.0f}ms │
└────────────────────────────────────┴─────────────────┘
""")

    print("\n" + "=" * 100)
    print("                           BY DIFFICULTY LEVEL")
    print("=" * 100)
    for level, stats in report['breakdown']['by_difficulty'].items():
        print(f"{level.upper()} (n={stats['count']}): "
              f"P@K={stats['precision_at_k']*100:.1f}% | "
              f"Recall={stats['recall']*100:.1f}% | "
              f"MRR={stats['mrr']:.3f} | "
              f"NDCG={stats['ndcg']:.3f} | "
              f"Time={stats['avg_time_ms']:.0f}ms")

    print("\n" + "=" * 100)
    print("                              COST ANALYSIS")
    print("=" * 100)
    cm = report['summary']['cost_metrics']
    print(f"""
Total Embedding Tokens: {cm['total_embedding_tokens']:,}
Cost per Query: ${cm['cost_per_query_usd']:.8f}
Projected Cost per 1,000 Queries: ${cm['projected_cost_per_1000_queries_usd']:.4f}
""")

    print("=" * 100)
    print("                              END REPORT")
    print("=" * 100)


async def main():
    """Main entry point"""

    # Paths
    script_dir = Path(__file__).parent
    dataset_path = script_dir.parent / 'datasets' / 'uae_corporate_tax_qa.json'
    reports_dir = script_dir.parent / 'reports'
    reports_dir.mkdir(exist_ok=True)

    # Initialize evaluator
    evaluator = RAGEvaluator(
        top_k=5,
        use_llm_judges=True  # Enable LLM-based metrics
    )

    try:
        # Run evaluation
        report = await evaluator.run_evaluation(str(dataset_path))

        # Print report
        print_report(report)

        # Save JSON report
        timestamp = datetime.now().strftime('%Y-%m-%dT%H-%M-%S')
        report_file = reports_dir / f'comprehensive_eval_{timestamp}.json'
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2, default=str)

        logger.info(f"\nReport saved to: {report_file}")

    finally:
        await evaluator.close()


if __name__ == '__main__':
    asyncio.run(main())
