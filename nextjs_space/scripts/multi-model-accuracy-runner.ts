#!/usr/bin/env npx tsx
/**
 * Multi-Model Accuracy Test Runner
 * Comprehensive RAG accuracy testing across GPT models
 *
 * Tests: Retrieval quality, Generation accuracy, Citation quality
 * Models: gpt-4o-mini, gpt-4o, gpt-4-turbo
 */

import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

// Types
interface TestQuestion {
  id: string;
  category: string;
  query: string;
  expected_keywords: string[];
  expected_articles: string[];
  expected_sections: string[];
  ground_truth: string;
  evaluation_criteria: {
    must_contain?: string[];
    should_contain?: string[];
    must_not_contain?: string[];
    should_redirect?: boolean;
    should_clarify?: boolean;
    expected_response_type?: string;
  };
}

interface TestDataset {
  version: string;
  questions: TestQuestion[];
  categories: Record<string, { weight: number; description: string }>;
  scoring: {
    retrieval: Record<string, number>;
    generation: Record<string, number>;
    citation: Record<string, number>;
  };
}

interface SourceInfo {
  index: number;
  nodeId: string;
  fileName: string;
  sectionPath: string;
  pageStart: number;
  pageEnd: number;
  content: string;
}

interface TestResult {
  questionId: string;
  category: string;
  query: string;
  model: string;
  response: string;
  sources: SourceInfo[];
  metrics: {
    // Timing
    totalTimeMs: number;
    ragTimeMs: number;
    llmTimeMs: number;
    // Retrieval metrics
    retrievalConfidence: string;
    sourcesRetrieved: number;
    correctArticles: number;
    totalExpectedArticles: number;
    correctSections: number;
    totalExpectedSections: number;
    retrievalPrecision: number;
    retrievalRecall: number;
    // Generation metrics
    mustContainScore: number;
    mustContainTotal: number;
    shouldContainScore: number;
    shouldContainTotal: number;
    mustNotContainViolations: number;
    keywordAccuracy: number;
    // Citation metrics
    citationCount: number;
    inlineCitations: boolean;
    citationAccuracy: number;
    // Overall
    retrievalScore: number;
    generationScore: number;
    citationScore: number;
    totalScore: number;
  };
  evaluation: {
    mustContainMatches: string[];
    mustContainMissing: string[];
    shouldContainMatches: string[];
    mustNotContainViolations: string[];
    articleMatches: string[];
    sectionMatches: string[];
  };
  error?: string;
}

interface ModelSummary {
  model: string;
  totalQuestions: number;
  successRate: number;
  avgTotalTime: number;
  avgRagTime: number;
  avgLlmTime: number;
  avgRetrievalScore: number;
  avgGenerationScore: number;
  avgCitationScore: number;
  avgTotalScore: number;
  categoryBreakdown: Record<string, {
    count: number;
    avgScore: number;
    successRate: number;
  }>;
}

// Configuration
const MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'] as const;
const BASE_URL = process.env.TEST_URL || 'http://localhost:5000';
const BATCH_SIZE = 2; // Run 2 queries in parallel to avoid rate limits
const DELAY_BETWEEN_BATCHES = 2000; // 2s delay

// Load test dataset
function loadDataset(): TestDataset {
  const datasetPath = path.join(__dirname, '../tests/comprehensive-accuracy-dataset.json');
  const data = fs.readFileSync(datasetPath, 'utf-8');
  return JSON.parse(data);
}

// Run a single query using the test accuracy endpoint
async function runQuery(
  query: string,
  model: string
): Promise<{ response: string; sources: SourceInfo[]; metrics: any }> {
  const response = await fetch(`${BASE_URL}/api/test/accuracy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, model }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Unknown error');
  }

  return {
    response: data.response,
    sources: data.sources || [],
    metrics: {
      totalTimeMs: data.metrics?.totalTimeMs || 0,
      ragTimeMs: data.metrics?.ragTimeMs || 0,
      llmTimeMs: data.metrics?.llmTimeMs || 0,
      retrievalConfidence: data.metrics?.retrievalConfidence || 'unknown',
    },
  };
}

// Evaluate response against ground truth
function evaluateResponse(
  question: TestQuestion,
  response: string,
  sources: SourceInfo[],
  scoring: TestDataset['scoring']
): Omit<TestResult['metrics'], 'totalTimeMs' | 'ragTimeMs' | 'llmTimeMs' | 'retrievalConfidence' | 'sourcesRetrieved'> & TestResult['evaluation'] {
  const responseLower = response.toLowerCase();

  // Must contain evaluation
  const mustContain = question.evaluation_criteria.must_contain || [];
  const mustContainMatches = mustContain.filter(kw =>
    responseLower.includes(kw.toLowerCase())
  );
  const mustContainMissing = mustContain.filter(kw =>
    !responseLower.includes(kw.toLowerCase())
  );

  // Should contain evaluation
  const shouldContain = question.evaluation_criteria.should_contain || [];
  const shouldContainMatches = shouldContain.filter(kw =>
    responseLower.includes(kw.toLowerCase())
  );

  // Must not contain evaluation
  const mustNotContain = question.evaluation_criteria.must_not_contain || [];
  const mustNotContainViolations = mustNotContain.filter(kw =>
    responseLower.includes(kw.toLowerCase())
  );

  // Article matching in sources
  const sourceContent = sources.map(s =>
    `${s.sectionPath || ''} ${s.content || ''}`.toLowerCase()
  ).join(' ');

  const articleMatches = question.expected_articles.filter(article =>
    sourceContent.includes(article.toLowerCase()) ||
    sources.some(s => s.sectionPath?.toLowerCase().includes(article.toLowerCase()))
  );

  // Section matching in sources
  const sectionMatches = question.expected_sections.filter(section =>
    sourceContent.includes(section.toLowerCase()) ||
    sources.some(s => s.sectionPath?.toLowerCase().includes(section.toLowerCase()))
  );

  // Citation analysis
  const citationPattern = /\[(\d+)\]/g;
  const citations = response.match(citationPattern) || [];
  const uniqueCitations = new Set(citations.map(c => c.replace(/[\[\]]/g, '')));

  // Check for inline citations (citations appearing throughout, not just at end)
  const paragraphs = response.split('\n\n').filter(p => p.trim());
  const paragraphsWithCitations = paragraphs.filter(p => citationPattern.test(p));
  const inlineCitations = paragraphsWithCitations.length > 1 ||
    (paragraphs.length === 1 && citations.length > 0);

  // Calculate scores
  const mustContainScore = mustContainMatches.length;
  const mustContainTotal = mustContain.length;
  const shouldContainScore = shouldContainMatches.length;
  const shouldContainTotal = shouldContain.length;

  // Retrieval precision/recall
  const retrievalPrecision = sources.length > 0
    ? articleMatches.length / sources.length
    : 0;
  const retrievalRecall = question.expected_articles.length > 0
    ? articleMatches.length / question.expected_articles.length
    : (sources.length > 0 ? 1 : 0);

  // Keyword accuracy (from expected_keywords)
  const keywordMatches = question.expected_keywords.filter(kw =>
    responseLower.includes(kw.toLowerCase())
  );
  const keywordAccuracy = question.expected_keywords.length > 0
    ? keywordMatches.length / question.expected_keywords.length
    : 1;

  // Citation accuracy (cited sources vs sources provided)
  const citationAccuracy = sources.length > 0
    ? Math.min(uniqueCitations.size / sources.length, 1)
    : 0;

  // Calculate composite scores using scoring weights
  const retrievalScore =
    (articleMatches.length * scoring.retrieval.correct_article_retrieved) +
    (sectionMatches.length * scoring.retrieval.correct_section_retrieved) +
    (Math.max(0, sources.length - articleMatches.length - sectionMatches.length) * scoring.retrieval.partial_match);

  const generationScore =
    (mustContainScore === mustContainTotal ? scoring.generation.must_contain_all : mustContainScore * scoring.generation.must_contain_partial) +
    (shouldContainScore * scoring.generation.should_contain_bonus) +
    (mustNotContainViolations.length * scoring.generation.hallucination);

  const citationScore =
    (inlineCitations ? scoring.citation.correct_inline_citation : 0) +
    (uniqueCitations.size * scoring.citation.correct_source_cited) +
    ((sources.length - uniqueCitations.size) * scoring.citation.missing_citation);

  const totalScore = retrievalScore + generationScore + citationScore;

  return {
    mustContainScore,
    mustContainTotal,
    shouldContainScore,
    shouldContainTotal,
    mustNotContainViolations: mustNotContainViolations.length,
    keywordAccuracy,
    correctArticles: articleMatches.length,
    totalExpectedArticles: question.expected_articles.length,
    correctSections: sectionMatches.length,
    totalExpectedSections: question.expected_sections.length,
    retrievalPrecision,
    retrievalRecall,
    citationCount: uniqueCitations.size,
    inlineCitations,
    citationAccuracy,
    retrievalScore,
    generationScore,
    citationScore,
    totalScore,
    // Evaluation details
    mustContainMatches,
    mustContainMissing,
    shouldContainMatches,
    mustNotContainViolations,
    articleMatches,
    sectionMatches,
  };
}

// Run test for a single question and model
async function runTest(
  question: TestQuestion,
  model: string,
  scoring: TestDataset['scoring']
): Promise<TestResult> {
  try {
    // Run the query using test endpoint (no session needed)
    const { response, sources, metrics } = await runQuery(question.query, model);

    // Evaluate the response
    const evaluation = evaluateResponse(question, response, sources, scoring);

    return {
      questionId: question.id,
      category: question.category,
      query: question.query,
      model,
      response: response.substring(0, 500) + (response.length > 500 ? '...' : ''),
      sources,
      metrics: {
        totalTimeMs: metrics.totalTimeMs,
        ragTimeMs: metrics.ragTimeMs,
        llmTimeMs: metrics.llmTimeMs,
        retrievalConfidence: metrics.retrievalConfidence,
        sourcesRetrieved: sources.length,
        ...evaluation,
      },
      evaluation: {
        mustContainMatches: evaluation.mustContainMatches,
        mustContainMissing: evaluation.mustContainMissing,
        shouldContainMatches: evaluation.shouldContainMatches,
        mustNotContainViolations: evaluation.mustNotContainViolations,
        articleMatches: evaluation.articleMatches,
        sectionMatches: evaluation.sectionMatches,
      },
    };
  } catch (error) {
    return {
      questionId: question.id,
      category: question.category,
      query: question.query,
      model,
      response: '',
      sources: [],
      metrics: {
        totalTimeMs: 0,
        ragTimeMs: 0,
        llmTimeMs: 0,
        retrievalConfidence: 'error',
        sourcesRetrieved: 0,
        correctArticles: 0,
        totalExpectedArticles: question.expected_articles.length,
        correctSections: 0,
        totalExpectedSections: question.expected_sections.length,
        retrievalPrecision: 0,
        retrievalRecall: 0,
        mustContainScore: 0,
        mustContainTotal: question.evaluation_criteria.must_contain?.length || 0,
        shouldContainScore: 0,
        shouldContainTotal: question.evaluation_criteria.should_contain?.length || 0,
        mustNotContainViolations: 0,
        keywordAccuracy: 0,
        citationCount: 0,
        inlineCitations: false,
        citationAccuracy: 0,
        retrievalScore: 0,
        generationScore: 0,
        citationScore: 0,
        totalScore: 0,
      },
      evaluation: {
        mustContainMatches: [],
        mustContainMissing: question.evaluation_criteria.must_contain || [],
        shouldContainMatches: [],
        mustNotContainViolations: [],
        articleMatches: [],
        sectionMatches: [],
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Delay utility
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate model summary
function calculateModelSummary(results: TestResult[], model: string, categories: TestDataset['categories']): ModelSummary {
  const modelResults = results.filter(r => r.model === model);
  const successfulResults = modelResults.filter(r => !r.error && r.metrics.totalScore > 0);

  const categoryBreakdown: ModelSummary['categoryBreakdown'] = {};

  for (const cat of Object.keys(categories)) {
    const catResults = modelResults.filter(r => r.category === cat);
    const catSuccessful = catResults.filter(r => !r.error && r.metrics.totalScore > 0);
    categoryBreakdown[cat] = {
      count: catResults.length,
      avgScore: catResults.length > 0
        ? catResults.reduce((sum, r) => sum + r.metrics.totalScore, 0) / catResults.length
        : 0,
      successRate: catResults.length > 0
        ? catSuccessful.length / catResults.length
        : 0,
    };
  }

  return {
    model,
    totalQuestions: modelResults.length,
    successRate: modelResults.length > 0 ? successfulResults.length / modelResults.length : 0,
    avgTotalTime: modelResults.length > 0
      ? modelResults.reduce((sum, r) => sum + r.metrics.totalTimeMs, 0) / modelResults.length
      : 0,
    avgRagTime: modelResults.length > 0
      ? modelResults.reduce((sum, r) => sum + r.metrics.ragTimeMs, 0) / modelResults.length
      : 0,
    avgLlmTime: modelResults.length > 0
      ? modelResults.reduce((sum, r) => sum + r.metrics.llmTimeMs, 0) / modelResults.length
      : 0,
    avgRetrievalScore: modelResults.length > 0
      ? modelResults.reduce((sum, r) => sum + r.metrics.retrievalScore, 0) / modelResults.length
      : 0,
    avgGenerationScore: modelResults.length > 0
      ? modelResults.reduce((sum, r) => sum + r.metrics.generationScore, 0) / modelResults.length
      : 0,
    avgCitationScore: modelResults.length > 0
      ? modelResults.reduce((sum, r) => sum + r.metrics.citationScore, 0) / modelResults.length
      : 0,
    avgTotalScore: modelResults.length > 0
      ? modelResults.reduce((sum, r) => sum + r.metrics.totalScore, 0) / modelResults.length
      : 0,
    categoryBreakdown,
  };
}

// Generate report
function generateReport(
  results: TestResult[],
  summaries: ModelSummary[],
  dataset: TestDataset
): string {
  const timestamp = new Date().toISOString();

  let report = `# PageIndex RAG Accuracy Report
Generated: ${timestamp}

## Executive Summary

| Model | Success Rate | Avg Score | Retrieval | Generation | Citation | Avg Time |
|-------|-------------|-----------|-----------|------------|----------|----------|
`;

  for (const s of summaries) {
    report += `| ${s.model} | ${(s.successRate * 100).toFixed(1)}% | ${s.avgTotalScore.toFixed(1)} | ${s.avgRetrievalScore.toFixed(1)} | ${s.avgGenerationScore.toFixed(1)} | ${s.avgCitationScore.toFixed(1)} | ${(s.avgTotalTime / 1000).toFixed(1)}s |\n`;
  }

  // Best model recommendation
  const bestOverall = summaries.reduce((best, s) => s.avgTotalScore > best.avgTotalScore ? s : best);
  const fastestModel = summaries.reduce((fast, s) => s.avgTotalTime < fast.avgTotalTime ? s : fast);

  report += `
## Recommendations

**Best Overall Accuracy:** ${bestOverall.model} (Score: ${bestOverall.avgTotalScore.toFixed(1)})
**Fastest Response:** ${fastestModel.model} (${(fastestModel.avgTotalTime / 1000).toFixed(1)}s avg)

`;

  // Category breakdown for best model
  report += `## Category Performance (${bestOverall.model})

| Category | Count | Avg Score | Success Rate |
|----------|-------|-----------|--------------|
`;

  for (const [cat, stats] of Object.entries(bestOverall.categoryBreakdown)) {
    const catInfo = dataset.categories[cat];
    report += `| ${cat} (${catInfo?.weight || 1}x) | ${stats.count} | ${stats.avgScore.toFixed(1)} | ${(stats.successRate * 100).toFixed(0)}% |\n`;
  }

  // Detailed results by category
  report += `
## Detailed Results by Category

`;

  for (const cat of Object.keys(dataset.categories)) {
    const catResults = results.filter(r => r.category === cat);
    if (catResults.length === 0) continue;

    report += `### ${cat.toUpperCase()}

`;

    // Group by question
    const questionIds = [...new Set(catResults.map(r => r.questionId))];
    for (const qId of questionIds) {
      const qResults = catResults.filter(r => r.questionId === qId);
      const first = qResults[0];

      report += `**${qId}:** ${first.query.substring(0, 80)}${first.query.length > 80 ? '...' : ''}

| Model | Score | Retrieval | Generation | Citation | Must✓ | Should✓ | Time |
|-------|-------|-----------|------------|----------|-------|---------|------|
`;

      for (const r of qResults) {
        const mustCheck = r.metrics.mustContainTotal > 0
          ? `${r.metrics.mustContainScore}/${r.metrics.mustContainTotal}`
          : 'N/A';
        const shouldCheck = r.metrics.shouldContainTotal > 0
          ? `${r.metrics.shouldContainScore}/${r.metrics.shouldContainTotal}`
          : 'N/A';
        report += `| ${r.model} | ${r.metrics.totalScore.toFixed(1)} | ${r.metrics.retrievalScore.toFixed(1)} | ${r.metrics.generationScore.toFixed(1)} | ${r.metrics.citationScore.toFixed(1)} | ${mustCheck} | ${shouldCheck} | ${(r.metrics.totalTimeMs / 1000).toFixed(1)}s |\n`;
      }

      report += `\n`;
    }
  }

  // Failure analysis
  const failures = results.filter(r => r.error || r.metrics.totalScore <= 0);
  if (failures.length > 0) {
    report += `## Failures & Issues

`;
    for (const f of failures.slice(0, 10)) {
      report += `- **${f.questionId}** (${f.model}): ${f.error || 'Score 0'}\n`;
    }
    if (failures.length > 10) {
      report += `- ... and ${failures.length - 10} more\n`;
    }
  }

  // Improvement priorities
  report += `
## Improvement Priorities

Based on the test results, here are the recommended improvements:

`;

  // Find weak categories
  const weakCategories = Object.entries(bestOverall.categoryBreakdown)
    .filter(([_, stats]) => stats.successRate < 0.7)
    .sort((a, b) => a[1].successRate - b[1].successRate);

  if (weakCategories.length > 0) {
    report += `### Low-Performing Categories\n\n`;
    for (const [cat, stats] of weakCategories) {
      report += `1. **${cat}** - ${(stats.successRate * 100).toFixed(0)}% success rate, avg score ${stats.avgScore.toFixed(1)}\n`;
    }
    report += `\n`;
  }

  // Citation issues
  const citationIssues = results.filter(r => !r.metrics.inlineCitations && r.metrics.citationCount > 0);
  if (citationIssues.length > 0) {
    report += `### Citation Placement Issues\n\n`;
    report += `${citationIssues.length} responses had citations grouped at end instead of inline.\n\n`;
  }

  // Must-contain failures
  const mustContainFailures = results.filter(r => r.evaluation.mustContainMissing.length > 0);
  if (mustContainFailures.length > 0) {
    report += `### Missing Required Content\n\n`;
    const missingKeywords: Record<string, number> = {};
    for (const r of mustContainFailures) {
      for (const kw of r.evaluation.mustContainMissing) {
        missingKeywords[kw] = (missingKeywords[kw] || 0) + 1;
      }
    }
    const topMissing = Object.entries(missingKeywords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [kw, count] of topMissing) {
      report += `- "${kw}" missing in ${count} responses\n`;
    }
    report += `\n`;
  }

  return report;
}

// Main function
async function main() {
  console.log('=' .repeat(80));
  console.log('MULTI-MODEL RAG ACCURACY TEST RUNNER');
  console.log('=' .repeat(80));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Models: ${MODELS.join(', ')}`);
  console.log('');

  // Load dataset
  const dataset = loadDataset();
  console.log(`📊 Loaded ${dataset.questions.length} questions across ${Object.keys(dataset.categories).length} categories\n`);

  // Option to run subset
  const runSubset = process.argv.includes('--subset');
  const questions = runSubset
    ? dataset.questions.slice(0, 10) // First 10 for quick test
    : dataset.questions;

  if (runSubset) {
    console.log(`⚡ Running subset mode: ${questions.length} questions\n`);
  }

  // Select models to test
  const testModels = process.argv.includes('--mini-only')
    ? ['gpt-4o-mini']
    : process.argv.includes('--4o-only')
    ? ['gpt-4o']
    : MODELS;

  console.log(`🤖 Testing models: ${testModels.join(', ')}\n`);

  const allResults: TestResult[] = [];
  const totalTests = questions.length * testModels.length;
  let completed = 0;

  // Run tests for each model
  for (const model of testModels) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing Model: ${model}`);
    console.log(`${'='.repeat(60)}\n`);

    // Process in batches
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (q) => {
        const result = await runTest(q, model, dataset.scoring);
        completed++;

        const status = result.error ? '❌' : (result.metrics.totalScore > 0 ? '✅' : '⚠️');
        console.log(`${status} [${completed}/${totalTests}] ${model} | ${q.id}: Score ${result.metrics.totalScore.toFixed(1)} (${(result.metrics.totalTimeMs / 1000).toFixed(1)}s)`);

        return result;
      });

      const batchResults = await Promise.all(batchPromises);
      allResults.push(...batchResults);

      // Delay between batches
      if (i + BATCH_SIZE < questions.length) {
        await delay(DELAY_BETWEEN_BATCHES);
      }
    }
  }

  // Calculate summaries
  const summaries = testModels.map(model =>
    calculateModelSummary(allResults, model, dataset.categories)
  );

  // Generate and save report
  const report = generateReport(allResults, summaries, dataset);
  const reportPath = path.join(__dirname, `../tests/accuracy-report-${new Date().toISOString().split('T')[0]}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`\n📝 Report saved to: ${reportPath}`);

  // Save raw results as JSON
  const resultsPath = path.join(__dirname, `../tests/accuracy-results-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(resultsPath, JSON.stringify({ summaries, results: allResults }, null, 2));
  console.log(`📊 Raw results saved to: ${resultsPath}`);

  // Print summary to console
  console.log('\n' + '=' .repeat(80));
  console.log('SUMMARY');
  console.log('=' .repeat(80));

  for (const s of summaries) {
    console.log(`\n${s.model}:`);
    console.log(`  Success Rate: ${(s.successRate * 100).toFixed(1)}%`);
    console.log(`  Avg Total Score: ${s.avgTotalScore.toFixed(1)}`);
    console.log(`  Avg Time: ${(s.avgTotalTime / 1000).toFixed(1)}s`);
    console.log(`  Retrieval: ${s.avgRetrievalScore.toFixed(1)} | Generation: ${s.avgGenerationScore.toFixed(1)} | Citation: ${s.avgCitationScore.toFixed(1)}`);
  }

  // Recommendation
  const bestModel = summaries.reduce((best, s) => s.avgTotalScore > best.avgTotalScore ? s : best);
  console.log(`\n🏆 RECOMMENDED MODEL: ${bestModel.model} (Score: ${bestModel.avgTotalScore.toFixed(1)})`);
}

main().catch(console.error);
