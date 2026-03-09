import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
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
  _fullTextPreview: string // kept for API compatibility but no longer used in prompt
): Promise<string> {
  const location = [
    chunk.sectionNumber ? `Section ${chunk.sectionNumber}` : null,
    chunk.pageNumber != null ? `page ${chunk.pageNumber}` : null,
  ]
    .filter(Boolean)
    .join(', ')

  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    maxOutputTokens: 250,
    temperature: 0,
    experimental_telemetry: { isEnabled: true, functionId: 'context-summary' },
    prompt: `You are a legal document analyst specialising in private equity fund documents.

Document: "${documentTitle}" (${documentType})
Location: ${location || 'unknown location'}

Chunk text:
"""
${chunk.text}
"""

Write a 2–3 sentence context summary for this chunk. Rules:
1. You MUST quote or paraphrase every specific rate, percentage, dollar amount, date, threshold, or defined term that appears (e.g. "1.75% per annum", "Commitment Period", "Advisory Committee").
2. Name the legal concept or clause type (e.g. "management fee step-down", "key person provision", "distribution waterfall").
3. Identify the parties affected if mentioned (e.g. "General Partner", "Limited Partners").
4. Do NOT use generic phrases like "this section describes" or "this clause outlines" — be specific.
5. Write ONLY the summary, no preamble.`,
  })

  return text.trim()
}
