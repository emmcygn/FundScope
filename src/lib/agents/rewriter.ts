import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const rewriteSchema = z.object({
  rewrittenQuery: z.string().describe('The improved search query'),
  reasoning: z.string().describe('Why the original query was rewritten this way'),
})

export type RewriteResult = z.infer<typeof rewriteSchema>

/**
 * Rewrites a query that produced insufficient relevant results.
 * Uses GPT-4o-mini — rewriting is a lightweight generation task.
 *
 * The rewriter uses the original query plus the irrelevant chunks
 * (as negative examples) to produce a better search query.
 */
export async function rewriteQuery(
  originalQuery: string,
  irrelevantTexts: string[]
): Promise<RewriteResult> {
  const irrelevantSample = irrelevantTexts
    .slice(0, 3) // Only show a few examples to keep the prompt short
    .map((t, i) => `${i + 1}. ${t.slice(0, 200)}...`)
    .join('\n')

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: rewriteSchema,
    maxOutputTokens: 200,
    temperature: 0.3, // Slight creativity for rephrasing
    experimental_telemetry: { isEnabled: true, functionId: 'rewrite-query' },
    prompt: `You are a query rewriter for a legal document search system focused on private equity fund documents (LPAs, side letters, term sheets).

The original query did not retrieve enough relevant results. Rewrite the query to improve retrieval. Strategies:
- Use more specific legal terminology (e.g., "management fee" instead of "fees")
- Break compound questions into the most important sub-question
- Add context terms that would appear near the answer (e.g., "Section" or "Article")
- If the query uses colloquial language, translate to formal legal terms

Original query: "${originalQuery}"

These chunks were retrieved but found irrelevant — avoid retrieving similar content:
${irrelevantSample || 'None available'}

Rewrite the query to find more relevant results.`,
  })

  return object
}
