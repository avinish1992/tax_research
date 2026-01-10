/**
 * PageIndex Indexer
 * TypeScript port of VectifyAI/PageIndex tree building logic
 *
 * Creates hierarchical document trees from PDFs
 */

import OpenAI from 'openai';
import {
  DocumentTree,
  TreeNode,
  TOCDetectionResult,
  TOCItem,
  PageContent,
  IndexingOptions,
  DEFAULT_INDEXING_OPTIONS,
} from './types';
import {
  TOC_DETECTOR_PROMPT,
  TOC_TRANSFORMER_PROMPT,
  PAGE_INDEX_DETECTOR_PROMPT,
  TOC_INDEX_EXTRACTOR_PROMPT,
  GENERATE_TOC_INIT_PROMPT,
  GENERATE_TOC_CONTINUE_PROMPT,
  TITLE_VERIFICATION_PROMPT,
  TITLE_START_CHECK_PROMPT,
  NODE_SUMMARY_PROMPT,
  DOC_DESCRIPTION_PROMPT,
  ADD_PAGE_NUMBER_PROMPT,
  SINGLE_TOC_FIXER_PROMPT,
} from './prompts';
import {
  extractPagesFromPDF,
  getPagesWithLabels,
  getPageText,
  groupPagesIntoChunks,
  parsePhysicalIndex,
} from './pdf-parser';

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
 * Extract JSON from LLM response, handling markdown code blocks
 */
function extractJSON(content: string): any {
  try {
    // Handle markdown code blocks
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

    // Clean common issues
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
 * Call OpenAI API with retry logic
 */
async function callLLM(
  prompt: string,
  model: string = 'gpt-4o',
  maxRetries: number = 3
): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      });
      return response.choices[0].message.content || '';
    } catch (error: any) {
      console.error(`LLM call attempt ${i + 1} failed:`, error.message);
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  throw new Error('Max retries reached for LLM call');
}

/**
 * Detect if a page contains a table of contents
 */
async function detectTOCOnPage(pageText: string, model: string): Promise<boolean> {
  const response = await callLLM(TOC_DETECTOR_PROMPT(pageText), model);
  const result = extractJSON(response);
  return result.toc_detected === 'yes';
}

/**
 * Find all pages containing TOC
 */
async function findTOCPages(
  pages: PageContent[],
  options: Required<IndexingOptions>
): Promise<number[]> {
  console.log('PageIndex: Searching for Table of Contents...');
  const tocPages: number[] = [];
  let lastWasYes = false;

  for (let i = 0; i < Math.min(pages.length, options.toc_check_page_num); i++) {
    // Continue beyond limit if we're still finding TOC pages
    if (i >= options.toc_check_page_num && !lastWasYes) break;

    const isTOC = await detectTOCOnPage(pages[i].text, options.model);
    if (isTOC) {
      console.log(`  - Page ${i + 1}: TOC detected`);
      tocPages.push(i);
      lastWasYes = true;
    } else if (lastWasYes) {
      console.log(`  - Page ${i + 1}: End of TOC`);
      break;
    }
  }

  if (tocPages.length === 0) {
    console.log('  - No TOC found');
  }
  return tocPages;
}

/**
 * Extract and parse TOC content
 */
async function extractTOC(
  pages: PageContent[],
  tocPageIndices: number[],
  model: string
): Promise<TOCDetectionResult> {
  // Combine TOC pages
  let tocContent = '';
  for (const idx of tocPageIndices) {
    tocContent += pages[idx].text + '\n';
  }

  // Transform dots to colons (common TOC formatting)
  tocContent = tocContent.replace(/\.{5,}/g, ': ').replace(/(?:\. ){5,}\.?/g, ': ');

  // Detect if TOC has page numbers
  const response = await callLLM(PAGE_INDEX_DETECTOR_PROMPT(tocContent), model);
  const result = extractJSON(response);

  return {
    toc_content: tocContent,
    toc_page_list: tocPageIndices,
    page_index_given_in_toc: result.page_index_given_in_toc || 'no',
  };
}

/**
 * Transform raw TOC to structured JSON format
 */
async function transformTOC(tocContent: string, model: string): Promise<TOCItem[]> {
  console.log('PageIndex: Transforming TOC to JSON...');
  const response = await callLLM(TOC_TRANSFORMER_PROMPT(tocContent), model);
  const result = extractJSON(response);

  if (!result.table_of_contents) {
    console.log('  - No table_of_contents in response, checking root');
    return Array.isArray(result) ? result : [];
  }

  // Convert page numbers to integers
  const items = result.table_of_contents.map((item: any) => ({
    ...item,
    page: typeof item.page === 'string' ? parseInt(item.page, 10) : item.page,
  }));

  console.log(`  - Extracted ${items.length} TOC items`);
  return items;
}

/**
 * Add physical page indices to TOC items
 */
async function addPhysicalIndices(
  tocItems: TOCItem[],
  pages: PageContent[],
  tocPageList: number[],
  options: Required<IndexingOptions>
): Promise<TOCItem[]> {
  console.log('PageIndex: Adding physical page indices...');

  // Create content from pages after TOC
  const startPageIndex = tocPageList[tocPageList.length - 1] + 1;
  let mainContent = '';
  const endIndex = Math.min(startPageIndex + options.toc_check_page_num, pages.length);

  for (let i = startPageIndex; i < endIndex; i++) {
    mainContent += `<physical_index_${i + 1}>\n${pages[i].text}\n<physical_index_${i + 1}>\n\n`;
  }

  // Strip page numbers for index extraction
  const tocWithoutPages = tocItems.map(({ page, ...rest }) => rest);

  const response = await callLLM(
    TOC_INDEX_EXTRACTOR_PROMPT(JSON.stringify(tocWithoutPages), mainContent),
    options.model
  );
  const extractedIndices = extractJSON(response);

  if (!Array.isArray(extractedIndices)) {
    console.log('  - Failed to extract indices');
    return tocItems;
  }

  // Match extracted indices with original items
  const matchingPairs: Array<{ title: string; page: number; physical_index: number }> = [];

  for (const extracted of extractedIndices) {
    const physicalIndex = parsePhysicalIndex(extracted.physical_index);
    if (physicalIndex === null || physicalIndex < startPageIndex + 1) continue;

    const originalItem = tocItems.find((item) => item.title === extracted.title);
    if (originalItem && originalItem.page) {
      matchingPairs.push({
        title: extracted.title,
        page: originalItem.page,
        physical_index: physicalIndex,
      });
    }
  }

  // Calculate page offset
  if (matchingPairs.length === 0) {
    console.log('  - No matching pairs found for offset calculation');
    return tocItems;
  }

  const differences = matchingPairs.map((p) => p.physical_index - p.page);
  const offsetCounts = differences.reduce(
    (acc, diff) => {
      acc[diff] = (acc[diff] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );
  const offset = parseInt(
    Object.entries(offsetCounts).sort((a, b) => b[1] - a[1])[0][0],
    10
  );

  console.log(`  - Calculated page offset: ${offset}`);

  // Apply offset to all items
  return tocItems.map((item) => ({
    ...item,
    physical_index: item.page ? item.page + offset : undefined,
  }));
}

/**
 * Generate TOC structure from document without explicit TOC
 */
async function generateTOCFromContent(
  pages: PageContent[],
  startIndex: number,
  options: Required<IndexingOptions>
): Promise<TOCItem[]> {
  console.log('PageIndex: Generating TOC from content...');

  const groupTexts = groupPagesIntoChunks(
    pages.slice(startIndex - 1),
    options.max_token_num_each_node
  );
  console.log(`  - Processing ${groupTexts.length} content chunks`);

  // Initialize with first chunk
  let response = await callLLM(GENERATE_TOC_INIT_PROMPT(groupTexts[0]), options.model);
  let tocItems = extractJSON(response);

  if (!Array.isArray(tocItems)) {
    tocItems = [];
  }

  // Continue with remaining chunks
  for (let i = 1; i < groupTexts.length; i++) {
    console.log(`  - Processing chunk ${i + 1}/${groupTexts.length}`);
    response = await callLLM(
      GENERATE_TOC_CONTINUE_PROMPT(JSON.stringify(tocItems), groupTexts[i]),
      options.model
    );
    const additional = extractJSON(response);
    if (Array.isArray(additional)) {
      tocItems.push(...additional);
    }
  }

  // Convert physical_index strings to integers
  return tocItems.map((item: any) => ({
    ...item,
    physical_index: parsePhysicalIndex(item.physical_index),
  }));
}

/**
 * Verify title appears on specified page
 */
async function verifyTitleOnPage(
  title: string,
  pages: PageContent[],
  pageNumber: number,
  model: string
): Promise<boolean> {
  const pageIndex = pageNumber - 1;
  if (pageIndex < 0 || pageIndex >= pages.length) return false;

  const response = await callLLM(TITLE_VERIFICATION_PROMPT(title, pages[pageIndex].text), model);
  const result = extractJSON(response);
  return result.answer === 'yes';
}

/**
 * Check if title starts at beginning of page
 */
async function checkTitleStartsAtBeginning(
  title: string,
  pageText: string,
  model: string
): Promise<boolean> {
  const response = await callLLM(TITLE_START_CHECK_PROMPT(title, pageText), model);
  const result = extractJSON(response);
  return result.start_begin === 'yes';
}

/**
 * Verify all TOC items - check that each title appears on its specified page
 * Returns accuracy score and list of incorrect items
 * (Port of Python verify_toc function)
 */
async function verifyTOC(
  pages: PageContent[],
  tocItems: TOCItem[],
  model: string,
  sampleSize?: number
): Promise<{ accuracy: number; incorrectItems: Array<{ listIndex: number; title: string; physicalIndex: number }> }> {
  console.log('PageIndex: Verifying TOC accuracy...');

  // Filter items with valid physical_index
  const validItems = tocItems.filter(item =>
    item.physical_index !== null &&
    item.physical_index !== undefined
  );

  if (validItems.length === 0) {
    return { accuracy: 0, incorrectItems: [] };
  }

  // Determine which items to check
  const itemsToCheck = sampleSize && sampleSize < validItems.length
    ? validItems.slice(0, sampleSize) // For now, just take first N (could randomize)
    : validItems;

  // Verify each item concurrently
  const results = await Promise.all(
    itemsToCheck.map(async (item, idx) => {
      const listIndex = tocItems.indexOf(item);
      const isCorrect = await verifyTitleOnPage(
        item.title,
        pages,
        item.physical_index!,
        model
      );
      return {
        listIndex,
        title: item.title,
        physicalIndex: item.physical_index!,
        isCorrect
      };
    })
  );

  const correctCount = results.filter(r => r.isCorrect).length;
  const incorrectItems = results
    .filter(r => !r.isCorrect)
    .map(r => ({ listIndex: r.listIndex, title: r.title, physicalIndex: r.physicalIndex }));

  const accuracy = correctCount / results.length;
  console.log(`  - Accuracy: ${(accuracy * 100).toFixed(1)}% (${correctCount}/${results.length})`);
  console.log(`  - Incorrect items: ${incorrectItems.length}`);

  return { accuracy, incorrectItems };
}

/**
 * Fix a single incorrect TOC item by searching between known correct pages
 * (Port of Python single_toc_item_index_fixer)
 */
async function fixSingleTOCItem(
  title: string,
  pages: PageContent[],
  prevCorrectIndex: number,
  nextCorrectIndex: number,
  startIndex: number,
  model: string
): Promise<number | null> {
  // Build content from range between prev and next correct items
  let content = '';
  for (let i = prevCorrectIndex; i <= nextCorrectIndex; i++) {
    const pageIdx = i - startIndex;
    if (pageIdx >= 0 && pageIdx < pages.length) {
      content += `<physical_index_${i}>\n${pages[pageIdx].text}\n<physical_index_${i}>\n\n`;
    }
  }

  const response = await callLLM(SINGLE_TOC_FIXER_PROMPT(title, content), model);
  const result = extractJSON(response);

  if (result.physical_index) {
    return parsePhysicalIndex(result.physical_index);
  }
  return null;
}

/**
 * Fix incorrect TOC items with retries
 * (Port of Python fix_incorrect_toc_with_retries)
 */
async function fixIncorrectTOC(
  tocItems: TOCItem[],
  pages: PageContent[],
  incorrectItems: Array<{ listIndex: number; title: string; physicalIndex: number }>,
  startIndex: number,
  model: string,
  maxAttempts: number = 3
): Promise<{ tocItems: TOCItem[]; remainingIncorrect: typeof incorrectItems }> {
  console.log(`PageIndex: Fixing ${incorrectItems.length} incorrect TOC items...`);

  let currentIncorrect = [...incorrectItems];
  const incorrectIndices = new Set(incorrectItems.map(i => i.listIndex));
  const endIndex = pages.length + startIndex - 1;

  for (let attempt = 0; attempt < maxAttempts && currentIncorrect.length > 0; attempt++) {
    console.log(`  - Attempt ${attempt + 1}: ${currentIncorrect.length} items to fix`);

    const fixResults = await Promise.all(
      currentIncorrect.map(async (item) => {
        // Find previous correct item
        let prevCorrect = startIndex;
        for (let i = item.listIndex - 1; i >= 0; i--) {
          if (!incorrectIndices.has(i) && tocItems[i].physical_index) {
            prevCorrect = tocItems[i].physical_index!;
            break;
          }
        }

        // Find next correct item
        let nextCorrect = endIndex;
        for (let i = item.listIndex + 1; i < tocItems.length; i++) {
          if (!incorrectIndices.has(i) && tocItems[i].physical_index) {
            nextCorrect = tocItems[i].physical_index!;
            break;
          }
        }

        const fixedIndex = await fixSingleTOCItem(
          item.title,
          pages,
          prevCorrect,
          nextCorrect,
          startIndex,
          model
        );

        if (fixedIndex !== null) {
          // Verify the fixed index
          const isCorrect = await verifyTitleOnPage(item.title, pages, fixedIndex, model);
          return { ...item, fixedIndex, isCorrect };
        }
        return { ...item, fixedIndex: null, isCorrect: false };
      })
    );

    // Update TOC items with fixed indices
    const stillIncorrect: typeof incorrectItems = [];
    for (const result of fixResults) {
      if (result.isCorrect && result.fixedIndex !== null) {
        tocItems[result.listIndex].physical_index = result.fixedIndex;
        incorrectIndices.delete(result.listIndex);
      } else {
        stillIncorrect.push({
          listIndex: result.listIndex,
          title: result.title,
          physicalIndex: result.fixedIndex || result.physicalIndex
        });
      }
    }

    currentIncorrect = stillIncorrect;
  }

  return { tocItems, remainingIncorrect: currentIncorrect };
}

/**
 * Process large nodes recursively to extract sub-structure
 * (Port of Python process_large_node_recursively)
 */
async function processLargeNodeRecursively(
  node: TreeNode,
  pages: PageContent[],
  options: Required<IndexingOptions>
): Promise<TreeNode> {
  const nodePages = pages.slice(node.start_index - 1, node.end_index);
  const tokenCount = nodePages.reduce((sum, p) => sum + p.token_count, 0);
  const pageCount = node.end_index - node.start_index;

  // Check if node is large enough to need sub-structure
  if (pageCount > options.max_page_num_each_node && tokenCount >= options.max_token_num_each_node) {
    console.log(`PageIndex: Processing large node "${node.title}" (${pageCount} pages, ${tokenCount} tokens)`);

    // Generate sub-structure from content
    const subTocItems = await generateTOCFromContent(nodePages, node.start_index, options);

    if (subTocItems.length > 0) {
      // Check which items start at page beginning
      for (const item of subTocItems) {
        if (item.physical_index) {
          const pageIdx = item.physical_index - 1;
          if (pageIdx >= 0 && pageIdx < pages.length) {
            const startsAtBeginning = await checkTitleStartsAtBeginning(
              item.title,
              pages[pageIdx].text,
              options.model
            );
            (item as any).appear_start = startsAtBeginning ? 'yes' : 'no';
          }
        }
      }

      // Filter valid items
      const validItems = subTocItems.filter(item =>
        item.physical_index !== null &&
        item.physical_index !== undefined
      );

      if (validItems.length > 0) {
        // Check if first sub-item is same as parent node
        if (validItems[0].title.trim() === node.title.trim()) {
          node.nodes = listToTree(validItems.slice(1), node.end_index);
          if (validItems.length > 1) {
            node.end_index = validItems[1].physical_index!;
          }
        } else {
          node.nodes = listToTree(validItems, node.end_index);
          node.end_index = validItems[0].physical_index!;
        }
      }
    }
  }

  // Recursively process child nodes
  if (node.nodes && node.nodes.length > 0) {
    await Promise.all(
      node.nodes.map(child => processLargeNodeRecursively(child, pages, options))
    );
  }

  return node;
}

/**
 * Convert flat TOC list to hierarchical tree structure
 */
function listToTree(items: TOCItem[], endPageIndex: number): TreeNode[] {
  // First pass: add start_index and end_index
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as any;
    item.start_index = item.physical_index;

    if (i < items.length - 1) {
      const nextItem = items[i + 1] as any;
      // If next item appears at start of page, end this section at previous page
      if (nextItem.appear_start === 'yes') {
        item.end_index = nextItem.physical_index - 1;
      } else {
        item.end_index = nextItem.physical_index;
      }
    } else {
      item.end_index = endPageIndex;
    }
  }

  // Build tree based on structure hierarchy
  const getParentStructure = (structure: string | undefined): string | null => {
    if (!structure) return null;
    const parts = structure.split('.');
    return parts.length > 1 ? parts.slice(0, -1).join('.') : null;
  };

  const nodes: Record<string, TreeNode> = {};
  const rootNodes: TreeNode[] = [];

  for (const item of items) {
    const node: TreeNode = {
      title: item.title,
      start_index: (item as any).start_index,
      end_index: (item as any).end_index,
      nodes: [],
    };

    if (item.structure) {
      nodes[item.structure] = node;
    }

    const parentStructure = getParentStructure(item.structure);
    if (parentStructure && nodes[parentStructure]) {
      nodes[parentStructure].nodes!.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Clean empty nodes arrays
  const cleanNode = (node: TreeNode): TreeNode => {
    if (node.nodes && node.nodes.length === 0) {
      delete node.nodes;
    } else if (node.nodes) {
      node.nodes = node.nodes.map(cleanNode);
    }
    return node;
  };

  return rootNodes.map(cleanNode);
}

/**
 * Add preface node if document doesn't start at page 1
 */
function addPrefaceIfNeeded(items: TOCItem[]): TOCItem[] {
  if (items.length === 0) return items;

  const firstIndex = items[0].physical_index;
  if (firstIndex && firstIndex > 1) {
    return [
      {
        structure: '0',
        title: 'Preface',
        physical_index: 1,
      },
      ...items,
    ];
  }
  return items;
}

/**
 * Write node IDs to tree structure
 */
function writeNodeIds(nodes: TreeNode[], startId: number = 0): number {
  let currentId = startId;

  for (const node of nodes) {
    node.node_id = String(currentId).padStart(4, '0');
    currentId++;

    if (node.nodes) {
      currentId = writeNodeIds(node.nodes, currentId);
    }
  }

  return currentId;
}

/**
 * Add text content to tree nodes
 */
function addNodeText(nodes: TreeNode[], pages: PageContent[]): void {
  for (const node of nodes) {
    node.text = getPageText(pages, node.start_index, node.end_index);

    if (node.nodes) {
      addNodeText(node.nodes, pages);
    }
  }
}

/**
 * Generate summaries for all nodes
 */
async function generateNodeSummaries(
  nodes: TreeNode[],
  model: string
): Promise<void> {
  const allNodes: TreeNode[] = [];

  function collectNodes(nodeList: TreeNode[]) {
    for (const node of nodeList) {
      allNodes.push(node);
      if (node.nodes) collectNodes(node.nodes);
    }
  }
  collectNodes(nodes);

  console.log(`PageIndex: Generating summaries for ${allNodes.length} nodes...`);

  // Process in batches to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < allNodes.length; i += batchSize) {
    const batch = allNodes.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (node) => {
        if (node.text) {
          const response = await callLLM(NODE_SUMMARY_PROMPT(node.text.substring(0, 10000)), model);
          node.summary = response.trim();
        }
      })
    );
    console.log(`  - Processed ${Math.min(i + batchSize, allNodes.length)}/${allNodes.length}`);
  }
}

/**
 * Generate document-level description
 */
async function generateDocDescription(nodes: TreeNode[], model: string): Promise<string> {
  // Create clean structure for description
  const cleanStructure = nodes.map((node) => ({
    title: node.title,
    node_id: node.node_id,
    summary: node.summary?.substring(0, 200),
  }));

  const response = await callLLM(DOC_DESCRIPTION_PROMPT(JSON.stringify(cleanStructure)), model);
  return response.trim();
}

/**
 * Main indexing function - builds document tree from PDF
 */
export async function indexDocument(
  buffer: Buffer,
  fileName: string,
  userOptions?: IndexingOptions
): Promise<DocumentTree> {
  const options = { ...DEFAULT_INDEXING_OPTIONS, ...userOptions };

  console.log('PageIndex: Starting document indexing...');
  console.log(`  - File: ${fileName}`);
  console.log(`  - Model: ${options.model}`);

  // Step 1: Extract pages
  const pages = await extractPagesFromPDF(buffer);
  const totalPages = pages.length;
  const totalTokens = pages.reduce((sum, p) => sum + p.token_count, 0);

  console.log(`  - Total pages: ${totalPages}`);
  console.log(`  - Total tokens: ${totalTokens}`);

  // Step 2: Find TOC pages
  const tocPages = await findTOCPages(pages, options);

  let tocItems: TOCItem[] = [];

  if (tocPages.length > 0) {
    // Step 3a: Extract and parse TOC
    const tocResult = await extractTOC(pages, tocPages, options.model);

    if (tocResult.toc_content && tocResult.page_index_given_in_toc === 'yes') {
      // TOC has page numbers - transform and add physical indices
      tocItems = await transformTOC(tocResult.toc_content, options.model);
      tocItems = await addPhysicalIndices(tocItems, pages, tocPages, options);
    } else if (tocResult.toc_content) {
      // TOC without page numbers - transform then add indices from content
      tocItems = await transformTOC(tocResult.toc_content, options.model);
      // Add physical indices by searching content
      // ... (simplified for now, would need ADD_PAGE_NUMBER_PROMPT logic)
    }
  }

  // Step 3b: If no TOC or parsing failed, generate from content
  if (tocItems.length === 0) {
    tocItems = await generateTOCFromContent(pages, 1, options);
  }

  // Step 4: Validate and filter items
  tocItems = tocItems.filter(
    (item) =>
      item.physical_index !== null &&
      item.physical_index !== undefined &&
      item.physical_index >= 1 &&
      item.physical_index <= totalPages
  );

  // Step 5: Verify TOC accuracy (Python: verify_toc)
  if (tocItems.length > 0) {
    const { accuracy, incorrectItems } = await verifyTOC(pages, tocItems, options.model);

    // Step 5b: Fix incorrect items if accuracy is reasonable but not perfect
    if (accuracy < 1.0 && accuracy >= 0.6 && incorrectItems.length > 0) {
      const { tocItems: fixedItems } = await fixIncorrectTOC(
        tocItems,
        pages,
        incorrectItems,
        1, // startIndex
        options.model,
        3  // maxAttempts
      );
      tocItems = fixedItems;
    } else if (accuracy < 0.6 && tocPages.length > 0) {
      // If accuracy is too low and we had a TOC, try generating from content instead
      console.log('PageIndex: TOC accuracy too low, regenerating from content...');
      tocItems = await generateTOCFromContent(pages, 1, options);
      tocItems = tocItems.filter(
        (item) =>
          item.physical_index !== null &&
          item.physical_index !== undefined &&
          item.physical_index >= 1 &&
          item.physical_index <= totalPages
      );
    }
  }

  // Step 6: Add preface if needed
  tocItems = addPrefaceIfNeeded(tocItems);

  // Step 7: Check which items start at page beginning
  console.log('PageIndex: Checking title positions...');
  for (const item of tocItems) {
    if (item.physical_index) {
      const pageIndex = item.physical_index - 1;
      if (pageIndex >= 0 && pageIndex < pages.length) {
        const startsAtBeginning = await checkTitleStartsAtBeginning(
          item.title,
          pages[pageIndex].text,
          options.model
        );
        (item as any).appear_start = startsAtBeginning ? 'yes' : 'no';
      }
    }
  }

  // Step 8: Convert to tree structure
  let structure = listToTree(tocItems, totalPages);

  // Step 9: Process large nodes recursively (Python: process_large_node_recursively)
  console.log('PageIndex: Processing large nodes for sub-structure...');
  await Promise.all(
    structure.map(node => processLargeNodeRecursively(node, pages, options))
  );

  // Step 10: Add node IDs
  if (options.add_node_id) {
    writeNodeIds(structure);
  }

  // Step 11: Add node text
  if (options.add_node_text || options.add_node_summary) {
    addNodeText(structure, pages);
  }

  // Step 12: Generate summaries
  if (options.add_node_summary) {
    await generateNodeSummaries(structure, options.model);
  }

  // Step 13: Generate document description
  let docDescription: string | undefined;
  if (options.add_doc_description && options.add_node_summary) {
    docDescription = await generateDocDescription(structure, options.model);
  }

  // Step 14: Optionally remove text to save space
  if (!options.add_node_text && options.add_node_summary) {
    const removeText = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        delete node.text;
        if (node.nodes) removeText(node.nodes);
      }
    };
    removeText(structure);
  }

  console.log('PageIndex: Indexing complete!');
  console.log(`  - Tree nodes: ${structure.length}`);

  return {
    doc_name: fileName,
    doc_description: docDescription,
    structure,
  };
}
