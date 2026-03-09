import { SEARCH_CONFIG } from '@/lib/utils/constants'
import { getLangfuse } from '@/lib/observability/langfuse'
import type { SearchResult } from './search'

/**
 * Re-ranks search results using Cohere's cross-encoder reranking API.
 *
 * Why re-rank? The initial retrieval (hybrid search) uses bi-encoders —
 * they encode the query and each document independently, then compare.
 * Cross-encoders look at the query AND document together, which is much
 * more accurate but too expensive to run on the full corpus. So we use
 * bi-encoders to get top-20, then cross-encoders to re-rank to top-5.
 */
export async function rerankResults(
  query: string,
  results: SearchResult[],
  topK?: number
): Promise<SearchResult[]> {
  const finalTopK = topK ?? SEARCH_CONFIG.rerankTopK

  if (results.length === 0) return []
  if (results.length <= finalTopK) return results

  // If Cohere API key is not set, skip reranking (graceful degradation)
  if (!process.env.COHERE_API_KEY) {
    console.warn('COHERE_API_KEY not set — skipping reranking')
    return results.slice(0, finalTopK)
  }

  // Wrap Cohere API call in a manual Langfuse span for observability
  const langfuse = getLangfuse()
  const span = langfuse?.span({
    name: 'cohere-rerank',
    input: { query, documentCount: results.length, topK: finalTopK },
  })

  try {
    const response = await fetch('https://api.cohere.com/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'rerank-english-v3.0',
        query: query,
        documents: results.map(r => r.text),
        top_n: finalTopK,
        return_documents: false,
      }),
    })

    if (!response.ok) {
      span?.end({ output: { error: `HTTP ${response.status}` } })
      console.warn(`Cohere rerank failed (${response.status}), using original ranking`)
      return results.slice(0, finalTopK)
    }

    const data = await response.json()

    // Map reranked indices back to original results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reranked: SearchResult[] = data.results.map((r: any) => ({
      ...results[r.index]!,
      score: r.relevance_score,
    }))

    span?.end({ output: { rerankedCount: reranked.length } })
    return reranked
  } catch (error) {
    span?.end({ output: { error: String(error) } })
    console.warn('Reranking failed, using original ranking:', error)
    return results.slice(0, finalTopK)
  }
}
