#!/usr/bin/env npx tsx
/**
 * PageIndex Integration Test Script
 * Tests the full flow: PDF parsing → Tree indexing → Retrieval
 */

import * as fs from 'fs';
import * as path from 'path';
import { indexDocument } from '../lib/pageindex';
import { retrieveFromTree, formatRetrievalAsContext, filterCitedSources } from '../lib/pageindex/retriever';

// Load environment variables
import 'dotenv/config';

async function main() {
  console.log('=== PageIndex Integration Test ===\n');

  // Check for OpenAI API key
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not found in environment');
    process.exit(1);
  }
  console.log('✅ OpenAI API key found\n');

  // Find a test PDF
  const testPdfPaths = [
    '/home/avinish/Downloads/tax_research/documents/Participation Exemption.pdf',
    '/home/avinish/Downloads/tax_research/documents/Requirements for Maintaining Transfer Pricing Docu.pdf',
  ];

  let testPdfPath = '';
  for (const p of testPdfPaths) {
    if (fs.existsSync(p)) {
      testPdfPath = p;
      break;
    }
  }

  if (!testPdfPath) {
    console.error('❌ No test PDF found');
    process.exit(1);
  }

  console.log(`📄 Using test PDF: ${path.basename(testPdfPath)}\n`);

  // Read PDF buffer
  const buffer = fs.readFileSync(testPdfPath);
  console.log(`   File size: ${(buffer.length / 1024).toFixed(1)} KB\n`);

  // Step 1: Index the document
  console.log('--- Step 1: Indexing Document ---');
  const startIndex = Date.now();

  try {
    const tree = await indexDocument(buffer, path.basename(testPdfPath), {
      model: 'gpt-4o',
      add_node_id: true,
      add_node_text: true,
      add_node_summary: true,
      add_doc_description: true,
    });

    const indexTime = ((Date.now() - startIndex) / 1000).toFixed(1);
    console.log(`✅ Indexing completed in ${indexTime}s`);
    console.log(`   Total pages: ${tree.metadata?.total_pages || 'N/A'}`);
    console.log(`   Top-level sections: ${tree.structure.length}`);
    console.log(`   Document description: ${tree.description?.substring(0, 100)}...`);

    // Print tree structure overview
    console.log('\n   Tree Structure:');
    for (const node of tree.structure.slice(0, 5)) {
      console.log(`   - ${node.title} (Pages ${node.start_index}-${node.end_index})`);
      if (node.nodes && node.nodes.length > 0) {
        for (const child of node.nodes.slice(0, 2)) {
          console.log(`     └─ ${child.title}`);
        }
        if (node.nodes.length > 2) {
          console.log(`     └─ ... and ${node.nodes.length - 2} more`);
        }
      }
    }
    if (tree.structure.length > 5) {
      console.log(`   ... and ${tree.structure.length - 5} more sections`);
    }

    // Step 2: Test retrieval
    console.log('\n--- Step 2: Testing Retrieval ---');
    const testQueries = [
      'What are the conditions for participation exemption?',
      'What documentation is required?',
    ];

    for (const query of testQueries) {
      console.log(`\n📝 Query: "${query}"`);
      const startRetrieval = Date.now();

      const result = await retrieveFromTree(tree, query, {
        model: 'gpt-4o',
        maxSources: 3,
      });

      const retrievalTime = ((Date.now() - startRetrieval) / 1000).toFixed(1);
      console.log(`   ⏱️  Retrieval time: ${retrievalTime}s`);
      console.log(`   🎯 Confidence: ${result.confidence}`);
      console.log(`   📚 Sources found: ${result.sources.length}`);

      for (const source of result.sources) {
        console.log(`   - [${source.node_id}] ${source.section_path} (Pages ${source.pages.start}-${source.pages.end})`);
      }

      if (result.reasoning) {
        console.log(`   💭 Reasoning: ${result.reasoning.substring(0, 150)}...`);
      }
    }

    console.log('\n=== Test Completed Successfully ===');
    console.log('✅ PageIndex integration is working correctly!\n');

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
