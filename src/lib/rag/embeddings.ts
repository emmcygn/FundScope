import { embed, embedMany } from 'ai'
import { openai } from '@ai-sdk/openai'
import { EMBEDDING_CONFIG } from '@/lib/utils/constants'

/**
 * Generates embeddings for an array of text strings.
 * Uses OpenAI's text-embedding-3-large model with 1024 dimensions.
 *
 * Why 1024 dimensions instead of the default 3072?
 * - Supabase pgvector performance degrades with very high dimensions
 * - 1024 retains ~95% of the quality at 1/3 the storage cost
 * - Faster similarity search
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  // Process in batches of 100 (OpenAI limit for embedMany)
  const batchSize = 100
  const allEmbeddings: number[][] = []

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)

    // Dimensions are passed via providerOptions since openai.embedding() only takes model ID
    const { embeddings } = await embedMany({
      model: openai.embedding(EMBEDDING_CONFIG.model),
      values: batch,
      providerOptions: {
        openai: { dimensions: EMBEDDING_CONFIG.dimensions },
      },
      experimental_telemetry: { isEnabled: true, functionId: 'embed-chunks' },
    })

    allEmbeddings.push(...embeddings)
  }

  return allEmbeddings
}

/**
 * Generates a single embedding for a query string.
 */
export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_CONFIG.model),
    value: query,
    providerOptions: {
      openai: { dimensions: EMBEDDING_CONFIG.dimensions },
    },
    experimental_telemetry: { isEnabled: true, functionId: 'embed-query' },
  })

  return embedding
}
