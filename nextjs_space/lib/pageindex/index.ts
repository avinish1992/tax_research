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

// Retrieval Confidence Gating (PageIndex-aligned approach)
// Replaces deprecated keyword-based query-classifier.ts
export {
  quickOffTopicFilter,
  shouldProceedWithResponse,
  OFF_TOPIC_RESPONSES,
  CONFIDENCE_THRESHOLDS,
  type OffTopicCheckResult,
} from './retrieval-confidence-gate';

// Cross-Encoder Reranking
export {
  rerankSources,
  keywordRerank,
  isRerankingAvailable,
  getAvailableProvider,
  type RerankedSource,
  type RerankOptions,
} from './reranker';

// Model Router for Task-Based Selection
export {
  getModelConfig,
  selectTaskType,
  getModelForQuery,
  supportsReasoningMode,
  getAvailableModels,
  type TaskType,
  type ModelConfig,
} from './model-router';

// Citation Validation
export {
  validateCitations,
  checkKeyFigures,
  getKeyFiguresPromptAddition,
  getResponseQualityScore,
  KEY_FIGURE_CHECKS,
  type CitationValidationResult,
  type KeyFigureCheckResult,
} from './citation-validator';

// Re-export prompts for customization
export * from './prompts';
