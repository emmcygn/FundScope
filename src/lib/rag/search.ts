import { createAdminClient } from '@/lib/supabase/server'
import { generateQueryEmbedding } from './embeddings'
import { SEARCH_CONFIG } from '@/lib/utils/constants'
import { RAGError } from '@/lib/utils/errors'

export interface SearchResult {
  chunkId: string
  documentId: string
  text: string
  contextSummary: string | null
  pageNumber: number | null
  sectionNumber: string | null
  score: number
  searchType: 'dense' | 'bm25' | 'hybrid'
  metadata: Record<string, unknown>
}

/**
 * Hybrid search combining dense (vector) and sparse (BM25) retrieval.
 *
 * Why hybrid? Legal documents need BOTH:
 * - Semantic search: "What are the GP's monetary obligations?" finds "management fee" clauses
 * - Keyword search: "Section 4.2(b)" or "LIBOR + 200bps" needs exact matching
 *
 * The results are merged using Reciprocal Rank Fusion (RRF).
 */
export async function hybridSearch(
  query: string,
  fundId: string,
  options?: {
    topK?: number
    documentIds?: string[]
    densityWeight?: number
  }
): Promise<SearchResult[]> {
  const topK = options?.topK ?? SEARCH_CONFIG.topK
  const denseWeight = options?.densityWeight ?? SEARCH_CONFIG.denseWeight
  const bm25Weight = 1 - denseWeight

  try {
    // Run both searches in parallel
    const [denseResults, bm25Results] = await Promise.all([
      denseSearch(query, fundId, topK, options?.documentIds),
      bm25Search(query, fundId, topK, options?.documentIds),
    ])

    // Merge using Reciprocal Rank Fusion
    const merged = reciprocalRankFusion(
      denseResults,
      bm25Results,
      denseWeight,
      bm25Weight
    )

    return merged.slice(0, topK)
  } catch (error) {
    throw new RAGError(
      `Hybrid search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { query, fundId }
    )
  }
}

/**
 * Dense (vector) search using pgvector cosine similarity.
 */
async function denseSearch(
  query: string,
  fundId: string,
  topK: number,
  documentIds?: string[]
): Promise<SearchResult[]> {
  const supabase = createAdminClient()
  const queryEmbedding = await generateQueryEmbedding(query)

  // Use Supabase's RPC for vector similarity search
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: topK,
    filter_fund_id: fundId,
    filter_document_ids: documentIds ?? null,
  })

  if (error) {
    throw new RAGError(`Dense search failed: ${error.message}`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any, index: number) => ({
    chunkId: row.id,
    documentId: row.document_id,
    text: row.text,
    contextSummary: row.context_summary,
    pageNumber: row.page_number,
    sectionNumber: row.section_number,
    score: 1 - (row.distance ?? 0), // Convert distance to similarity
    searchType: 'dense' as const,
    metadata: row.metadata ?? {},
  }))
}

/**
 * BM25 (keyword) search using Postgres full-text search.
 */
async function bm25Search(
  query: string,
  fundId: string,
  topK: number,
  documentIds?: string[]
): Promise<SearchResult[]> {
  const supabase = createAdminClient()

  // Stop words to remove — these appear in user questions but not in legal text,
  // so AND-ing them produces zero results. Keep legal abbreviations like GP/LP.
  const STOP_WORDS = new Set([
    'what', 'whats', 'is', 'are', 'the', 'a', 'an', 'do', 'does', 'did',
    'how', 'when', 'where', 'which', 'who', 'why', 'can', 'will', 'would',
    'should', 'could', 'may', 'might', 'this', 'that', 'there', 'their',
    'with', 'for', 'not', 'but', 'any', 'all', 'has', 'have', 'been',
    'was', 'were', 'be', 'by', 'of', 'in', 'on', 'at', 'to', 'from',
    'and', 'or', 'if', 'its', 'it', 'me', 'my', 'we', 'our', 'about',
    'into', 'than', 'then', 'so', 'also', 'just', 'between', 'during',
    'within', 'without', 'under', 'over', 'after', 'before', 'as', 'per',
    'each', 'such', 'no', 'yes', 'i', 'you', 'they', 'them', 'he', 'she',
  ])

  // Use OR (|) instead of AND (&): legal sections split terms across chunks
  // (e.g. "Management Fee" header in chunk A, the actual rate in chunk B).
  // OR recovers both; Cohere reranker + grader filter noise downstream.
  // Keep word length > 1 so "GP" and "LP" are included.
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^\w]/g, ''))
    .filter(word => word.length > 1 && !STOP_WORDS.has(word))
    .slice(0, 10) // cap to avoid tsquery length limits

  const tsQuery = terms.join(' | ')

  if (!tsQuery) return []

  let queryBuilder = supabase
    .from('chunks')
    .select(`
      id,
      document_id,
      text,
      context_summary,
      page_number,
      section_number,
      metadata,
      documents!inner(fund_id)
    `)
    .textSearch('fts', tsQuery)
    .eq('documents.fund_id', fundId)
    .limit(topK)

  if (documentIds && documentIds.length > 0) {
    queryBuilder = queryBuilder.in('document_id', documentIds)
  }

  const { data, error } = await queryBuilder

  if (error) {
    // BM25 search failure is non-fatal — fall back to dense only
    console.warn('BM25 search failed:', error.message)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any, index: number) => ({
    chunkId: row.id,
    documentId: row.document_id,
    text: row.text,
    contextSummary: row.context_summary,
    pageNumber: row.page_number,
    sectionNumber: row.section_number,
    score: 1 / (index + 1), // Rank-based score
    searchType: 'bm25' as const,
    metadata: row.metadata ?? {},
  }))
}

/**
 * Reciprocal Rank Fusion: merges two ranked lists into one.
 *
 * For each result, its RRF score = sum of (weight / (k + rank)) across all lists.
 * k is a constant (usually 60) that dampens the effect of high rankings.
 */
function reciprocalRankFusion(
  denseResults: SearchResult[],
  bm25Results: SearchResult[],
  denseWeight: number,
  bm25Weight: number,
  k: number = 60
): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult }>()

  // Score dense results
  denseResults.forEach((result, rank) => {
    const rrfScore = denseWeight * (1 / (k + rank + 1))
    const existing = scores.get(result.chunkId)
    if (existing) {
      existing.score += rrfScore
      existing.result.searchType = 'hybrid'
    } else {
      scores.set(result.chunkId, { score: rrfScore, result: { ...result, searchType: 'hybrid' } })
    }
  })

  // Score BM25 results
  bm25Results.forEach((result, rank) => {
    const rrfScore = bm25Weight * (1 / (k + rank + 1))
    const existing = scores.get(result.chunkId)
    if (existing) {
      existing.score += rrfScore
      existing.result.searchType = 'hybrid'
    } else {
      scores.set(result.chunkId, { score: rrfScore, result: { ...result, searchType: 'hybrid' } })
    }
  })

  // Sort by combined RRF score descending
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }))
}
