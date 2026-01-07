/**
 * PageIndex PDF Parser
 * TypeScript port of VectifyAI/PageIndex PDF extraction
 *
 * Uses unpdf for PDF text extraction with page preservation
 */

import { PageContent } from './types';
import { encoding_for_model } from 'tiktoken';

/**
 * Extract text from PDF buffer with page-level granularity
 * Compatible with PageIndex's get_page_tokens function
 */
export async function extractPagesFromPDF(buffer: Buffer): Promise<PageContent[]> {
  console.log('PageIndex: Extracting pages from PDF...');
  console.log(`  - File size: ${buffer.length} bytes`);

  try {
    // Dynamic import to avoid bundling issues
    const { extractText } = await import('unpdf');

    const uint8Array = new Uint8Array(buffer);
    const { text, totalPages } = await extractText(uint8Array, {
      mergePages: false,
    });

    const pages: PageContent[] = [];
    const encoder = encoding_for_model('gpt-4o');

    if (Array.isArray(text)) {
      text.forEach((pageText, index) => {
        const cleanText = (pageText || '').trim();
        const tokens = encoder.encode(cleanText);
        pages.push({
          page_number: index + 1,
          text: cleanText,
          token_count: tokens.length,
        });
      });
    } else {
      const cleanText = String(text || '').trim();
      const tokens = encoder.encode(cleanText);
      pages.push({
        page_number: 1,
        text: cleanText,
        token_count: tokens.length,
      });
    }

    encoder.free();

    const totalTokens = pages.reduce((sum, p) => sum + p.token_count, 0);
    console.log('PageIndex: PDF extraction complete');
    console.log(`  - Total pages: ${totalPages}`);
    console.log(`  - Pages with text: ${pages.filter((p) => p.text.length > 0).length}`);
    console.log(`  - Total tokens: ${totalTokens}`);

    return pages;
  } catch (error: any) {
    console.error('PageIndex: Error extracting PDF:', error);
    throw new Error(`Failed to extract PDF: ${error.message || 'Unknown error'}`);
  }
}

/**
 * Get text from a range of pages with physical index tags
 * Compatible with PageIndex's get_text_of_pdf_pages_with_labels
 */
export function getPagesWithLabels(
  pages: PageContent[],
  startPage: number,
  endPage: number
): string {
  let text = '';
  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    const pageIndex = pageNum - 1; // Convert to 0-indexed
    if (pageIndex >= 0 && pageIndex < pages.length) {
      text += `<physical_index_${pageNum}>\n${pages[pageIndex].text}\n<physical_index_${pageNum}>\n\n`;
    }
  }
  return text;
}

/**
 * Get text from a range of pages without labels
 */
export function getPageText(
  pages: PageContent[],
  startPage: number,
  endPage: number
): string {
  let text = '';
  for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
    const pageIndex = pageNum - 1;
    if (pageIndex >= 0 && pageIndex < pages.length) {
      text += pages[pageIndex].text + '\n';
    }
  }
  return text;
}

/**
 * Group pages into chunks based on token limits
 * Compatible with PageIndex's page_list_to_group_text
 */
export function groupPagesIntoChunks(
  pages: PageContent[],
  maxTokens: number = 20000,
  overlapPages: number = 1
): string[] {
  const totalTokens = pages.reduce((sum, p) => sum + p.token_count, 0);

  // If total fits in one chunk, return as single item
  if (totalTokens <= maxTokens) {
    const pageContents = pages.map(
      (p) => `<physical_index_${p.page_number}>\n${p.text}\n<physical_index_${p.page_number}>\n\n`
    );
    return [pageContents.join('')];
  }

  const expectedParts = Math.ceil(totalTokens / maxTokens);
  const avgTokensPerPart = Math.ceil((totalTokens / expectedParts + maxTokens) / 2);

  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokenCount = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageContent = `<physical_index_${page.page_number}>\n${page.text}\n<physical_index_${page.page_number}>\n\n`;

    if (currentTokenCount + page.token_count > avgTokensPerPart && currentChunk.length > 0) {
      // Save current chunk
      chunks.push(currentChunk.join(''));

      // Start new chunk with overlap
      const overlapStart = Math.max(i - overlapPages, 0);
      currentChunk = pages.slice(overlapStart, i).map(
        (p) => `<physical_index_${p.page_number}>\n${p.text}\n<physical_index_${p.page_number}>\n\n`
      );
      currentTokenCount = pages.slice(overlapStart, i).reduce((sum, p) => sum + p.token_count, 0);
    }

    currentChunk.push(pageContent);
    currentTokenCount += page.token_count;
  }

  // Add final chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(''));
  }

  console.log(`PageIndex: Divided ${pages.length} pages into ${chunks.length} chunks`);
  return chunks;
}

/**
 * Count tokens in text using tiktoken
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  const encoder = encoding_for_model('gpt-4o');
  const tokens = encoder.encode(text);
  encoder.free();
  return tokens.length;
}

/**
 * Convert physical_index tag to integer
 */
export function parsePhysicalIndex(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') return value;

  if (typeof value === 'string') {
    // Handle formats like "<physical_index_5>" or "physical_index_5"
    const match = value.match(/physical_index_(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    // Try direct parse
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed)) return parsed;
  }

  return null;
}

/**
 * Get PDF title from metadata
 */
export async function getPdfTitle(buffer: Buffer): Promise<string> {
  try {
    const { getMeta } = await import('unpdf');
    const uint8Array = new Uint8Array(buffer);
    const meta = await getMeta(uint8Array);
    return meta?.info?.Title || 'Untitled';
  } catch {
    return 'Untitled';
  }
}
