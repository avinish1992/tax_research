/**
 * @deprecated This file is DEPRECATED as of 2026-01-10
 *
 * REPLACED BY: retrieval-confidence-gate.ts (PageIndex-aligned approach)
 *
 * WHY DEPRECATED:
 * - Keyword-based classification is not scalable (requires manual maintenance)
 * - Terms like GAAR, QFZP were incorrectly rejected before being added to keyword list
 * - The new approach uses retrieval confidence to determine query answerability
 *
 * NEW APPROACH (retrieval-confidence-gate.ts):
 * 1. Quick off-topic filter (only obvious: programming, weather, VAT)
 * 2. Let retrieval happen for all domain queries
 * 3. Use retrieval confidence to gate the response
 *
 * This file is kept for reference only. Do not use in new code.
 *
 * OLD DESCRIPTION:
 * Query Intent Classification for RAG
 * TWO-STAGE CLASSIFICATION:
 * Stage 1: Is query UAE Corporate Tax related? (topic relevance)
 * Stage 2: Is query clear enough to answer? (only if stage 1 passes)
 * Based on research from LlamaIndex RAGate, TrustRAG
 */

import OpenAI from 'openai';

export type QueryIntent =
  | 'in_scope'        // Answerable from UAE Corporate Tax documents
  | 'clarification'   // Too vague, needs more context
  | 'out_of_scope'    // Related topic but outside document scope
  | 'off_topic';      // Completely unrelated

export interface ClassificationResult {
  intent: QueryIntent;
  confidence: number;      // 0-1
  reasoning: string;
  suggestedAction: 'proceed' | 'clarify' | 'decline';
  clarificationPrompt?: string;
  detectedTopic?: string;
}

/**
 * UAE Corporate Tax topic keywords - if query contains these, it's likely in-scope
 * Used in Stage 1 to quickly identify CT-related queries
 */
const CT_TOPIC_KEYWORDS = [
  // Core CT terms
  'corporate tax', 'ct rate', 'tax rate', 'taxable income',
  // Specific provisions
  'transfer pricing', 'tax group', 'free zone', 'qualifying free zone',
  'small business relief', 'participation exemption', 'exempt income',
  'loss carry', 'interest deduction', 'ebitda', 'related party',
  // Procedural
  'tax return', 'filing', 'registration', 'fta', 'federal tax authority',
  'tax period', 'financial year', 'deadline',
  // Legal references
  'article', 'decree-law', 'ministerial decision',
  // Entity types
  'resident person', 'non-resident', 'taxable person', 'juridical person',
  'permanent establishment', 'natural person',
  // Comparisons within CT scope
  'mainland', 'onshore', 'offshore', 'deductible', 'non-deductible',
  // Penalties and compliance
  'penalty', 'penalties', 'violation', 'compliance', 'audit',

  // ========================================
  // UAE CT Acronyms (commonly used in queries)
  // ========================================
  'gaar',           // General Anti-Abuse Rule (Article 50)
  'qfzp',           // Qualifying Free Zone Person
  'pe',             // Permanent Establishment (needs context)
  'apa',            // Advance Pricing Agreement
  'map',            // Mutual Agreement Procedure
  'cbcr',           // Country-by-Country Reporting
  'beps',           // Base Erosion and Profit Shifting
  'uct',            // UAE Corporate Tax
  'ct law',         // Corporate Tax Law

  // ========================================
  // Domain-specific terms (UAE CT concepts)
  // ========================================
  'anti-abuse', 'anti abuse', 'abuse rule', 'avoidance',
  'arm\'s length', 'arms length', 'market value',
  'withholding', 'withholding tax',
  'exempt person', 'exemption', 'exempt entity',
  'government entity', 'government controlled',
  'tax residence', 'tax residency', 'resident for tax',
  'connected person', 'connected parties',
  'qualifying income', 'excluded activity', 'de minimis',
  'business restructuring', 'restructuring relief',
  'transitional rules', 'transitional relief',
  'realisation basis', 'realization basis',
  'unincorporated partnership', 'transparent',
  'extractive business', 'natural resources',
];

/**
 * Quick check if query is likely UAE Corporate Tax related
 * Stage 1 of two-stage classification
 */
function isLikelyCTRelated(query: string): { likely: boolean; matchedKeywords: string[] } {
  const queryLower = query.toLowerCase();
  const matchedKeywords: string[] = [];

  for (const keyword of CT_TOPIC_KEYWORDS) {
    // For short keywords (<=4 chars), use word boundary matching to avoid false positives
    // e.g., "pe" shouldn't match "people", but "gaar" should match as standalone word
    if (keyword.length <= 4) {
      const wordBoundaryRegex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (wordBoundaryRegex.test(queryLower)) {
        matchedKeywords.push(keyword);
      }
    } else if (queryLower.includes(keyword)) {
      matchedKeywords.push(keyword);
    }
  }

  console.log(`   [Stage 1 Check] Query: "${query.substring(0, 50)}..." | Matched: ${matchedKeywords.length > 0 ? matchedKeywords.join(', ') : 'none'}`);

  return {
    likely: matchedKeywords.length > 0,
    matchedKeywords
  };
}

const CLASSIFICATION_PROMPT = `You are a query intent classifier for a UAE Corporate Tax Law assistant.

DOCUMENT SCOPE (what the assistant CAN answer):
- UAE Corporate Tax Law (Federal Decree-Law No. 47 of 2022)
- Ministerial Decisions on Corporate Tax implementation
- Transfer pricing rules and regulations
- Tax group formation and requirements
- Free Zone taxation and exemptions
- Small business relief provisions
- Corporate tax rates, thresholds, and deadlines
- Participation exemption conditions
- Interest deduction limitations
- Loss carry-forward rules

OUT OF SCOPE (what the assistant CANNOT answer):
- VAT or indirect taxes (different law)
- Personal income tax (UAE has none for residents)
- Company incorporation or formation procedures
- General business advice unrelated to tax
- Tax laws from other countries
- Accounting standards or IFRS
- Employment law or labor regulations
- Immigration or visa matters

IMPORTANT UAE CT ACRONYMS (treat these as in-scope):
- GAAR = General Anti-Abuse Rule (Article 50)
- QFZP = Qualifying Free Zone Person
- PE = Permanent Establishment
- APA = Advance Pricing Agreement
- MAP = Mutual Agreement Procedure
- CbCR = Country-by-Country Reporting
- BEPS = Base Erosion and Profit Shifting

CLASSIFY the user's query into ONE of these categories:

1. IN_SCOPE - Query can be definitively answered from UAE Corporate Tax documents
   Examples:
   - "What is the corporate tax rate?"
   - "Transfer pricing documentation requirements"
   - "Tax group ownership threshold"
   - "Free Zone tax benefits"
   - "What is GAAR?" (General Anti-Abuse Rule)
   - "QFZP requirements" (Qualifying Free Zone Person)

2. CLARIFICATION - Query is too vague or ambiguous to answer properly
   Examples:
   - "tax stuff" (what aspect?)
   - "how much?" (how much what?)
   - "tell me about it" (about what?)
   - "what's the rate?" (which rate, for whom?)

3. OUT_OF_SCOPE - Related to business/tax but NOT UAE Corporate Tax
   Examples:
   - "VAT rate in UAE" (VAT is separate)
   - "How to incorporate a company" (not tax)
   - "Income tax for expatriates" (no personal income tax)
   - "Tax rates in Saudi Arabia" (different country)

4. OFF_TOPIC - Completely unrelated to tax or business documents
   Examples:
   - "Write Python code"
   - "What's the weather?"
   - "Help me with a recipe"
   - "Translate this to Arabic"

IMPORTANT DECISION RULES:
- If the query mentions "corporate tax", "CT", "tax rate for companies", etc. → likely IN_SCOPE
- If the query mentions "VAT", "value added", "5%" (UAE VAT rate) → OUT_OF_SCOPE
- If the query is a single word or very short without context → CLARIFICATION
- If uncertain between IN_SCOPE and OUT_OF_SCOPE, lean toward IN_SCOPE with medium confidence

Respond in JSON format:
{
  "intent": "in_scope|clarification|out_of_scope|off_topic",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why this classification",
  "suggestedAction": "proceed|clarify|decline",
  "clarificationPrompt": "If clarification needed, what to ask",
  "detectedTopic": "What topic the query is about"
}`;

export async function classifyQuery(
  query: string,
  openai: OpenAI,
  options: { skipForShortQueries?: boolean } = {}
): Promise<ClassificationResult> {
  const queryLower = query.toLowerCase().trim();
  const wordCount = query.split(/\s+/).length;

  // ========================================
  // STAGE 0: Quick rejection for obvious cases
  // ========================================

  // Check for code-related queries (definitely off-topic)
  if (queryLower.includes('write code') ||
      queryLower.includes('python') ||
      queryLower.includes('javascript') ||
      queryLower.match(/```[\s\S]*```/)) {
    return {
      intent: 'off_topic',
      confidence: 0.95,
      reasoning: 'Query appears to be about programming/coding',
      suggestedAction: 'decline',
      detectedTopic: 'programming'
    };
  }

  // Check for VAT-specific queries (common out-of-scope)
  if (queryLower.includes('vat') ||
      queryLower.includes('value added') ||
      (queryLower.includes('5%') && !queryLower.includes('corporate'))) {
    return {
      intent: 'out_of_scope',
      confidence: 0.9,
      reasoning: 'Query is about VAT, not Corporate Tax',
      suggestedAction: 'decline',
      detectedTopic: 'VAT/indirect tax'
    };
  }

  // ========================================
  // STAGE 1: Is query UAE Corporate Tax related?
  // ========================================
  const ctCheck = isLikelyCTRelated(query);

  // If query contains CT keywords, it's likely in-scope
  // Only check for vagueness if it's VERY short
  if (ctCheck.likely) {
    console.log(`   Stage 1 PASS: CT keywords found: ${ctCheck.matchedKeywords.join(', ')}`);

    // Even CT-related queries can be too vague if very short
    if (wordCount <= 2) {
      // Let LLM decide if it's too vague
    } else {
      // CT-related and long enough → proceed directly
      return {
        intent: 'in_scope',
        confidence: 0.85,
        reasoning: `Query contains UAE Corporate Tax keywords: ${ctCheck.matchedKeywords.join(', ')}`,
        suggestedAction: 'proceed',
        detectedTopic: ctCheck.matchedKeywords[0]
      };
    }
  }

  // ========================================
  // STAGE 2: LLM classification for unclear cases
  // ========================================
  // Only use LLM if:
  // - No CT keywords found, OR
  // - Query is very short (2 words or less)

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Fast and cost-effective for classification
      messages: [
        { role: 'system', content: CLASSIFICATION_PROMPT },
        { role: 'user', content: `Query to classify: "${query}"` }
      ],
      temperature: 0.1,
      max_tokens: 300,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from classifier');
    }

    const result = JSON.parse(content);

    // ========================================
    // POST-PROCESSING: Override LLM if CT-related
    // ========================================
    // If LLM says "clarification" but we detected CT keywords,
    // and query has enough words, override to in_scope
    if (result.intent === 'clarification' && ctCheck.likely && wordCount >= 4) {
      console.log(`   Stage 2 OVERRIDE: LLM said clarification but CT keywords present and query has ${wordCount} words`);
      return {
        intent: 'in_scope',
        confidence: 0.75,
        reasoning: `Query contains CT keywords (${ctCheck.matchedKeywords.join(', ')}) - proceeding despite ambiguity`,
        suggestedAction: 'proceed',
        detectedTopic: result.detectedTopic || ctCheck.matchedKeywords[0]
      };
    }

    return {
      intent: result.intent || 'in_scope',
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
      reasoning: result.reasoning || 'No reasoning provided',
      suggestedAction: result.suggestedAction || 'proceed',
      clarificationPrompt: result.clarificationPrompt,
      detectedTopic: result.detectedTopic
    };
  } catch (error) {
    console.error('Query classification error:', error);
    // Default to in_scope with low confidence on error
    // If CT keywords found, be more confident
    return {
      intent: 'in_scope',
      confidence: ctCheck.likely ? 0.6 : 0.3,
      reasoning: ctCheck.likely
        ? `Classification failed but CT keywords found: ${ctCheck.matchedKeywords.join(', ')}`
        : 'Classification failed, defaulting to in_scope',
      suggestedAction: 'proceed'
    };
  }
}

// Response templates for different decline scenarios
export const DECLINE_RESPONSES: Record<QueryIntent, string> = {
  out_of_scope: `I'm specialized in **UAE Corporate Tax law** based on the documents you've uploaded.

Your question appears to be about a different topic. Here's some guidance:

**For VAT questions:**
- Visit the Federal Tax Authority (FTA) website: tax.gov.ae
- VAT is governed by separate legislation (Federal Decree-Law No. 8 of 2017)

**For company formation:**
- Contact a licensed business setup consultant
- Check with relevant Free Zone authorities

**For other tax jurisdictions:**
- Consult with a tax advisor in that country

Is there anything about **UAE Corporate Tax** I can help you with instead?`,

  off_topic: `I'm a **UAE Corporate Tax assistant** and can only help with questions related to:

- Corporate tax rates and thresholds
- Transfer pricing rules
- Tax group formations
- Free Zone taxation
- Small business relief
- Filing deadlines and requirements

Your question doesn't seem related to these topics. If you have any questions about UAE Corporate Tax, I'm happy to help!`,

  clarification: `I'd like to help, but could you please provide more details?

{clarificationPrompt}

**Example questions I can answer:**
- "What is the corporate tax rate for mainland companies?"
- "What are the transfer pricing documentation requirements?"
- "What conditions must be met for Tax Group formation?"
- "How does Small Business Relief work?"`,

  in_scope: '' // Not used for decline
};

/**
 * Get the appropriate decline response for a classification result
 */
export function getDeclineResponse(classification: ClassificationResult): string {
  if (classification.suggestedAction === 'proceed') {
    return ''; // No decline needed
  }

  let response = DECLINE_RESPONSES[classification.intent];

  // Replace clarification prompt placeholder if present
  if (classification.intent === 'clarification' && classification.clarificationPrompt) {
    response = response.replace(
      '{clarificationPrompt}',
      classification.clarificationPrompt
    );
  } else if (classification.intent === 'clarification') {
    response = response.replace(
      '{clarificationPrompt}',
      'What specific aspect of UAE Corporate Tax would you like to know about?'
    );
  }

  return response;
}

/**
 * Check if a query should bypass classification
 * (for follow-up questions in existing conversations)
 */
export function shouldSkipClassification(
  query: string,
  previousQueries: string[] = []
): boolean {
  const queryLower = query.toLowerCase();

  // Skip for conversational follow-ups
  const followUpIndicators = [
    'what about',
    'how about',
    'and',
    'also',
    'tell me more',
    'explain',
    'elaborate',
    'continue',
    'yes',
    'no',
    'thanks',
    'thank you'
  ];

  if (followUpIndicators.some(ind => queryLower.startsWith(ind))) {
    return previousQueries.length > 0; // Only skip if there's context
  }

  return false;
}
