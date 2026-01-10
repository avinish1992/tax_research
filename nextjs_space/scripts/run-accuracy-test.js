#!/usr/bin/env node
/**
 * RAG Accuracy Test Runner
 *
 * Tests RAG retrieval accuracy by calling the chat API directly.
 * Much faster than Playwright browser tests.
 *
 * Usage:
 *   node scripts/run-accuracy-test.js                    # Run first 10 questions
 *   node scripts/run-accuracy-test.js --limit 50         # Run 50 questions
 *   node scripts/run-accuracy-test.js --limit all        # Run all 234 questions
 *   node scripts/run-accuracy-test.js --category basic   # Filter by category
 *   node scripts/run-accuracy-test.js --difficulty easy  # Filter by difficulty
 *   node scripts/run-accuracy-test.js --id Q001,Q002     # Run specific questions
 */

const fs = require('fs');
const path = require('path');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:5000';
const SESSION_COOKIE = process.env.SESSION_COOKIE || '';

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
};

const config = {
  limit: getArg('limit') || '10',
  category: getArg('category'),
  difficulty: getArg('difficulty'),
  ids: getArg('id')?.split(','),
  verbose: args.includes('--verbose') || args.includes('-v'),
};

// Load dataset
const datasetPath = path.join(__dirname, '../tests/test-dataset.json');
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));

// Filter questions
function getTestQuestions() {
  let questions = dataset.questions.filter(q => q.curation.status === 'active');

  // Filter by specific IDs
  if (config.ids) {
    questions = questions.filter(q => config.ids.includes(q.id));
    return questions;
  }

  // Filter by category
  if (config.category) {
    questions = questions.filter(q => q.category === config.category);
  }

  // Filter by difficulty
  if (config.difficulty) {
    questions = questions.filter(q => q.difficulty === config.difficulty);
  }

  // Filter out negative/ambiguous tests by default
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
    // Handle keywords with alternatives (separated by ;)
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
  return expectedArticles.some(article =>
    lowerResponse.includes(article.toLowerCase())
  );
}

// Call test accuracy API (bypasses auth in dev mode)
async function sendQuery(query) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (SESSION_COOKIE) {
    headers['Cookie'] = SESSION_COOKIE;
  }

  // Use the test accuracy endpoint which bypasses auth
  const response = await fetch(`${API_URL}/api/test/accuracy`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  // Test endpoint returns JSON directly
  const data = await response.json();

  return {
    response: data.response || '',
    sources: data.sources || [],
    reasoning: data.reasoning,
    metrics: data.metrics,
  };
}

// Generate reports
function generateReport(results, startTime) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportDir = path.join(__dirname, '../tests/accuracy-reports');

  // Ensure directory exists
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  // Calculate summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const avgKeywordAccuracy = results.reduce((sum, r) => sum + r.keywordAccuracy, 0) / results.length;
  const articleMatchRate = results.filter(r => r.articleMatch).length / results.length;
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const totalDuration = Date.now() - startTime;

  // Group by category
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, passed: 0, avgAccuracy: 0 };
    }
    byCategory[r.category].total++;
    if (r.passed) byCategory[r.category].passed++;
    byCategory[r.category].avgAccuracy += r.keywordAccuracy;
  }
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].avgAccuracy /= byCategory[cat].total;
  }

  // Group by difficulty
  const byDifficulty = {};
  for (const r of results) {
    if (!byDifficulty[r.difficulty]) {
      byDifficulty[r.difficulty] = { total: 0, passed: 0, avgAccuracy: 0 };
    }
    byDifficulty[r.difficulty].total++;
    if (r.passed) byDifficulty[r.difficulty].passed++;
    byDifficulty[r.difficulty].avgAccuracy += r.keywordAccuracy;
  }
  for (const diff of Object.keys(byDifficulty)) {
    byDifficulty[diff].avgAccuracy /= byDifficulty[diff].total;
  }

  const report = {
    metadata: {
      timestamp,
      apiUrl: API_URL,
      totalQuestions: results.length,
      datasetVersion: dataset.metadata.version,
      totalDuration: `${(totalDuration / 1000).toFixed(1)}s`,
      filters: {
        category: config.category || 'all',
        difficulty: config.difficulty || 'all',
        limit: config.limit,
        ids: config.ids?.join(',') || null,
      },
    },
    summary: {
      passed,
      failed,
      passRate: `${(passed / results.length * 100).toFixed(1)}%`,
      avgKeywordAccuracy: `${(avgKeywordAccuracy * 100).toFixed(1)}%`,
      articleMatchRate: `${(articleMatchRate * 100).toFixed(1)}%`,
      avgDuration: `${avgDuration.toFixed(0)}ms`,
      overallScore: `${((avgKeywordAccuracy + articleMatchRate) / 2 * 100).toFixed(1)}%`,
    },
    byCategory,
    byDifficulty,
    results: results.map(r => ({
      ...r,
      response: config.verbose ? r.response : undefined,
    })),
  };

  // Save JSON report
  const jsonPath = path.join(reportDir, `accuracy-report-${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Save markdown report
  const mdPath = path.join(reportDir, `accuracy-report-${timestamp}.md`);
  const mdContent = generateMarkdownReport(report);
  fs.writeFileSync(mdPath, mdContent);

  // Save as latest
  fs.writeFileSync(path.join(reportDir, 'latest-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(reportDir, 'latest-report.md'), mdContent);

  return { report, jsonPath, mdPath };
}

function generateMarkdownReport(report) {
  let md = `# RAG Accuracy Test Report

**Generated:** ${report.metadata.timestamp}
**API URL:** ${report.metadata.apiUrl}
**Dataset Version:** ${report.metadata.datasetVersion}
**Questions Tested:** ${report.metadata.totalQuestions}
**Total Duration:** ${report.metadata.totalDuration}

## Summary

| Metric | Value |
|--------|-------|
| Pass Rate | ${report.summary.passRate} |
| Keyword Accuracy | ${report.summary.avgKeywordAccuracy} |
| Article Match Rate | ${report.summary.articleMatchRate} |
| Average Query Time | ${report.summary.avgDuration} |
| **Overall Score** | **${report.summary.overallScore}** |

## By Category

| Category | Total | Passed | Pass Rate | Avg Accuracy |
|----------|-------|--------|-----------|--------------|
`;

  for (const [cat, stats] of Object.entries(report.byCategory)) {
    md += `| ${cat} | ${stats.total} | ${stats.passed} | ${(stats.passed/stats.total*100).toFixed(0)}% | ${(stats.avgAccuracy*100).toFixed(0)}% |\n`;
  }

  md += `
## By Difficulty

| Difficulty | Total | Passed | Pass Rate | Avg Accuracy |
|------------|-------|--------|-----------|--------------|
`;

  for (const [diff, stats] of Object.entries(report.byDifficulty)) {
    md += `| ${diff} | ${stats.total} | ${stats.passed} | ${(stats.passed/stats.total*100).toFixed(0)}% | ${(stats.avgAccuracy*100).toFixed(0)}% |\n`;
  }

  md += `
## Detailed Results

`;

  for (const r of report.results) {
    const status = r.passed ? '✅' : '❌';
    md += `### ${status} ${r.id}: ${r.query.substring(0, 60)}${r.query.length > 60 ? '...' : ''}

- **Category:** ${r.category} | **Difficulty:** ${r.difficulty}
- **Keyword Accuracy:** ${(r.keywordAccuracy * 100).toFixed(0)}%
- **Article Match:** ${r.articleMatch ? 'Yes' : 'No'}
- **Sources:** ${r.sourceCount}
- **Duration:** ${r.duration}ms
`;

    if (r.missingKeywords && r.missingKeywords.length > 0) {
      md += `- **Missing Keywords:** ${r.missingKeywords.join(', ')}\n`;
    }

    if (r.error) {
      md += `- **Error:** ${r.error}\n`;
    }

    md += '\n';
  }

  return md;
}

// Main execution
async function main() {
  const questions = getTestQuestions();
  const results = [];
  const startTime = Date.now();

  console.log('\n🧪 RAG Accuracy Test Runner\n');
  console.log(`📊 Dataset: ${dataset.metadata.total_questions} total questions`);
  console.log(`🎯 Testing: ${questions.length} questions`);
  console.log(`📁 Filters: category=${config.category || 'all'}, difficulty=${config.difficulty || 'all'}`);
  console.log(`🌐 API: ${API_URL}\n`);
  console.log('─'.repeat(60));

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const queryStart = Date.now();

    process.stdout.write(`[${i + 1}/${questions.length}] ${question.id}: `);

    try {
      const { response, sources } = await sendQuery(question.query);
      const duration = Date.now() - queryStart;

      // Check keywords
      const keywordCheck = checkKeywords(response, question.expected_keywords);

      // Check articles
      const articleMatch = checkArticles(response, question.expected_articles);

      // Determine pass/fail
      const isPassed = keywordCheck.accuracy >= 0.5 || question.expected_keywords.length === 0;

      if (isPassed) {
        passed++;
        process.stdout.write(`✅ ${(keywordCheck.accuracy * 100).toFixed(0)}%`);
      } else {
        failed++;
        process.stdout.write(`❌ ${(keywordCheck.accuracy * 100).toFixed(0)}%`);
      }

      console.log(` (${duration}ms)`);

      results.push({
        id: question.id,
        query: question.query,
        category: question.category,
        difficulty: question.difficulty,
        keywordAccuracy: keywordCheck.accuracy,
        foundKeywords: keywordCheck.found,
        missingKeywords: keywordCheck.missing,
        articleMatch,
        expectedArticles: question.expected_articles,
        sourceCount: sources.length,
        responseLength: response.length,
        response: config.verbose ? response : undefined,
        passed: isPassed,
        duration,
      });

    } catch (error) {
      const duration = Date.now() - queryStart;
      failed++;
      console.log(`❌ ERROR (${duration}ms)`);

      if (config.verbose) {
        console.log(`   Error: ${error.message || error}`);
      }

      results.push({
        id: question.id,
        query: question.query,
        category: question.category,
        difficulty: question.difficulty,
        keywordAccuracy: 0,
        foundKeywords: [],
        missingKeywords: question.expected_keywords,
        articleMatch: false,
        expectedArticles: question.expected_articles,
        sourceCount: 0,
        responseLength: 0,
        passed: false,
        error: error.message || String(error),
        duration,
      });
    }
  }

  console.log('─'.repeat(60));

  // Generate reports
  const { report, jsonPath, mdPath } = generateReport(results, startTime);

  console.log('\n📊 ACCURACY SUMMARY');
  console.log('═'.repeat(40));
  console.log(`   Total: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
  console.log(`   Keyword Accuracy: ${report.summary.avgKeywordAccuracy}`);
  console.log(`   Article Match: ${report.summary.articleMatchRate}`);
  console.log(`   Overall Score: ${report.summary.overallScore}`);
  console.log(`   Duration: ${report.metadata.totalDuration}`);
  console.log('═'.repeat(40));
  console.log(`\n📁 Reports saved to:`);
  console.log(`   ${jsonPath}`);
  console.log(`   ${mdPath}`);
  console.log(`   tests/accuracy-reports/latest-report.json`);
  console.log(`   tests/accuracy-reports/latest-report.md\n`);

  // Exit with error code if any failed
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
