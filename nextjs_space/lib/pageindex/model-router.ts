/**
 * Model Router for Task-Based Model Selection
 *
 * Routes queries to optimal models based on task complexity:
 * - Simple queries → gpt-4o-mini (fast, cheap)
 * - Complex queries → gpt-4.1 or gpt-4o (better reasoning)
 * - Legal analysis → o4-mini (reasoning models when available)
 *
 * Research: Based on OpenAI model capabilities 2025
 */

export type TaskType =
  | 'classification'      // Intent classification
  | 'retrieval'           // Tree navigation
  | 'simple_generation'   // Basic Q&A
  | 'complex_generation'  // Multi-step analysis
  | 'legal_analysis';     // Complex legal reasoning

export interface ModelConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  description: string;
}

/**
 * Model configurations by task type
 * Can be extended when new models become available (GPT-4.1, O4-mini)
 */
const MODEL_CONFIGS: Record<TaskType, ModelConfig> = {
  classification: {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    maxTokens: 300,
    description: 'Fast classification with low temperature for consistency'
  },
  retrieval: {
    model: 'gpt-4o',
    temperature: 0.2,
    maxTokens: 500,
    description: 'Strong reasoning for tree navigation'
  },
  simple_generation: {
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 1500,
    description: 'Cost-effective for straightforward Q&A'
  },
  complex_generation: {
    model: 'gpt-4o',
    temperature: 0.3,
    maxTokens: 2000,
    description: 'Full capability for complex answers'
  },
  legal_analysis: {
    // Note: When o4-mini becomes available, use it here for reasoning tasks
    // Current fallback to gpt-4o which has good reasoning
    model: 'gpt-4o',
    temperature: 0.2,  // Lower temp for legal precision
    maxTokens: 3000,
    description: 'Complex legal analysis requiring careful reasoning'
  }
};

/**
 * Get model configuration for a specific task type
 */
export function getModelConfig(taskType: TaskType): ModelConfig {
  return MODEL_CONFIGS[taskType];
}

/**
 * Indicators for complex legal questions requiring deeper reasoning
 */
const COMPLEX_INDICATORS = [
  // Comparison/analysis patterns
  'compare', 'contrast', 'versus', 'vs', 'difference between',
  'analyze', 'analysis', 'implications', 'consequences',

  // Multi-step reasoning patterns
  'multiple', 'scenarios', 'various', 'different cases',
  'step by step', 'process', 'procedure',

  // Legal complexity patterns
  'exceptions', 'interplay', 'interaction between',
  'anti-abuse', 'gaar', 'substance', 'economic substance',
  'transfer pricing', 'permanent establishment',

  // Hypothetical reasoning
  'what if', 'suppose', 'assume', 'hypothetically',
  'in case of', 'scenario where',
];

/**
 * Indicators for simple factual queries
 */
const SIMPLE_INDICATORS = [
  'what is the', 'what are the', 'define',
  'rate', 'threshold', 'deadline',
  'when', 'how much', 'percentage',
];

/**
 * Select the appropriate task type based on query characteristics
 */
export function selectTaskType(
  query: string,
  options: {
    classificationConfidence?: number;  // From intent classification
    sourceCount?: number;               // Number of sources retrieved
    documentCount?: number;             // Number of documents involved
  } = {}
): TaskType {
  const {
    classificationConfidence = 0.8,
    sourceCount = 1,
    documentCount = 1,
  } = options;

  const queryLower = query.toLowerCase();
  const wordCount = query.split(/\s+/).length;

  // Check for complex indicators
  const hasComplexIndicator = COMPLEX_INDICATORS.some(ind =>
    queryLower.includes(ind)
  );

  // Check for simple indicators
  const hasSimpleIndicator = SIMPLE_INDICATORS.some(ind =>
    queryLower.includes(ind)
  );

  // Multi-document queries often need more reasoning
  const isMultiDocument = documentCount > 1;

  // Long queries with many sources suggest complexity
  const isComplex = (wordCount > 20 && sourceCount > 3) ||
                    hasComplexIndicator ||
                    (isMultiDocument && wordCount > 15);

  // Legal analysis for specific complex patterns
  const needsLegalAnalysis = (
    queryLower.includes('anti-abuse') ||
    queryLower.includes('gaar') ||
    queryLower.includes('economic substance') ||
    queryLower.includes('transfer pricing') ||
    (hasComplexIndicator && wordCount > 30)
  );

  // Route based on analysis
  if (needsLegalAnalysis) {
    return 'legal_analysis';
  }

  if (isComplex) {
    return 'complex_generation';
  }

  if (hasSimpleIndicator || wordCount < 15) {
    return 'simple_generation';
  }

  // Default to complex if unsure (better quality)
  return classificationConfidence > 0.9 ? 'simple_generation' : 'complex_generation';
}

/**
 * Get the model to use for a query, considering task type and user preference
 */
export function getModelForQuery(
  query: string,
  options: {
    userPreferredModel?: string;       // Model specified by user
    classificationConfidence?: number;
    sourceCount?: number;
    documentCount?: number;
    allowOverride?: boolean;           // Allow task-based override
  } = {}
): { model: string; taskType: TaskType; config: ModelConfig } {
  const {
    userPreferredModel,
    allowOverride = true,
    ...taskOptions
  } = options;

  // Determine task type
  const taskType = selectTaskType(query, taskOptions);
  const config = getModelConfig(taskType);

  // If user specified a model and we allow overrides
  if (userPreferredModel && allowOverride) {
    // For legal analysis, always use recommended model
    if (taskType === 'legal_analysis') {
      return { model: config.model, taskType, config };
    }

    // Otherwise respect user preference
    return {
      model: userPreferredModel,
      taskType,
      config: { ...config, model: userPreferredModel }
    };
  }

  return { model: config.model, taskType, config };
}

/**
 * Check if a model supports reasoning mode (for future O-series models)
 */
export function supportsReasoningMode(model: string): boolean {
  // O-series models support reasoning
  return model.startsWith('o3') || model.startsWith('o4') || model.startsWith('o1');
}

/**
 * Get available models for selection
 */
export function getAvailableModels(): Array<{
  id: string;
  name: string;
  tier: 'fast' | 'balanced' | 'powerful';
  costPerMToken: number;
}> {
  return [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'fast', costPerMToken: 0.15 },
    { id: 'gpt-4o', name: 'GPT-4o', tier: 'balanced', costPerMToken: 2.50 },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', tier: 'powerful', costPerMToken: 10.00 },
    // Future models (when available):
    // { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', tier: 'fast', costPerMToken: 0.20 },
    // { id: 'o4-mini', name: 'O4 Mini', tier: 'balanced', costPerMToken: 1.10 },
  ];
}
