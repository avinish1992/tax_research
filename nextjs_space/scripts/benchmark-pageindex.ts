#!/usr/bin/env npx tsx
/**
 * PageIndex Benchmark Script
 * Tests retrieval quality and timing on legal documents
 */

import * as fs from 'fs';
import * as path from 'path';
import { indexDocument } from '../lib/pageindex';
import { retrieveFromTree } from '../lib/pageindex/retriever';
import type { DocumentTree } from '../lib/pageindex/types';

import 'dotenv/config';

// Test queries for legal documents
const BENCHMARK_QUERIES = [
  {
    query: 'What are the conditions for participation exemption?',
    expectedKeywords: ['ownership', 'interest', 'conditions', 'exemption'],
  },
  {
    query: 'What is the minimum ownership requirement?',
    expectedKeywords: ['ownership', 'percent', '%', 'minimum'],
  },
  {
    query: 'When does this decision come into effect?',
    expectedKeywords: ['effect', 'date', 'publication', 'gazette'],
  },
  {
    query: 'What are the penalties for non-compliance?',
    expectedKeywords: ['penalty', 'penalties', 'violation', 'fine'],
  },
  {
    query: 'How is aggregation of ownership interests calculated?',
    expectedKeywords: ['aggregation', 'ownership', 'calculated', 'combined'],
  },
];

interface BenchmarkResult {
  query: string;
  indexingTimeMs: number;
  retrievalTimeMs: number;
  confidence: string;
  sourcesFound: number;
  keywordsMatched: number;
  totalKeywords: number;
  topSource: string;
}

async function runBenchmark(pdfPath: string): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  console.log(`\n📄 Benchmarking: ${path.basename(pdfPath)}`);
  console.log('─'.repeat(60));

  // Read PDF
  const buffer = fs.readFileSync(pdfPath);
  console.log(`   File size: ${(buffer.length / 1024).toFixed(1)} KB\n`);

  // Index document
  console.log('⏳ Indexing document...');
  const indexStart = Date.now();

  const tree: DocumentTree = await indexDocument(buffer, path.basename(pdfPath), {
    model: 'gpt-4o',
    add_node_id: true,
    add_node_text: true,
    add_node_summary: true,
    add_doc_description: true,
  });

  const indexingTimeMs = Date.now() - indexStart;
  console.log(`✅ Indexed in ${(indexingTimeMs / 1000).toFixed(1)}s\n`);

  // Run queries
  console.log('📝 Running benchmark queries...\n');

  for (const benchmark of BENCHMARK_QUERIES) {
    console.log(`   Query: "${benchmark.query}"`);

    const retrievalStart = Date.now();
    const result = await retrieveFromTree(tree, benchmark.query, {
      model: 'gpt-4o',
      maxSources: 3,
    });
    const retrievalTimeMs = Date.now() - retrievalStart;

    // Check keyword matches in retrieved content
    const content = result.content.toLowerCase();
    const matchedKeywords = benchmark.expectedKeywords.filter(
      kw => content.includes(kw.toLowerCase())
    );

    const benchmarkResult: BenchmarkResult = {
      query: benchmark.query,
      indexingTimeMs,
      retrievalTimeMs,
      confidence: result.confidence,
      sourcesFound: result.sources.length,
      keywordsMatched: matchedKeywords.length,
      totalKeywords: benchmark.expectedKeywords.length,
      topSource: result.sources[0]?.section_path || 'N/A',
    };

    results.push(benchmarkResult);

    console.log(`   ⏱️  ${(retrievalTimeMs / 1000).toFixed(1)}s | 🎯 ${result.confidence} | 📚 ${result.sources.length} sources | 🔍 ${matchedKeywords.length}/${benchmark.expectedKeywords.length} keywords`);
    console.log(`   └─ ${benchmarkResult.topSource}\n`);
  }

  return results;
}

function printSummary(results: BenchmarkResult[]) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 BENCHMARK SUMMARY');
  console.log('='.repeat(60));

  const avgRetrievalTime = results.reduce((sum, r) => sum + r.retrievalTimeMs, 0) / results.length;
  const avgKeywordMatch = results.reduce((sum, r) => sum + (r.keywordsMatched / r.totalKeywords), 0) / results.length;
  const highConfidenceCount = results.filter(r => r.confidence === 'high').length;

  console.log(`
| Metric                    | Value                |
|---------------------------|----------------------|
| Total queries             | ${results.length}                    |
| Avg retrieval time        | ${(avgRetrievalTime / 1000).toFixed(2)}s                |
| High confidence queries   | ${highConfidenceCount}/${results.length} (${((highConfidenceCount/results.length)*100).toFixed(0)}%)             |
| Avg keyword match rate    | ${(avgKeywordMatch * 100).toFixed(1)}%               |
| Indexing time             | ${(results[0].indexingTimeMs / 1000).toFixed(1)}s                 |
`);

  console.log('📈 Per-Query Results:');
  console.log('─'.repeat(60));

  for (const r of results) {
    const keywordRate = ((r.keywordsMatched / r.totalKeywords) * 100).toFixed(0);
    console.log(`  ${r.confidence === 'high' ? '✅' : r.confidence === 'medium' ? '⚠️' : '❌'} "${r.query.substring(0, 40)}..."`);
    console.log(`     Time: ${(r.retrievalTimeMs/1000).toFixed(1)}s | Keywords: ${keywordRate}% | Sources: ${r.sourcesFound}`);
  }
}

async function main() {
  console.log('=== PageIndex Benchmark Suite ===\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found');
    process.exit(1);
  }

  // Find test PDFs
  const testPdfs = [
    '/home/avinish/Downloads/tax_research/documents/Participation Exemption.pdf',
  ];

  const existingPdfs = testPdfs.filter(p => fs.existsSync(p));

  if (existingPdfs.length === 0) {
    console.error('❌ No test PDFs found');
    process.exit(1);
  }

  const allResults: BenchmarkResult[] = [];

  for (const pdfPath of existingPdfs) {
    try {
      const results = await runBenchmark(pdfPath);
      allResults.push(...results);
    } catch (error: any) {
      console.error(`❌ Failed to benchmark ${pdfPath}:`, error.message);
    }
  }

  if (allResults.length > 0) {
    printSummary(allResults);
  }

  console.log('\n✅ Benchmark complete!\n');
}

main();
