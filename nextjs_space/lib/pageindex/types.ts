/**
 * PageIndex Types
 * TypeScript port of VectifyAI/PageIndex
 *
 * Core data structures for tree-based document indexing and retrieval
 */

/**
 * Represents a single node in the document tree structure
 */
export interface TreeNode {
  /** Unique identifier for the node (e.g., "0001", "0002") */
  node_id?: string;

  /** Hierarchical structure index (e.g., "1", "1.1", "1.2.3") */
  structure?: string;

  /** Title of the section */
  title: string;

  /** Physical page number where this section starts (1-indexed) */
  physical_index?: number;

  /** Start page of this section (1-indexed) */
  start_index: number;

  /** End page of this section (1-indexed) */
  end_index: number;

  /** AI-generated summary of this section's content */
  summary?: string;

  /** Full text content of this section (optional, can be large) */
  text?: string;

  /** Whether this section appears at the start of a page */
  appear_start?: 'yes' | 'no';

  /** Child nodes (subsections) */
  nodes?: TreeNode[];
}

/**
 * Complete document tree structure
 */
export interface DocumentTree {
  /** Document filename or identifier */
  doc_name: string;

  /** Optional document-level description */
  doc_description?: string;

  /** Root-level tree nodes */
  structure: TreeNode[];
}

/**
 * Result of TOC detection
 */
export interface TOCDetectionResult {
  /** Raw TOC content extracted from the document */
  toc_content: string | null;

  /** List of page indices containing TOC (0-indexed) */
  toc_page_list: number[];

  /** Whether page numbers are included in the TOC */
  page_index_given_in_toc: 'yes' | 'no';
}

/**
 * Configuration options for tree indexing
 */
export interface IndexingOptions {
  /** LLM model to use (default: "gpt-4o") */
  model?: string;

  /** Number of pages to check for TOC (default: 20) */
  toc_check_page_num?: number;

  /** Max pages per node before recursive splitting (default: 50) */
  max_page_num_each_node?: number;

  /** Max tokens per node before recursive splitting (default: 20000) */
  max_token_num_each_node?: number;

  /** Whether to add unique node IDs (default: true) */
  add_node_id?: boolean;

  /** Whether to add node text content (default: true) */
  add_node_text?: boolean;

  /** Whether to generate summaries for nodes (default: true) */
  add_node_summary?: boolean;

  /** Whether to generate document description (default: true) */
  add_doc_description?: boolean;
}

/**
 * Default indexing configuration
 */
export const DEFAULT_INDEXING_OPTIONS: Required<IndexingOptions> = {
  model: 'gpt-4o',
  toc_check_page_num: 20,
  max_page_num_each_node: 50,
  max_token_num_each_node: 20000,
  add_node_id: true,
  add_node_text: true,
  add_node_summary: true,
  add_doc_description: true,
};

/**
 * Represents a single page extracted from a PDF
 */
export interface PageContent {
  /** Text content of the page */
  text: string;

  /** Token count for the page */
  token_count: number;

  /** Page number (1-indexed) */
  page_number: number;
}

/**
 * Result from tree-based retrieval
 */
export interface RetrievalResult {
  /** List of relevant node IDs */
  node_ids: string[];

  /** LLM's reasoning about why these nodes were selected */
  reasoning: string;

  /** Confidence level of the retrieval */
  confidence: 'high' | 'medium' | 'low';

  /** Combined content from selected nodes */
  content: string;

  /** Detailed source information for citations */
  sources: RetrievalSource[];

  /** Token usage from retrieval LLM call (for cost tracking) */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Source information for accurate citations
 */
export interface RetrievalSource {
  /** Node ID for reference */
  node_id: string;

  /** Section title for display */
  title: string;

  /** Full section path (e.g., "Chapter 4 > Article 12 > Penalties") */
  section_path: string;

  /** Page range */
  pages: {
    start: number;
    end: number;
  };

  /** Extracted content from this source */
  content: string;

  /** Summary of this section (for preview) */
  summary?: string;
}

/**
 * Simplified tree node for retrieval prompts (reduces token usage)
 */
export interface SimplifiedTreeNode {
  node_id: string;
  title: string;
  pages: string;
  summary?: string;  // Optional - minimal format doesn't include summaries
  children?: string[];
}

/**
 * TOC item extracted from document
 */
export interface TOCItem {
  /** Structure index (e.g., "1.2.3") */
  structure: string;

  /** Section title */
  title: string;

  /** Page number from TOC (may need offset adjustment) */
  page?: number;

  /** Physical page index in PDF */
  physical_index?: number;
}

/**
 * Title verification result
 */
export interface TitleVerificationResult {
  list_index: number;
  title: string;
  page_number: number | null;
  answer: 'yes' | 'no';
}

/**
 * LLM API response with finish reason
 */
export interface LLMResponseWithFinishReason {
  content: string;
  finish_reason: 'finished' | 'max_output_reached' | 'error';
}

/**
 * Stored document tree in database
 */
export interface StoredDocumentTree {
  id: string;
  document_id: string;
  tree_json: DocumentTree;
  model_used: string;
  token_count?: number;
  created_at: Date;
}
