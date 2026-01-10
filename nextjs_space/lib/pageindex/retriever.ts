/**
 * PageIndex Retriever
 * TypeScript port of VectifyAI/PageIndex tree-based retrieval
 *
 * Replaces vector similarity search with LLM reasoning through document structure
 */

import OpenAI from 'openai';
import {
  DocumentTree,
  TreeNode,
  RetrievalResult,
  RetrievalSource,
  SimplifiedTreeNode,
} from './types';
import { TREE_RETRIEVAL_PROMPT } from './prompts';
import { rerankSources, isRerankingAvailable, keywordRerank, type RerankedSource } from './reranker';

// Lazy OpenAI client initialization
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return _openai;
}

/**
 * Extract JSON from LLM response
 */
function extractJSON(content: string): any {
  try {
    let jsonContent = content;
    if (content.includes('```json')) {
      const start = content.indexOf('```json') + 7;
      const end = content.lastIndexOf('```');
      jsonContent = content.substring(start, end).trim();
    } else if (content.includes('```')) {
      const start = content.indexOf('```') + 3;
      const end = content.lastIndexOf('```');
      jsonContent = content.substring(start, end).trim();
    }

    jsonContent = jsonContent
      .replace(/None/g, 'null')
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/,\s*]/g, ']')
      .replace(/,\s*}/g, '}');

    return JSON.parse(jsonContent);
  } catch (error) {
    console.error('Failed to parse JSON:', error);
    return {};
  }
}

/**
 * Create simplified tree structure for LLM (reduces token usage)
 * Uses minimal format: just node_id, title, and pages - no summaries
 * This allows sending the full tree structure within token limits
 */
function getSimplifiedTree(nodes: TreeNode[], depth: number = 0): SimplifiedTreeNode[] {
  const result: SimplifiedTreeNode[] = [];

  for (const node of nodes) {
    // Minimal structure - title and pages are enough for LLM to reason about relevance
    const simplified: SimplifiedTreeNode = {
      node_id: node.node_id || '',
      title: node.title,
      pages: `${node.start_index}-${node.end_index}`,
    };

    // Only include children titles for top-level nodes to show structure
    if (depth === 0 && node.nodes && node.nodes.length > 0) {
      simplified.children = node.nodes.map((n) => n.title);
    }

    result.push(simplified);

    // Recursively add children
    if (node.nodes) {
      result.push(...getSimplifiedTree(node.nodes, depth + 1));
    }
  }

  return result;
}

/**
 * Find a node by its ID in the tree
 */
function findNodeById(nodes: TreeNode[], nodeId: string): TreeNode | null {
  for (const node of nodes) {
    if (node.node_id === nodeId) {
      return node;
    }
    if (node.nodes) {
      const found = findNodeById(node.nodes, nodeId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Build section path (breadcrumb) for a node
 */
function buildSectionPath(nodes: TreeNode[], targetId: string, path: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.node_id === targetId) {
      return [...path, node.title];
    }
    if (node.nodes) {
      const result = buildSectionPath(node.nodes, targetId, [...path, node.title]);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Main retrieval function - uses LLM reasoning to find relevant sections
 */
export async function retrieveFromTree(
  tree: DocumentTree,
  query: string,
  options?: {
    model?: string;
    maxSources?: number;
  }
): Promise<RetrievalResult> {
  const model = options?.model || 'gpt-4o';
  const maxSources = options?.maxSources || 5;

  console.log('PageIndex Retriever: Processing query...');
  console.log(`  - Query: "${query.substring(0, 100)}..."`);

  // Step 1: Create simplified tree for LLM
  const simplifiedTree = getSimplifiedTree(tree.structure);

  // Convert to JSON - with minimal structure, 91 nodes should be ~10-15k chars
  const treeJson = JSON.stringify(simplifiedTree, null, 2);

  // Debug: Log tree size and check for Article 50
  console.log(`  - Simplified tree size: ${treeJson.length} chars, ${simplifiedTree.length} nodes`);
  const hasArticle50 = treeJson.includes('Article 50');
  console.log(`  - Contains 'Article 50': ${hasArticle50}`);

  // Increase limit to 100k to accommodate large legal documents
  // With minimal structure (no summaries), this allows ~500+ nodes
  const truncatedTree = treeJson.substring(0, 100000);

  // Step 2: Call LLM to reason about relevant sections
  const prompt = TREE_RETRIEVAL_PROMPT(truncatedTree, query);

  const response = await getOpenAI().chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
  });

  const rawResponse = response.choices[0].message.content || '';
  const result = extractJSON(rawResponse);

  // Debug: Log first 300 chars of raw response
  console.log(`  - LLM raw response: ${rawResponse.substring(0, 300)}...`);

  const nodeIds: string[] = result.relevant_nodes || [];
  const reasoning: string = result.thinking || '';
  const confidence: 'high' | 'medium' | 'low' = result.confidence || 'medium';

  console.log(`  - Found ${nodeIds.length} relevant sections`);
  console.log(`  - Node IDs: ${nodeIds.slice(0, 5).join(', ')}${nodeIds.length > 5 ? '...' : ''}`);
  console.log(`  - Confidence: ${confidence}`);

  // Step 3: Extract content and build sources
  const sources: RetrievalSource[] = [];
  const contentParts: string[] = [];

  for (const nodeId of nodeIds.slice(0, maxSources)) {
    const node = findNodeById(tree.structure, nodeId);
    if (!node) {
      console.log(`  - Warning: Node ${nodeId} not found`);
      continue;
    }

    const sectionPath = buildSectionPath(tree.structure, nodeId) || [node.title];

    sources.push({
      node_id: nodeId,
      title: node.title,
      section_path: sectionPath.join(' > '),
      pages: {
        start: node.start_index,
        end: node.end_index,
      },
      content: node.text || '',
      summary: node.summary,
    });

    if (node.text) {
      contentParts.push(node.text);
    }
  }

  return {
    node_ids: nodeIds,
    reasoning,
    confidence,
    content: contentParts.join('\n\n---\n\n'),
    sources,
    usage: response.usage ? {
      prompt_tokens: response.usage.prompt_tokens,
      completion_tokens: response.usage.completion_tokens,
      total_tokens: response.usage.total_tokens,
    } : undefined,
  };
}

/**
 * Format retrieval result as context for LLM chat
 * Includes numbered sources for citation
 */
export function formatRetrievalAsContext(result: RetrievalResult): string {
  if (result.sources.length === 0) {
    return 'No relevant information found in the document.';
  }

  const contextParts: string[] = [];

  for (let i = 0; i < result.sources.length; i++) {
    const source = result.sources[i];
    const sourceHeader = `[${i + 1}] ${source.section_path} (Pages ${source.pages.start}-${source.pages.end})`;

    // Include summary for quick reference
    const summary = source.summary ? `\nSummary: ${source.summary}\n` : '';

    // Include full content
    const content = source.content || 'Content not available.';

    contextParts.push(`${sourceHeader}${summary}\n${content}`);
  }

  return contextParts.join('\n\n' + '='.repeat(80) + '\n\n');
}

/**
 * Format sources for frontend display (citation panel)
 */
export function formatSourcesForDisplay(
  result: RetrievalResult,
  documentId: string,
  documentName: string,
  fileUrl?: string
): Array<{
  index: number;
  nodeId: string;
  fileName: string;
  sectionPath: string;
  pageStart: number;
  pageEnd: number;
  content: string;
  summary?: string;
  documentId: string;
  fileUrl?: string;
}> {
  return result.sources.map((source, index) => ({
    index: index + 1,
    nodeId: source.node_id,
    fileName: documentName,
    sectionPath: source.section_path,
    pageStart: source.pages.start,
    pageEnd: source.pages.end,
    content: source.content.substring(0, 500),
    summary: source.summary,
    documentId,
    fileUrl,
  }));
}

/**
 * Filter sources to only those actually cited in response
 * Similar to current system's citation filtering
 */
export function filterCitedSources(
  response: string,
  sources: RetrievalSource[]
): RetrievalSource[] {
  // Find all citation numbers in response
  const citationPattern = /\[(\d+)\]/g;
  const citedNumbers = new Set<number>();

  let match;
  while ((match = citationPattern.exec(response)) !== null) {
    citedNumbers.add(parseInt(match[1], 10));
  }

  // Filter and return only cited sources
  return sources.filter((_, index) => citedNumbers.has(index + 1));
}

/**
 * Renumber citations in response text after filtering
 */
export function renumberCitations(
  response: string,
  originalSources: RetrievalSource[],
  filteredSources: RetrievalSource[]
): string {
  // Build mapping from old numbers to new numbers
  const oldToNew: Record<number, number> = {};
  let newIndex = 1;

  for (let i = 0; i < originalSources.length; i++) {
    if (filteredSources.includes(originalSources[i])) {
      oldToNew[i + 1] = newIndex++;
    }
  }

  // Replace citations in response
  return response.replace(/\[(\d+)\]/g, (match, num) => {
    const oldNum = parseInt(num, 10);
    const newNum = oldToNew[oldNum];
    return newNum ? `[${newNum}]` : match;
  });
}

/**
 * Get retrieval for multiple documents (for multi-document queries)
 * Includes optional cross-encoder reranking for improved precision
 *
 * RERANKING IS DISABLED BY DEFAULT for Supabase compatibility.
 * Set enableReranking=true and configure JINA_API_KEY or COHERE_API_KEY to enable.
 */
export async function retrieveFromMultipleTrees(
  trees: Array<{ tree: DocumentTree; documentId: string }>,
  query: string,
  options?: {
    model?: string;
    maxSourcesPerDoc?: number;
    enableReranking?: boolean;  // Enable reranking (default: FALSE - disabled)
    maxFinalSources?: number;   // Max sources (default: 5)
    minRerankScore?: number;    // Minimum rerank score (default: 0.3)
  }
): Promise<{
  results: Array<{ documentId: string; result: RetrievalResult }>;
  combinedContent: string;
  allSources: RetrievalSource[];
  reranked?: boolean;
}> {
  const {
    enableReranking = false,  // DISABLED by default for Supabase compatibility
    maxFinalSources = 5,
    minRerankScore = 0.3,
  } = options || {};

  const results = await Promise.all(
    trees.map(async ({ tree, documentId }) => ({
      documentId,
      result: await retrieveFromTree(tree, query, {
        model: options?.model,
        maxSources: options?.maxSourcesPerDoc,
      }),
    }))
  );

  // Combine content and sources
  let allSources: RetrievalSource[] = [];
  const contentParts: string[] = [];

  for (const { result } of results) {
    allSources.push(...result.sources);
    if (result.content) {
      contentParts.push(result.content);
    }
  }

  // Limit sources if we have too many (simple truncation when reranking disabled)
  if (allSources.length > maxFinalSources && !enableReranking) {
    allSources = allSources.slice(0, maxFinalSources);
  }

  // Apply reranking only if explicitly enabled
  let reranked = false;
  if (enableReranking && allSources.length > maxFinalSources && isRerankingAvailable()) {
    try {
      console.log(`\n🔄 Reranking ${allSources.length} sources...`);

      const rerankedSources = await rerankSources(query, allSources, {
        topK: maxFinalSources,
        minScore: minRerankScore,
      });

      console.log(`   Original: ${allSources.length} sources`);
      console.log(`   After reranking: ${rerankedSources.length} sources`);
      if (rerankedSources.length > 0) {
        console.log(`   Top score: ${rerankedSources[0].rerankedScore.toFixed(3)}`);
      }

      allSources = rerankedSources;
      reranked = true;
    } catch (error) {
      console.error('   Reranking failed, using original order:', error);
      allSources = allSources.slice(0, maxFinalSources);
    }
  }

  return {
    results,
    combinedContent: contentParts.join('\n\n===\n\n'),
    allSources,
    reranked,
  };
}
