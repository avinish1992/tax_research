/**
 * Citation Validator for RAG Responses
 *
 * Validates that:
 * 1. Citations are inline (not grouped at end)
 * 2. Key figures are included when relevant
 * 3. Citation numbers match available sources
 *
 * Research: Based on accuracy testing showing 9.4% citation placement issues
 */

export interface CitationValidationResult {
  isValid: boolean;
  issues: string[];
  citationCount: number;
  factCount: number;
  coverage: number;  // citations/facts ratio (0-1)
  hasClusteredCitations: boolean;
  invalidCitations: number[];
}

export interface KeyFigureCheckResult {
  missing: string[];
  present: string[];
  relevantTopics: string[];
}

/**
 * Key figures that should appear in responses about certain topics
 * Based on accuracy testing showing missing figures in 7-9 responses
 */
export const KEY_FIGURE_CHECKS: Record<string, {
  keywords: string[];      // Topic indicators in query
  figures: string[];       // Figures that should appear
  description: string;     // What the figure represents
}> = {
  'tax_rate': {
    keywords: ['tax rate', 'corporate tax', 'ct rate', 'rate of tax', 'tax rates'],
    figures: ['9%', '0%'],
    description: 'Standard (9%) and below-threshold (0%) rates'
  },
  'threshold': {
    keywords: ['threshold', 'taxable income', 'income threshold', 'exempt income'],
    figures: ['375,000', 'AED 375'],
    description: 'Taxable income threshold'
  },
  'small_business': {
    keywords: ['small business', 'relief', 'small company', 'sme'],
    figures: ['3 million', 'AED 3'],
    description: 'Small business relief revenue threshold'
  },
  'tax_group': {
    keywords: ['tax group', 'group relief', 'consolidation', 'ownership'],
    figures: ['95%'],
    description: 'Minimum ownership for Tax Group'
  },
  'interest_limitation': {
    keywords: ['interest', 'deduction', 'ebitda', 'limitation'],
    figures: ['30%', 'EBITDA', '12 million'],
    description: 'Interest deduction limitation (30% of EBITDA or AED 12M)'
  },
  'loss_carry': {
    keywords: ['loss', 'carry forward', 'offset', 'tax loss'],
    figures: ['75%'],
    description: 'Maximum loss offset percentage'
  },
  'filing': {
    keywords: ['filing', 'deadline', 'return', 'submission'],
    figures: ['9 months'],
    description: 'Filing deadline after tax period'
  },
  'registration': {
    keywords: ['registration', 'register', 'registered'],
    figures: ['3 months'],
    description: 'Registration deadline'
  },
};

/**
 * Validate citation placement in a response
 */
export function validateCitations(
  response: string,
  sourceCount: number
): CitationValidationResult {
  const issues: string[] = [];

  // Find all citations
  const citationMatches = response.match(/\[(\d+)\]/g) || [];
  const citationCount = citationMatches.length;

  // Extract unique citation numbers
  const usedCitations = new Set<number>();
  citationMatches.forEach(c => {
    usedCitations.add(parseInt(c.slice(1, -1)));
  });

  // Check for invalid citation numbers
  const invalidCitations: number[] = [];
  usedCitations.forEach(num => {
    if (num > sourceCount || num < 1) {
      invalidCitations.push(num);
      issues.push(`Invalid citation [${num}] - only ${sourceCount} sources available`);
    }
  });

  // Estimate fact count (sentences with factual indicators)
  const sentences = response.split(/[.!?]+/).filter(s => s.trim());
  const factIndicators = /\d+%|\bAED\b|\d+\s*(million|months?|years?|days?)|Article\s+\d+|Section\s+\d+/i;
  const factSentences = sentences.filter(s => factIndicators.test(s));
  const factCount = Math.max(factSentences.length, 1);

  // Check for citation clustering (multiple citations at paragraph end)
  let hasClusteredCitations = false;
  const paragraphs = response.split(/\n\n+/);
  for (const para of paragraphs) {
    // Pattern: multiple citations followed by end of paragraph
    const clusteredPattern = /(\[\d+\]){2,}\s*$/;
    if (clusteredPattern.test(para)) {
      hasClusteredCitations = true;
      issues.push('Citations clustered at paragraph end (should be inline)');
      break;
    }
  }

  // Check for uncited factual sentences
  for (const sentence of factSentences) {
    if (!sentence.includes('[') && factIndicators.test(sentence)) {
      // Allow sentences that are clearly transitional
      if (!sentence.match(/^(for example|such as|including|additionally|furthermore|however|therefore)/i)) {
        issues.push(`Potentially uncited fact: "${sentence.trim().slice(0, 50)}..."`);
      }
    }
  }

  // Calculate coverage
  const coverage = factCount > 0 ? Math.min(citationCount / factCount, 1.0) : 0;

  return {
    isValid: issues.length === 0 && coverage >= 0.5,
    issues,
    citationCount,
    factCount,
    coverage,
    hasClusteredCitations,
    invalidCitations,
  };
}

/**
 * Check if key figures are included in response when relevant
 */
export function checkKeyFigures(
  query: string,
  response: string
): KeyFigureCheckResult {
  const queryLower = query.toLowerCase();
  const responseLower = response.toLowerCase();

  const missing: string[] = [];
  const present: string[] = [];
  const relevantTopics: string[] = [];

  for (const [topicId, config] of Object.entries(KEY_FIGURE_CHECKS)) {
    // Check if topic is relevant to query
    const isRelevant = config.keywords.some(kw => queryLower.includes(kw));

    if (isRelevant) {
      relevantTopics.push(topicId);

      // Check which figures are present
      for (const figure of config.figures) {
        if (responseLower.includes(figure.toLowerCase())) {
          present.push(`${topicId}: ${figure}`);
        } else {
          missing.push(`${topicId}: ${figure} (${config.description})`);
        }
      }
    }
  }

  return { missing, present, relevantTopics };
}

/**
 * Enhanced system prompt addition for key figures
 * Add this to the system prompt when relevant topics are detected
 */
export function getKeyFiguresPromptAddition(query: string): string {
  const queryLower = query.toLowerCase();
  const relevantFigures: string[] = [];

  for (const config of Object.values(KEY_FIGURE_CHECKS)) {
    const isRelevant = config.keywords.some(kw => queryLower.includes(kw));
    if (isRelevant) {
      relevantFigures.push(`- ${config.figures.join(' / ')}: ${config.description}`);
    }
  }

  if (relevantFigures.length === 0) {
    return '';
  }

  return `

KEY FIGURES (Include in your response if relevant):
${relevantFigures.join('\n')}

Always cite the source when including these figures.`;
}

/**
 * Get overall response quality score
 */
export function getResponseQualityScore(
  response: string,
  query: string,
  sourceCount: number
): {
  score: number;  // 0-100
  breakdown: {
    citationQuality: number;  // 0-40
    keyFigures: number;       // 0-30
    completeness: number;     // 0-30
  };
  feedback: string[];
} {
  const feedback: string[] = [];

  // Citation quality (40 points max)
  const citationValidation = validateCitations(response, sourceCount);
  let citationQuality = 40;

  if (citationValidation.hasClusteredCitations) {
    citationQuality -= 15;
    feedback.push('Citations should be inline, not grouped at paragraph end');
  }

  if (citationValidation.invalidCitations.length > 0) {
    citationQuality -= 10;
    feedback.push('Some citations reference non-existent sources');
  }

  if (citationValidation.coverage < 0.5) {
    citationQuality -= 15;
    feedback.push('Many factual claims lack citations');
  }

  citationQuality = Math.max(citationQuality, 0);

  // Key figures (30 points max)
  const keyFigureCheck = checkKeyFigures(query, response);
  let keyFigures = 30;

  if (keyFigureCheck.relevantTopics.length > 0) {
    const presentRatio = keyFigureCheck.present.length /
      (keyFigureCheck.present.length + keyFigureCheck.missing.length);
    keyFigures = Math.round(presentRatio * 30);

    if (keyFigureCheck.missing.length > 0) {
      feedback.push(`Missing key figures: ${keyFigureCheck.missing.slice(0, 3).map(m => m.split(':')[1]).join(', ')}`);
    }
  }

  // Completeness (30 points max) - based on response length and structure
  let completeness = 30;
  const wordCount = response.split(/\s+/).length;

  if (wordCount < 50) {
    completeness -= 15;
    feedback.push('Response may be too brief');
  }

  if (!response.includes('\n') && wordCount > 100) {
    completeness -= 5;
    feedback.push('Consider adding paragraph breaks for readability');
  }

  const score = citationQuality + keyFigures + completeness;

  return {
    score,
    breakdown: {
      citationQuality,
      keyFigures,
      completeness,
    },
    feedback,
  };
}
