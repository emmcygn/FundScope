// PE fund term market standard ranges (based on ILPA guidelines)
// These are used for deviation flagging in the comparison matrix
export const MARKET_STANDARDS = {
  management_fee: {
    typical_range: [1.5, 2.0],      // % of committed capital
    unit: 'percent',
    description: 'Annual management fee as % of committed capital during investment period',
  },
  carried_interest: {
    typical_range: [20, 20],          // Almost always 20%
    unit: 'percent',
    description: 'GP profit share above hurdle rate',
  },
  preferred_return: {
    typical_range: [7, 8],            // % annual
    unit: 'percent',
    description: 'Minimum LP return before GP earns carry',
  },
  gp_commitment: {
    typical_range: [1, 5],            // % of total fund
    unit: 'percent',
    description: 'GP co-investment as % of total fund size',
  },
  investment_period: {
    typical_range: [4, 6],            // years
    unit: 'years',
    description: 'Period during which new investments can be made',
  },
  fund_term: {
    typical_range: [10, 12],          // years
    unit: 'years',
    description: 'Total life of the fund',
  },
  capital_call_notice: {
    typical_range: [10, 15],          // business days
    unit: 'business_days',
    description: 'Minimum notice period for capital calls',
  },
} as const

// Document type labels for UI
export const DOC_TYPE_LABELS: Record<string, string> = {
  lpa: 'Limited Partnership Agreement',
  side_letter: 'Side Letter',
  term_sheet: 'Term Sheet',
  sub_agreement: 'Subscription Agreement',
  ppm: 'Private Placement Memorandum',
  nda: 'Non-Disclosure Agreement',
  other: 'Other Document',
}

// Chunk configuration
export const CHUNK_CONFIG = {
  maxSize: 800,
  overlap: 100,
  minSize: 100,
} as const

// Embedding configuration
export const EMBEDDING_CONFIG = {
  model: 'text-embedding-3-large' as const,
  dimensions: 1024,
} as const

// Search configuration
export const SEARCH_CONFIG = {
  topK: 20,             // Initial retrieval count
  rerankTopK: 5,        // After reranking
  similarityThreshold: 0.3,
  bm25Weight: 0.3,      // Weight for keyword search in hybrid
  denseWeight: 0.7,     // Weight for vector search in hybrid
} as const
