/**
 * Query Classifier for RAG System
 *
 * Classifies queries to determine optimal retrieval parameters:
 * - topK: How many chunks to retrieve
 * - minSimilarity: Minimum relevance threshold
 * - expansionStrategy: How aggressively to expand query terms
 */

export type QueryComplexity = 'simple' | 'technical' | 'procedural' | 'definitional'

export interface QueryClassification {
  complexity: QueryComplexity
  intent: 'lookup' | 'analysis' | 'procedure' | 'definition'
  entities: string[]           // Extracted legal entities (Article X, Section Y)
  topK: number                 // Recommended retrieval count
  minSimilarity: number        // Minimum relevance threshold
  expansionStrategy: 'minimal' | 'standard' | 'full'
}

// Detection signals for different query types
const TECHNICAL_SIGNALS = [
  'transfer pricing',
  'permanent establishment',
  'arm\'s length',
  'related party',
  'thin capitalization',
  'anti-abuse',
  'gaar',
  'withholding tax',
  'double taxation',
  'tax treaty',
  'controlled foreign',
  'base erosion',
  'profit shifting',
  'intercompany',
  'arm\'s-length',
  'safe harbour',
  'safe harbor',
  'domestic minimum top-up tax',
  'qdmtt',
  'substance requirement',
  'economic substance',
  'beneficial owner',
  'place of effective management',
  'deemed distribution',
]

const PROCEDURAL_SIGNALS = [
  'how to',
  'how do i',
  'how can i',
  'steps to',
  'process for',
  'procedure',
  'file',
  'submit',
  'register',
  'apply for',
  'deadline',
  'form',
  'requirement',
  'what documents',
  'where do i',
  'when should',
]

const DEFINITION_SIGNALS = [
  'what is',
  'what are',
  'define',
  'definition of',
  'meaning of',
  'explain',
  'what does',
  'who is',
  'who are',
]

/**
 * Extract legal entities from query text
 * Finds Article/Chapter/Section references and Decree-Law mentions
 */
function extractLegalEntities(query: string): string[] {
  const entities: string[] = []

  // Article references: "Article 23", "Article 50(1)"
  const articleMatches = query.matchAll(/Article\s+(\d+)(?:\s*\([^)]+\))?/gi)
  for (const match of articleMatches) {
    entities.push(`Article ${match[1]}`)
  }

  // Chapter references: "Chapter 5", "Chapter XII"
  const chapterMatches = query.matchAll(/Chapter\s+(\d+|[IVXLC]+)/gi)
  for (const match of chapterMatches) {
    entities.push(`Chapter ${match[1]}`)
  }

  // Section references: "Section 4.1", "Section 12"
  const sectionMatches = query.matchAll(/Section\s+([\d.]+)/gi)
  for (const match of sectionMatches) {
    entities.push(`Section ${match[1]}`)
  }

  // Decree-Law references: "Decree-Law No. 47", "Federal Decree Law 47"
  const decreeMatches = query.matchAll(/(?:Federal\s+)?Decree[- ]Law(?:\s+No\.?)?\s*(\d+)/gi)
  for (const match of decreeMatches) {
    entities.push(`Decree-Law ${match[1]}`)
  }

  // Cabinet Decision references
  const cabinetMatches = query.matchAll(/Cabinet\s+Decision(?:\s+No\.?)?\s*(\d+)/gi)
  for (const match of cabinetMatches) {
    entities.push(`Cabinet Decision ${match[1]}`)
  }

  // Ministerial Decision references
  const ministerialMatches = query.matchAll(/Ministerial\s+Decision(?:\s+No\.?)?\s*(\d+)/gi)
  for (const match of ministerialMatches) {
    entities.push(`Ministerial Decision ${match[1]}`)
  }

  return [...new Set(entities)]
}

/**
 * Classify a query to determine optimal retrieval parameters
 */
export function classifyQuery(query: string): QueryClassification {
  const lowerQuery = query.toLowerCase()
  const wordCount = query.split(/\s+/).filter(w => w.length > 0).length

  // Extract legal entities
  const entities = extractLegalEntities(query)

  // Default classification
  let complexity: QueryComplexity = 'simple'
  let intent: QueryClassification['intent'] = 'lookup'
  let topK = 10
  let minSimilarity = 0.40
  let expansionStrategy: QueryClassification['expansionStrategy'] = 'standard'

  // Check for technical queries (complex tax concepts)
  const hasTechnicalSignal = TECHNICAL_SIGNALS.some(s => lowerQuery.includes(s))
  const isLongQuery = wordCount > 15

  if (hasTechnicalSignal || isLongQuery) {
    complexity = 'technical'
    intent = 'analysis'
    topK = 15
    minSimilarity = 0.35
    expansionStrategy = 'full'
  }
  // Check for procedural queries (how-to questions)
  else if (PROCEDURAL_SIGNALS.some(s => lowerQuery.includes(s))) {
    complexity = 'procedural'
    intent = 'procedure'
    topK = 10
    minSimilarity = 0.40
    expansionStrategy = 'standard'
  }
  // Check for definitional queries (what is X)
  else if (DEFINITION_SIGNALS.some(s => lowerQuery.includes(s))) {
    complexity = 'definitional'
    intent = 'definition'
    topK = 8
    minSimilarity = 0.40
    expansionStrategy = 'minimal'
  }
  // Simple factual queries (short, direct questions)
  else if (wordCount <= 8) {
    complexity = 'simple'
    intent = 'lookup'
    topK = 5
    minSimilarity = 0.45
    expansionStrategy = 'minimal'
  }

  // Boost topK if query has specific entity references (user knows what they want)
  if (entities.length > 0) {
    topK = Math.max(topK, 8) // At least 8 for entity-specific queries
  }

  return {
    complexity,
    intent,
    entities,
    topK,
    minSimilarity,
    expansionStrategy
  }
}

/**
 * Get a human-readable description of the classification
 * Useful for logging and debugging
 */
export function describeClassification(classification: QueryClassification): string {
  const parts = [
    `Complexity: ${classification.complexity}`,
    `Intent: ${classification.intent}`,
    `TopK: ${classification.topK}`,
    `MinSim: ${classification.minSimilarity}`,
    `Expansion: ${classification.expansionStrategy}`,
  ]

  if (classification.entities.length > 0) {
    parts.push(`Entities: [${classification.entities.join(', ')}]`)
  }

  return parts.join(' | ')
}
