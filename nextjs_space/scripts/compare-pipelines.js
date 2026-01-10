#!/usr/bin/env node
/**
 * Pipeline Comparison Test
 *
 * Runs the same questions against different pipeline configurations
 * and compares accuracy, speed, and cost.
 *
 * Configurations tested:
 * - 1 document (baseline, fastest)
 * - 3 documents (parallel)
 * - 5 documents (parallel)
 *
 * Usage:
 *   node scripts/compare-pipelines.js                    # Run first 10 questions
 *   node scripts/compare-pipelines.js --limit 30         # Run 30 questions
 *   node scripts/compare-pipelines.js --limit all        # Run all questions
 */

const fs = require('fs');
const path = require('path');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5000';

// Pipeline configurations to test
const PIPELINES = [
  { name: '1-doc', maxDocs: 1, retrievalModel: 'gpt-4o-mini', maxSourcesPerDoc: 5 },
  { name: '3-docs-parallel', maxDocs: 3, retrievalModel: 'gpt-4o-mini', maxSourcesPerDoc: 3 },
  { name: '5-docs-parallel', maxDocs: 5, retrievalModel: 'gpt-4o-mini', maxSourcesPerDoc: 3 },
  { name: '10-docs-parallel', maxDocs: 10, retrievalModel: 'gpt-4o-mini', maxSourcesPerDoc: 3 },
];

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
};

const config = {
  limit: getArg('limit') || '10',
  verbose: args.includes('--verbose') || args.includes('-v'),
};

// Load dataset
const datasetPath = path.join(__dirname, '../tests/test-dataset.json');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));

// Filter questions
function getTestQuestions() {
  let questions = dataset.questions.filter(q => q.curation.status === 'active');

  // Filter out negative/ambiguous tests
  questions = questions.filter(q =>
    q.category !== 'negative' &&
    q.category !== 'ambiguous' &&
    q.category !== 'vague'
  );

  // Apply limit
  if (config.limit !== 'all') {
    const numLimit = parseInt(config.limit, 10);
    if (!isNaN(numLimit)) {
      questions = questions.slice(0, numLimit);
    }
  }

  return questions;
}

// Check keywords in response
function checkKeywords(response, expectedKeywords) {
  if (!expectedKeywords || expectedKeywords.length === 0) {
    return { found: [], missing: [], accuracy: 1 };
  }

  const lowerResponse = response.toLowerCase();
  const found = [];
  const missing = [];

  for (const keyword of expectedKeywords) {
    const alternatives = keyword.split(';').map(k => k.trim().toLowerCase());
    const foundAny = alternatives.some(alt => lowerResponse.includes(alt));

    if (foundAny) {
      found.push(keyword);
    } else {
      missing.push(keyword);
    }
  }

  return {
    found,
    missing,
    accuracy: found.length / expectedKeywords.length,
  };
}

// Check article references
function checkArticles(response, expectedArticles) {
  if (!expectedArticles || expectedArticles.length === 0) return true;
  const lowerResponse = response.toLowerCase();
  return expectedArticles.some(article => lowerResponse.includes(article.toLowerCase()));
}

// Call test accuracy API with specific pipeline config
async function sendQuery(query, pipelineConfig) {
  const response = await fetch(`${API_URL}/api/test/accuracy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      ...pipelineConfig,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Run a single pipeline configuration
async function runPipeline(pipelineName, pipelineConfig, questions) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 Pipeline: ${pipelineName}`);
  console.log(`   Config: maxDocs=${pipelineConfig.maxDocs}, model=${pipelineConfig.retrievalModel}`);
  console.log(`${'='.repeat(60)}\n`);

  const results = [];
  let totalCost = 0;
  let totalTokens = 0;

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const queryStart = Date.now();

    process.stdout.write(`[${i + 1}/${questions.length}] ${question.id}: `);

    try {
      const data = await sendQuery(question.query, pipelineConfig);
      const duration = Date.now() - queryStart;

      // Check keywords
      const keywordCheck = checkKeywords(data.response, question.expected_keywords);
      const isPassed = keywordCheck.accuracy >= 0.5 || question.expected_keywords.length === 0;

      // Check article matches
      const articleMatch = checkArticles(data.response, question.expected_articles);

      // Track cost
      const queryCost = data.cost?.total || 0;
      const queryTokens = data.tokens?.total?.total || 0;
      totalCost += queryCost;
      totalTokens += queryTokens;

      if (isPassed) {
        process.stdout.write(`✅ ${(keywordCheck.accuracy * 100).toFixed(0)}%`);
      } else {
        process.stdout.write(`❌ ${(keywordCheck.accuracy * 100).toFixed(0)}%`);
      }

      console.log(` (${duration}ms, $${queryCost.toFixed(5)})`);

      results.push({
        id: question.id,
        query: question.query,
        category: question.category,
        difficulty: question.difficulty,
        response: data.response,
        keywordAccuracy: keywordCheck.accuracy,
        foundKeywords: keywordCheck.found,
        missingKeywords: keywordCheck.missing,
        articleMatch,
        expectedArticles: question.expected_articles,
        passed: isPassed,
        duration,
        sourceCount: data.sources?.length || 0,
        tokens: data.tokens,
        cost: queryCost,
      });

    } catch (error) {
      const duration = Date.now() - queryStart;
      console.log(`❌ ERROR (${duration}ms)`);

      results.push({
        id: question.id,
        query: question.query,
        category: question.category,
        difficulty: question.difficulty,
        response: '',
        keywordAccuracy: 0,
        foundKeywords: [],
        missingKeywords: question.expected_keywords,
        passed: false,
        duration,
        sourceCount: 0,
        tokens: null,
        cost: 0,
        error: error.message,
      });
    }
  }

  // Calculate summary - ALL METRICS
  const passed = results.filter(r => r.passed).length;
  const avgKeywordAccuracy = results.reduce((sum, r) => sum + r.keywordAccuracy, 0) / results.length;
  const articleMatchCount = results.filter(r => r.articleMatch).length;
  const articleMatchRate = articleMatchCount / results.length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const overallScore = (avgKeywordAccuracy + articleMatchRate) / 2;

  return {
    pipeline: pipelineName,
    config: pipelineConfig,
    results,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: passed / results.length,
      avgKeywordAccuracy,
      articleMatchRate,
      overallScore,
      avgDuration,
      totalCost,
      totalTokens,
      costPerQuery: totalCost / results.length,
    },
  };
}

// Generate comparison report
function generateComparisonReport(pipelineResults, startTime) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportDir = path.join(__dirname, '../tests/accuracy-reports');

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // Build comparison data
  const comparison = {
    metadata: {
      timestamp,
      apiUrl: API_URL,
      totalQuestions: pipelineResults[0].results.length,
      totalDuration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      pipelines: PIPELINES.map(p => p.name),
    },
    summaryTable: pipelineResults.map(p => ({
      pipeline: p.pipeline,
      passRate: `${(p.summary.passRate * 100).toFixed(1)}%`,
      keywordAccuracy: `${(p.summary.avgKeywordAccuracy * 100).toFixed(1)}%`,
      articleMatchRate: `${(p.summary.articleMatchRate * 100).toFixed(1)}%`,
      overallScore: `${(p.summary.overallScore * 100).toFixed(1)}%`,
      avgDuration: `${p.summary.avgDuration.toFixed(0)}ms`,
      totalCost: `$${p.summary.totalCost.toFixed(4)}`,
      costPerQuery: `$${p.summary.costPerQuery.toFixed(5)}`,
      totalTokens: p.summary.totalTokens,
    })),
    questionComparison: [],
  };

  // Build per-question comparison
  const questions = pipelineResults[0].results;
  for (let i = 0; i < questions.length; i++) {
    const questionId = questions[i].id;
    const query = questions[i].query;

    const questionData = {
      id: questionId,
      query: query.substring(0, 80) + (query.length > 80 ? '...' : ''),
      pipelines: {},
    };

    for (const pResult of pipelineResults) {
      const result = pResult.results[i];
      questionData.pipelines[pResult.pipeline] = {
        passed: result.passed,
        accuracy: result.keywordAccuracy,
        response: result.response,
        duration: result.duration,
        cost: result.cost,
      };
    }

    comparison.questionComparison.push(questionData);
  }

  // Save JSON report
  const jsonPath = path.join(reportDir, `pipeline-comparison-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(comparison, null, 2));

  // Generate markdown report
  let md = `# Pipeline Comparison Report

**Generated:** ${timestamp}
**Questions Tested:** ${comparison.metadata.totalQuestions}
**Total Duration:** ${comparison.metadata.totalDuration}

## Summary Comparison

| Pipeline | Pass Rate | Keyword Acc | Article Match | Overall Score | Avg Duration | Cost/Query | Tokens |
|----------|-----------|-------------|---------------|---------------|--------------|------------|--------|
`;

  for (const row of comparison.summaryTable) {
    md += `| ${row.pipeline} | ${row.passRate} | ${row.keywordAccuracy} | ${row.articleMatchRate} | ${row.overallScore} | ${row.avgDuration} | ${row.costPerQuery} | ${row.totalTokens} |\n`;
  }

  md += `
## Per-Question Comparison

| ID | Query | `;

  for (const p of PIPELINES) {
    md += `${p.name} | `;
  }
  md += '\n|-----|-------|';
  for (const p of PIPELINES) {
    md += '--------|';
  }
  md += '\n';

  for (const q of comparison.questionComparison) {
    md += `| ${q.id} | ${q.query.substring(0, 40)}... | `;
    for (const p of PIPELINES) {
      const data = q.pipelines[p.name];
      const icon = data.passed ? '✅' : '❌';
      md += `${icon} ${(data.accuracy * 100).toFixed(0)}% | `;
    }
    md += '\n';
  }

  md += `
## Answer Comparison (First 5 Questions)

`;

  for (let i = 0; i < Math.min(5, comparison.questionComparison.length); i++) {
    const q = comparison.questionComparison[i];
    md += `### ${q.id}: ${q.query}\n\n`;

    for (const p of PIPELINES) {
      const data = q.pipelines[p.name];
      const icon = data.passed ? '✅' : '❌';
      md += `**${p.name}** ${icon} (${(data.accuracy * 100).toFixed(0)}%, $${data.cost.toFixed(5)}):\n`;
      md += `> ${data.response.substring(0, 300)}${data.response.length > 300 ? '...' : ''}\n\n`;
    }
  }

  const mdPath = path.join(reportDir, `pipeline-comparison-${timestamp}.md`);
  fs.writeFileSync(mdPath, md);

  // Save as latest
  fs.writeFileSync(path.join(reportDir, 'latest-comparison.json'), JSON.stringify(comparison, null, 2));
  fs.writeFileSync(path.join(reportDir, 'latest-comparison.md'), md);

  // Generate CSV with answers for all pipelines
  const csvPath = path.join(reportDir, `pipeline-comparison-${timestamp}.csv`);
  let csv = 'ID,Query,Category,Difficulty';
  for (const p of PIPELINES) {
    csv += `,${p.name}_passed,${p.name}_accuracy,${p.name}_duration_ms,${p.name}_cost_usd,${p.name}_answer`;
  }
  csv += '\n';

  // Get category/difficulty from first pipeline results
  const firstPipelineResults = pipelineResults[0].results;

  for (let i = 0; i < comparison.questionComparison.length; i++) {
    const q = comparison.questionComparison[i];
    const firstResult = firstPipelineResults[i];
    // Escape quotes in query
    const escapedQuery = q.query.replace(/"/g, '""');
    csv += `"${q.id}","${escapedQuery}","${firstResult?.category || ''}","${firstResult?.difficulty || ''}"`;

    for (const p of PIPELINES) {
      const data = q.pipelines[p.name];
      if (data) {
        const escapedAnswer = (data.response || '').replace(/"/g, '""').replace(/\n/g, ' ');
        csv += `,${data.passed},${(data.accuracy * 100).toFixed(0)}%,${data.duration},${data.cost.toFixed(5)},"${escapedAnswer.substring(0, 500)}"`;
      } else {
        csv += `,,,,,`;
      }
    }
    csv += '\n';
  }

  fs.writeFileSync(csvPath, csv);
  fs.writeFileSync(path.join(reportDir, 'latest-comparison.csv'), csv);

  return { comparison, jsonPath, mdPath, csvPath };
}

// Main execution
async function main() {
  const questions = getTestQuestions();
  const startTime = Date.now();

  console.log('\n🔬 Pipeline Comparison Test\n');
  console.log(`📊 Dataset: ${dataset.metadata.total_questions} total questions`);
  console.log(`🎯 Testing: ${questions.length} questions`);
  console.log(`🔧 Pipelines: ${PIPELINES.map(p => p.name).join(', ')}`);
  console.log(`🌐 API: ${API_URL}`);

  const pipelineResults = [];

  // Run each pipeline
  for (const pipeline of PIPELINES) {
    const result = await runPipeline(pipeline.name, pipeline, questions);
    pipelineResults.push(result);
  }

  // Generate comparison report
  const { comparison, jsonPath, mdPath } = generateComparisonReport(pipelineResults, startTime);

  // Print final summary
  console.log('\n' + '='.repeat(100));
  console.log('📊 PIPELINE COMPARISON SUMMARY');
  console.log('='.repeat(100));
  console.log('\n| Pipeline          | Pass Rate | Keyword Acc | Article Match | Overall | Avg Time | Cost/Query |');
  console.log('|-------------------|-----------|-------------|---------------|---------|----------|------------|');

  for (const row of comparison.summaryTable) {
    console.log(`| ${row.pipeline.padEnd(17)} | ${row.passRate.padEnd(9)} | ${row.keywordAccuracy.padEnd(11)} | ${row.articleMatchRate.padEnd(13)} | ${row.overallScore.padEnd(7)} | ${row.avgDuration.padEnd(8)} | ${row.costPerQuery.padEnd(10)} |`);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`📁 Reports saved to:`);
  console.log(`   ${jsonPath}`);
  console.log(`   ${mdPath}`);
  console.log(`   tests/accuracy-reports/latest-comparison.json`);
  console.log(`   tests/accuracy-reports/latest-comparison.md\n`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
