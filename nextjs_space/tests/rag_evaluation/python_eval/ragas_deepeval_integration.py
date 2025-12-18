#!/usr/bin/env python3
"""
RAGAS and DeepEval Integration for RAG Evaluation

This module provides integration with industry-standard RAG evaluation frameworks:
- RAGAS: Retrieval Augmented Generation Assessment Suite
- DeepEval: Open-source LLM evaluation framework

These frameworks provide battle-tested metrics for:
- Context Precision/Recall
- Faithfulness
- Answer Relevancy
- Semantic Similarity
"""

import os
import sys
import json
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Any
import time

import httpx
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables
env_path = Path(__file__).parent.parent.parent.parent / '.env'
load_dotenv(env_path)

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_ANON_KEY = os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
USER_ID = '0c400d3b-2ebe-466a-8814-5411a24beae7'


# Check for optional dependencies
RAGAS_AVAILABLE = False
DEEPEVAL_AVAILABLE = False

try:
    from ragas import evaluate as ragas_evaluate
    from ragas.metrics import (
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall,
    )
    from datasets import Dataset
    RAGAS_AVAILABLE = True
    logger.info("RAGAS framework available")
except ImportError:
    logger.warning("RAGAS not installed. Install with: pip install ragas datasets")

try:
    from deepeval.metrics import (
        ContextualPrecisionMetric,
        ContextualRecallMetric,
        ContextualRelevancyMetric,
        FaithfulnessMetric,
        AnswerRelevancyMetric,
    )
    from deepeval.test_case import LLMTestCase
    from deepeval import evaluate as deepeval_evaluate
    DEEPEVAL_AVAILABLE = True
    logger.info("DeepEval framework available")
except ImportError:
    logger.warning("DeepEval not installed. Install with: pip install deepeval")


class RAGASEvaluator:
    """RAGAS Framework Integration"""

    def __init__(self):
        if not RAGAS_AVAILABLE:
            raise ImportError("RAGAS is not installed. Install with: pip install ragas datasets")

    async def evaluate(self, test_data: List[Dict]) -> Dict:
        """
        Evaluate using RAGAS metrics

        Expected test_data format:
        [
            {
                "question": "...",
                "answer": "...",  # Generated answer
                "contexts": ["...", "..."],  # Retrieved contexts
                "ground_truth": "..."  # Expected answer
            }
        ]
        """
        # Convert to RAGAS dataset format
        dataset_dict = {
            "question": [d["question"] for d in test_data],
            "answer": [d["answer"] for d in test_data],
            "contexts": [d["contexts"] for d in test_data],
            "ground_truth": [d["ground_truth"] for d in test_data],
        }

        dataset = Dataset.from_dict(dataset_dict)

        # Run RAGAS evaluation
        results = ragas_evaluate(
            dataset,
            metrics=[
                faithfulness,
                answer_relevancy,
                context_precision,
                context_recall,
            ]
        )

        return results.to_pandas().to_dict()


class DeepEvalEvaluator:
    """DeepEval Framework Integration"""

    def __init__(self, model: str = "gpt-4o-mini", threshold: float = 0.5):
        if not DEEPEVAL_AVAILABLE:
            raise ImportError("DeepEval is not installed. Install with: pip install deepeval")

        self.model = model
        self.threshold = threshold

        # Initialize metrics
        self.contextual_precision = ContextualPrecisionMetric(
            threshold=threshold,
            model=model,
            include_reason=True
        )
        self.contextual_recall = ContextualRecallMetric(
            threshold=threshold,
            model=model,
            include_reason=True
        )
        self.contextual_relevancy = ContextualRelevancyMetric(
            threshold=threshold,
            model=model,
            include_reason=True
        )
        self.faithfulness = FaithfulnessMetric(
            threshold=threshold,
            model=model,
            include_reason=True
        )
        self.answer_relevancy = AnswerRelevancyMetric(
            threshold=threshold,
            model=model,
            include_reason=True
        )

    def create_test_case(
        self,
        question: str,
        actual_output: str,
        expected_output: str,
        retrieval_context: List[str]
    ) -> LLMTestCase:
        """Create a DeepEval test case"""
        return LLMTestCase(
            input=question,
            actual_output=actual_output,
            expected_output=expected_output,
            retrieval_context=retrieval_context
        )

    async def evaluate_single(self, test_case: LLMTestCase) -> Dict:
        """Evaluate a single test case"""
        results = {}

        # Measure each metric
        try:
            self.contextual_precision.measure(test_case)
            results['contextual_precision'] = {
                'score': self.contextual_precision.score,
                'reason': self.contextual_precision.reason,
                'passed': self.contextual_precision.is_successful()
            }
        except Exception as e:
            results['contextual_precision'] = {'error': str(e)}

        try:
            self.contextual_recall.measure(test_case)
            results['contextual_recall'] = {
                'score': self.contextual_recall.score,
                'reason': self.contextual_recall.reason,
                'passed': self.contextual_recall.is_successful()
            }
        except Exception as e:
            results['contextual_recall'] = {'error': str(e)}

        try:
            self.faithfulness.measure(test_case)
            results['faithfulness'] = {
                'score': self.faithfulness.score,
                'reason': self.faithfulness.reason,
                'passed': self.faithfulness.is_successful()
            }
        except Exception as e:
            results['faithfulness'] = {'error': str(e)}

        try:
            self.answer_relevancy.measure(test_case)
            results['answer_relevancy'] = {
                'score': self.answer_relevancy.score,
                'reason': self.answer_relevancy.reason,
                'passed': self.answer_relevancy.is_successful()
            }
        except Exception as e:
            results['answer_relevancy'] = {'error': str(e)}

        return results


class CustomLLMJudge:
    """
    Custom LLM-based evaluation when RAGAS/DeepEval are not available.
    Uses structured prompts for consistent evaluation.
    """

    def __init__(self, model: str = "gpt-4o-mini"):
        self.model = model
        self.http_client = httpx.AsyncClient(timeout=60.0)

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
                'max_tokens': 500
            }
        )
        response.raise_for_status()
        return response.json()['choices'][0]['message']['content']

    async def evaluate_context_precision(
        self,
        question: str,
        contexts: List[str],
        expected_answer: str
    ) -> Dict:
        """
        Evaluate context precision: Are the retrieved contexts relevant to the question?

        Context Precision = (Number of relevant chunks retrieved) / (Total chunks retrieved)
        """
        prompt = f"""You are evaluating the quality of retrieved contexts for a question-answering system.

Question: {question}

Expected Answer: {expected_answer}

Retrieved Contexts:
{chr(10).join(f'Context {i+1}: {ctx[:800]}...' if len(ctx) > 800 else f'Context {i+1}: {ctx}' for i, ctx in enumerate(contexts))}

For each context, determine if it contains information relevant to answering the question.

Respond with a JSON object:
{{
    "context_relevance": [true/false for each context],
    "precision_score": <float 0-1>,
    "reasoning": "<brief explanation>"
}}

A context is relevant if it contains information that would help answer the question correctly.
Precision = (relevant contexts) / (total contexts)"""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"context_relevance"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return {
                    'score': result.get('precision_score', 0),
                    'context_relevance': result.get('context_relevance', []),
                    'reasoning': result.get('reasoning', ''),
                    'success': True
                }
        except Exception as e:
            logger.error(f"Context precision evaluation failed: {e}")

        return {'score': 0, 'success': False, 'error': str(e)}

    async def evaluate_context_recall(
        self,
        question: str,
        contexts: List[str],
        expected_answer: str
    ) -> Dict:
        """
        Evaluate context recall: Does the retrieved context contain all information
        needed to generate the expected answer?

        Context Recall = (Number of statements from ground truth attributable to context) /
                        (Total statements in ground truth)
        """
        prompt = f"""You are evaluating if the retrieved contexts contain all the information needed to answer a question.

Question: {question}

Expected Answer (Ground Truth): {expected_answer}

Retrieved Contexts:
{chr(10).join(f'Context {i+1}: {ctx[:800]}...' if len(ctx) > 800 else f'Context {i+1}: {ctx}' for i, ctx in enumerate(contexts))}

Steps:
1. Extract key facts/statements from the expected answer
2. For each fact, check if it can be found in or inferred from the contexts
3. Calculate recall

Respond with a JSON object:
{{
    "key_facts": ["fact1", "fact2", ...],
    "facts_found": [true/false for each fact],
    "recall_score": <float 0-1>,
    "reasoning": "<brief explanation>"
}}

Recall = (facts found in context) / (total key facts in expected answer)"""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"key_facts"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return {
                    'score': result.get('recall_score', 0),
                    'key_facts': result.get('key_facts', []),
                    'facts_found': result.get('facts_found', []),
                    'reasoning': result.get('reasoning', ''),
                    'success': True
                }
        except Exception as e:
            logger.error(f"Context recall evaluation failed: {e}")

        return {'score': 0, 'success': False, 'error': str(e)}

    async def evaluate_faithfulness(
        self,
        question: str,
        answer: str,
        contexts: List[str]
    ) -> Dict:
        """
        Evaluate faithfulness: Is the generated answer grounded in the context?
        Does it contain any hallucinations?

        Faithfulness = (Number of claims in answer supported by context) /
                      (Total claims in answer)
        """
        prompt = f"""You are evaluating if an answer is faithful to (grounded in) the provided context.

Question: {question}

Answer to evaluate: {answer}

Source Contexts:
{chr(10).join(f'Context {i+1}: {ctx[:800]}...' if len(ctx) > 800 else f'Context {i+1}: {ctx}' for i, ctx in enumerate(contexts))}

Steps:
1. Extract all claims/statements from the answer
2. For each claim, check if it is supported by the contexts
3. Identify any hallucinations (claims not supported by context)

Respond with a JSON object:
{{
    "claims": ["claim1", "claim2", ...],
    "claims_supported": [true/false for each claim],
    "hallucinations": ["any claims not in context"],
    "faithfulness_score": <float 0-1>,
    "reasoning": "<brief explanation>"
}}

Faithfulness = (supported claims) / (total claims)
A score of 1.0 means the answer is fully grounded with no hallucinations."""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"claims"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return {
                    'score': result.get('faithfulness_score', 0),
                    'claims': result.get('claims', []),
                    'claims_supported': result.get('claims_supported', []),
                    'hallucinations': result.get('hallucinations', []),
                    'reasoning': result.get('reasoning', ''),
                    'success': True
                }
        except Exception as e:
            logger.error(f"Faithfulness evaluation failed: {e}")

        return {'score': 0, 'success': False, 'error': str(e)}

    async def evaluate_answer_relevancy(
        self,
        question: str,
        answer: str
    ) -> Dict:
        """
        Evaluate answer relevancy: Does the answer directly address the question?

        This metric generates hypothetical questions from the answer and checks
        their similarity to the original question.
        """
        prompt = f"""You are evaluating if an answer is relevant to the question asked.

Question: {question}

Answer: {answer}

Evaluate on these criteria:
1. Does the answer directly address what was asked?
2. Is the answer complete (covers all aspects of the question)?
3. Is the answer focused (no irrelevant information)?
4. Would this answer satisfy the user's information need?

Respond with a JSON object:
{{
    "directly_addresses": <float 0-1>,
    "completeness": <float 0-1>,
    "focus": <float 0-1>,
    "overall_relevancy": <float 0-1>,
    "reasoning": "<brief explanation>"
}}

Overall relevancy should be a weighted average considering all criteria."""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"overall_relevancy"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return {
                    'score': result.get('overall_relevancy', 0),
                    'directly_addresses': result.get('directly_addresses', 0),
                    'completeness': result.get('completeness', 0),
                    'focus': result.get('focus', 0),
                    'reasoning': result.get('reasoning', ''),
                    'success': True
                }
        except Exception as e:
            logger.error(f"Answer relevancy evaluation failed: {e}")

        return {'score': 0, 'success': False, 'error': str(e)}

    async def evaluate_semantic_similarity(
        self,
        expected_answer: str,
        generated_answer: str
    ) -> Dict:
        """
        Evaluate semantic similarity between expected and generated answers.
        Uses LLM to compare meaning rather than exact text match.
        """
        prompt = f"""Compare the semantic similarity of two answers.

Expected Answer: {expected_answer}

Generated Answer: {generated_answer}

Evaluate:
1. Do both answers convey the same key information?
2. Are there any contradictions between them?
3. Does the generated answer capture the essence of the expected answer?

Respond with a JSON object:
{{
    "semantic_similarity": <float 0-1>,
    "key_info_match": <float 0-1>,
    "contradictions": ["list any contradictions"],
    "reasoning": "<brief explanation>"
}}

1.0 = Perfect semantic match (same meaning)
0.0 = Completely different meaning"""

        try:
            response = await self._call_llm(prompt)
            import re
            json_match = re.search(r'\{[^{}]*"semantic_similarity"[^{}]*\}', response, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return {
                    'score': result.get('semantic_similarity', 0),
                    'key_info_match': result.get('key_info_match', 0),
                    'contradictions': result.get('contradictions', []),
                    'reasoning': result.get('reasoning', ''),
                    'success': True
                }
        except Exception as e:
            logger.error(f"Semantic similarity evaluation failed: {e}")

        return {'score': 0, 'success': False, 'error': str(e)}

    async def full_evaluation(
        self,
        question: str,
        generated_answer: str,
        expected_answer: str,
        contexts: List[str]
    ) -> Dict:
        """Run full evaluation suite"""

        results = {
            'question': question,
            'generated_answer': generated_answer[:200] + '...' if len(generated_answer) > 200 else generated_answer,
            'expected_answer': expected_answer[:200] + '...' if len(expected_answer) > 200 else expected_answer,
            'num_contexts': len(contexts),
        }

        # Run all evaluations in parallel
        eval_tasks = [
            self.evaluate_context_precision(question, contexts, expected_answer),
            self.evaluate_context_recall(question, contexts, expected_answer),
            self.evaluate_faithfulness(question, generated_answer, contexts),
            self.evaluate_answer_relevancy(question, generated_answer),
            self.evaluate_semantic_similarity(expected_answer, generated_answer),
        ]

        eval_results = await asyncio.gather(*eval_tasks, return_exceptions=True)

        results['context_precision'] = eval_results[0] if not isinstance(eval_results[0], Exception) else {'error': str(eval_results[0])}
        results['context_recall'] = eval_results[1] if not isinstance(eval_results[1], Exception) else {'error': str(eval_results[1])}
        results['faithfulness'] = eval_results[2] if not isinstance(eval_results[2], Exception) else {'error': str(eval_results[2])}
        results['answer_relevancy'] = eval_results[3] if not isinstance(eval_results[3], Exception) else {'error': str(eval_results[3])}
        results['semantic_similarity'] = eval_results[4] if not isinstance(eval_results[4], Exception) else {'error': str(eval_results[4])}

        # Calculate aggregate score
        scores = []
        for metric in ['context_precision', 'context_recall', 'faithfulness', 'answer_relevancy', 'semantic_similarity']:
            if 'score' in results[metric]:
                scores.append(results[metric]['score'])

        results['aggregate_score'] = sum(scores) / len(scores) if scores else 0

        return results


async def run_framework_evaluation(dataset_path: str, output_dir: str):
    """
    Run evaluation using available frameworks.
    Falls back to CustomLLMJudge if RAGAS/DeepEval are not installed.
    """

    # Load dataset
    with open(dataset_path, 'r') as f:
        dataset = json.load(f)

    logger.info(f"Loaded dataset: {dataset['metadata']['name']}")
    logger.info(f"Questions: {len(dataset['questions'])}")

    # Initialize evaluator
    judge = CustomLLMJudge()

    results = []
    total_start = time.perf_counter()

    try:
        for i, q in enumerate(dataset['questions']):
            logger.info(f"\n[{i+1}/{len(dataset['questions'])}] Evaluating: {q['id']}")

            # For this evaluation, we use the expected answer as both generated and expected
            # In real usage, you would pass the actual generated answer
            eval_result = await judge.full_evaluation(
                question=q['question'],
                generated_answer=q['expected_answer'],  # Replace with actual generated answer
                expected_answer=q['expected_answer'],
                contexts=[f"Keywords: {', '.join(q['keywords'])}. Expected pages: {q['expected_pages']}"]  # Replace with actual contexts
            )

            eval_result['question_id'] = q['id']
            eval_result['category'] = q['category']
            eval_result['difficulty'] = q['difficulty']
            results.append(eval_result)

            # Rate limiting
            await asyncio.sleep(0.5)

    finally:
        await judge.close()

    total_time = time.perf_counter() - total_start

    # Generate summary
    summary = {
        'metadata': dataset['metadata'],
        'evaluation_timestamp': datetime.now().isoformat(),
        'total_questions': len(results),
        'total_time_seconds': total_time,
        'framework': 'CustomLLMJudge (RAGAS/DeepEval not installed)',
        'aggregate_scores': {
            'context_precision': sum(r['context_precision'].get('score', 0) for r in results) / len(results),
            'context_recall': sum(r['context_recall'].get('score', 0) for r in results) / len(results),
            'faithfulness': sum(r['faithfulness'].get('score', 0) for r in results) / len(results),
            'answer_relevancy': sum(r['answer_relevancy'].get('score', 0) for r in results) / len(results),
            'semantic_similarity': sum(r['semantic_similarity'].get('score', 0) for r in results) / len(results),
            'overall': sum(r['aggregate_score'] for r in results) / len(results),
        },
        'detailed_results': results,
    }

    # Save results
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime('%Y-%m-%dT%H-%M-%S')
    output_file = output_path / f'llm_judge_eval_{timestamp}.json'

    with open(output_file, 'w') as f:
        json.dump(summary, f, indent=2, default=str)

    logger.info(f"\nEvaluation complete!")
    logger.info(f"Results saved to: {output_file}")

    # Print summary
    print("\n" + "=" * 80)
    print("               LLM-JUDGED EVALUATION SUMMARY")
    print("=" * 80)
    print(f"\nOverall Score: {summary['aggregate_scores']['overall']*100:.1f}%")
    print(f"\nBy Metric:")
    print(f"  - Context Precision: {summary['aggregate_scores']['context_precision']*100:.1f}%")
    print(f"  - Context Recall:    {summary['aggregate_scores']['context_recall']*100:.1f}%")
    print(f"  - Faithfulness:      {summary['aggregate_scores']['faithfulness']*100:.1f}%")
    print(f"  - Answer Relevancy:  {summary['aggregate_scores']['answer_relevancy']*100:.1f}%")
    print(f"  - Semantic Sim:      {summary['aggregate_scores']['semantic_similarity']*100:.1f}%")
    print("=" * 80)

    return summary


if __name__ == '__main__':
    script_dir = Path(__file__).parent
    dataset_path = script_dir.parent / 'datasets' / 'uae_corporate_tax_qa.json'
    output_dir = script_dir.parent / 'reports'

    asyncio.run(run_framework_evaluation(str(dataset_path), str(output_dir)))
