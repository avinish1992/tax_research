/**
 * PageIndex - Reasoning-Based Document Retrieval
 * TypeScript port of VectifyAI/PageIndex
 *
 * Replaces vector-based RAG with tree-based reasoning for improved
 * accuracy on legal and professional documents.
 */

// Types
export * from './types';

// PDF Parsing
export {
  extractPagesFromPDF,
  getPagesWithLabels,
  getPageText,
  groupPagesIntoChunks,
  countTokens,
  parsePhysicalIndex,
  getPdfTitle,
} from './pdf-parser';

// Document Indexing
export { indexDocument } from './indexer';

// Tree-Based Retrieval
export {
  retrieveFromTree,
  retrieveFromMultipleTrees,
  formatRetrievalAsContext,
  formatSourcesForDisplay,
  filterCitedSources,
  renumberCitations,
} from './retriever';

// Re-export prompts for customization
export * from './prompts';
