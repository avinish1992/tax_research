/**
 * Retrieval-Confidence Gating (PageIndex-Aligned)
 *
 * PHILOSOPHY: Let retrieval determine relevance, not pre-classification
 *
 * This replaces keyword-based intent classification with:
 * 1. Minimal off-topic filter (only truly irrelevant queries)
 * 2. Retrieval-based confidence gating (uses actual document matching)
 *
 * Benefits:
 * - Zero keyword maintenance required
 * - Automatically adapts to indexed documents
 * - More accurate (uses actual retrieval results)
 * - Aligned with PageIndex's tree-reasoning philosophy
 */

import { RetrievalResult } from './types';

/**
 * Obvious off-topic indicators that should be filtered BEFORE retrieval
 * These are queries that would waste compute and never be answerable
 *
 * IMPORTANT: Keep this list MINIMAL - only truly off-topic patterns
 * Domain terms (GAAR, QFZP, etc.) should NOT be filtered here
 */
const OBVIOUS_OFF_TOPIC_PATTERNS = [
  // Programming requests
  /write\s+(me\s+)?(a\s+)?code/i,
  /write\s+(me\s+)?(a\s+)?script/i,
  /write\s+(me\s+)?(a\s+)?function/i,
  /python\s+code/i,
  /javascript\s+code/i,
  /```[\s\S]*```/,  // Code blocks

  // General knowledge (clearly not tax)
  /weather\s+(in|today|tomorrow)/i,
  /recipe\s+for/i,
  /how\s+to\s+cook/i,
  /translate\s+(this|to)/i,

  // Other domains
  /stock\s+price/i,
  /sports\s+score/i,
  /movie\s+review/i,
];

/**
 * VAT-specific patterns (common confusion with Corporate Tax)
 */
const VAT_PATTERNS = [
  /\bvat\b/i,
  /value\s+added\s+tax/i,
  /\b5%\s+tax\b/i,  // UAE VAT rate
];

export interface OffTopicCheckResult {
  isOffTopic: boolean;
  reason?: string;
  category?: 'programming' | 'general_knowledge' | 'vat' | 'other_domain';
}

/**
 * STAGE 0: Quick off-topic filter (BEFORE retrieval)
 *
 * Only filters queries that are OBVIOUSLY not about UAE Corporate Tax
 * Domain-specific terms should NOT be filtered - let retrieval handle them
 */
export function quickOffTopicFilter(query: string): OffTopicCheckResult {
  const queryLower = query.toLowerCase();

  // Check for programming requests
  for (const pattern of OBVIOUS_OFF_TOPIC_PATTERNS) {
    if (pattern.test(queryLower)) {
      return {
        isOffTopic: true,
        reason: 'Query appears to be about programming or general knowledge',
        category: 'programming'
      };
    }
  }

  // Check for VAT (common confusion)
  for (const pattern of VAT_PATTERNS) {
    if (pattern.test(queryLower)) {
      return {
        isOffTopic: true,
        reason: 'Query appears to be about VAT (Value Added Tax), not Corporate Tax',
        category: 'vat'
      };
    }
  }

  // Everything else proceeds to retrieval
  return { isOffTopic: false };
}

/**
 * Confidence thresholds for retrieval gating
 */
export const CONFIDENCE_THRESHOLDS = {
  // Minimum sources required for each confidence level
  high: 1,      // 1+ source with high confidence = proceed
  medium: 2,    // 2+ sources with medium confidence = proceed
  low: 3,       // 3+ sources with low confidence = proceed (unlikely to pass)

  // If below these thresholds, return "no relevant info" response
};

/**
 * STAGE 1: Retrieval-based confidence gate (AFTER retrieval)
 *
 * Uses actual retrieval results to determine if query is answerable
 * This is the PageIndex-aligned approach
 */
export function shouldProceedWithResponse(result: RetrievalResult): {
  proceed: boolean;
  reason: string;
  suggestedResponse?: string;
} {
  const { confidence, sources, reasoning } = result;
  const sourceCount = sources.length;

  // High confidence with any sources = proceed
  if (confidence === 'high' && sourceCount >= CONFIDENCE_THRESHOLDS.high) {
    return {
      proceed: true,
      reason: `High confidence retrieval with ${sourceCount} sources`
    };
  }

  // Medium confidence with enough sources = proceed
  if (confidence === 'medium' && sourceCount >= CONFIDENCE_THRESHOLDS.medium) {
    return {
      proceed: true,
      reason: `Medium confidence retrieval with ${sourceCount} sources`
    };
  }

  // Low confidence OR insufficient sources = graceful decline
  if (confidence === 'low' || sourceCount < CONFIDENCE_THRESHOLDS.medium) {
    return {
      proceed: false,
      reason: `Insufficient retrieval confidence (${confidence}, ${sourceCount} sources)`,
      suggestedResponse: generateLowConfidenceResponse(sourceCount, reasoning)
    };
  }

  // Default: proceed (err on side of attempting to answer)
  return {
    proceed: true,
    reason: `Proceeding with ${confidence} confidence, ${sourceCount} sources`
  };
}

/**
 * Generate appropriate response for low-confidence retrievals
 *
 * Instead of generic "I can't help", this provides context-aware feedback
 */
function generateLowConfidenceResponse(sourceCount: number, reasoning: string): string {
  if (sourceCount === 0) {
    return `I couldn't find relevant information in the UAE Corporate Tax documents for this specific query.

This might mean:
- The topic isn't covered in the indexed documents
- The query might need to be rephrased with different terms
- The documents may not contain information about this specific aspect

**Suggestions:**
- Try rephrasing your question with specific UAE Corporate Tax terms
- Ask about a related topic that might be documented
- Check if additional documents need to be uploaded

Would you like to try a different question about UAE Corporate Tax?`;
  }

  return `I found some potentially related information, but I'm not confident it fully answers your question.

The documents mention related topics, but the specific aspect you're asking about may not be clearly covered.

Would you like me to:
1. Show what related information I found?
2. Help you rephrase the question?
3. Explain what topics are well-covered in the documents?`;
}

/**
 * Response templates for off-topic queries
 */
export const OFF_TOPIC_RESPONSES = {
  programming: `I'm a UAE Corporate Tax assistant and can only help with tax-related questions.

I can't help with programming, coding, or technical development tasks.

**What I CAN help with:**
- Corporate tax rates and thresholds
- Transfer pricing rules
- Free Zone taxation
- Tax group formation
- Filing requirements and deadlines

Is there anything about UAE Corporate Tax I can help you with?`,

  vat: `I specialize in **UAE Corporate Tax**, not VAT (Value Added Tax).

VAT and Corporate Tax are governed by separate legislation:
- **Corporate Tax**: Federal Decree-Law No. 47 of 2022
- **VAT**: Federal Decree-Law No. 8 of 2017

For VAT questions, please consult the Federal Tax Authority (FTA) website: tax.gov.ae

Is there anything about **UAE Corporate Tax** I can help you with?`,

  general_knowledge: `I'm a specialized UAE Corporate Tax assistant and can only answer questions related to:

- Corporate tax rates and thresholds
- Transfer pricing documentation
- Tax group formations
- Free Zone taxation
- Small business relief
- Filing requirements

Your question appears to be about a different topic. Is there anything about UAE Corporate Tax I can help you with?`,

  other_domain: `This question appears to be outside the scope of UAE Corporate Tax law.

I can help with questions about:
- Corporate tax rates and calculations
- Transfer pricing rules
- Tax exemptions and reliefs
- Compliance requirements
- Specific articles of the CT Law

Would you like to ask about any of these topics?`,
};
