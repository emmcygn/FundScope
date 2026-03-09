import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import type { Chunk } from './chunker'

/**
 * Generates contextual summaries for chunks.
 *
 * Why: When a chunk says "The fee shall be 2% of committed capital", the embedding
 * captures "fee" and "2%" but loses the context of WHICH document, WHICH party,
 * and WHAT type of fee. The contextual summary adds: "This chunk is from Section 4.2
 * of a Limited Partnership Agreement between Acme GP and various LPs, describing
 * the management fee structure." This makes the embedding much more specific.
 *
 * Anthropic's research shows this reduces retrieval failures by ~67%.
 */
export async function enrichChunksWithContext(
  chunks: Chunk[],
  documentTitle: string,
  documentType: string,
  fullTextPreview: string // First ~2000 chars of document for context
): Promise<Chunk[]> {
  // Process in batches of 5 to avoid rate limits
  const batchSize = 5
  const enrichedChunks: Chunk[] = []

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)

    const enriched = await Promise.all(
      batch.map(async (chunk) => {
        try {
          const contextSummary = await generateContextSummary(
            chunk, documentTitle, documentType, fullTextPreview
          )
          return {
            ...chunk,
            text: `[Context: ${contextSummary}]\n\n${chunk.text}`,
            metadata: {
              ...chunk.metadata,
              contextSummary,
              originalText: chunk.text, // Preserve original for display
            },
          }
        } catch (error) {
          // If context generation fails for a chunk, use it without context
          console.warn(
            `Context generation failed for chunk ${chunk.index}:`,
            error instanceof Error ? error.message : error
          )
          return chunk
        }
      })
    )

    enrichedChunks.push(...enriched)

    // Brief delay between batches to respect rate limits
    if (i + batchSize < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  return enrichedChunks
}

async function generateContextSummary(
  chunk: Chunk,
  documentTitle: string,
  documentType: string,
  fullTextPreview: string
): Promise<string> {
  const { text } = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    maxOutputTokens: 150,
    temperature: 0,
    experimental_telemetry: { isEnabled: true, functionId: 'context-summary' },
    prompt: `You are a legal document analyst. Given the following chunk from a ${documentType} titled "${documentTitle}", write a brief (1-2 sentence) context summary that would help someone understand what this chunk is about without seeing the rest of the document.

Document preview (first section):
${fullTextPreview.slice(0, 1500)}

Chunk (from ${chunk.sectionNumber ? `Section ${chunk.sectionNumber}` : 'the document'}, page ${chunk.pageNumber ?? 'unknown'}):
${chunk.text.slice(0, 500)}

Write ONLY the context summary, nothing else. Be specific about parties, clause types, and legal concepts mentioned.`,
  })

  return text.trim()
}
