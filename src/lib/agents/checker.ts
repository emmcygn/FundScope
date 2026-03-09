import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const claimCheckSchema = z.object({
  claims: z.array(
    z.object({
      claim: z.string().describe('A specific factual claim from the answer'),
      supported: z.boolean().describe('Whether this claim is supported by the provided context'),
      sourceReference: z.string().optional().describe('Which source supports this claim, if any'),
    })
  ),
  overallSupported: z.boolean().describe('Whether the answer as a whole is well-supported by the context'),
  unsupportedSummary: z
    .string()
    .optional()
    .describe('Brief summary of what claims lack support, if any'),
})

export type CheckerResult = z.infer<typeof claimCheckSchema>

/**
 * Post-generation hallucination checker.
 * Extracts factual claims from the generated answer and verifies each
 * against the source context. Uses Claude Sonnet for nuanced legal reasoning.
 *
 * Returns a structured result with per-claim verification and an overall verdict.
 */
export async function checkHallucinations(
  answer: string,
  context: string
): Promise<CheckerResult> {
  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-20250514'),
    schema: claimCheckSchema,
    maxOutputTokens: 4000,
    temperature: 0,
    experimental_telemetry: { isEnabled: true, functionId: 'check-hallucinations' },
    prompt: `You are a hallucination checker for a legal AI assistant. Your job is to verify that every factual claim in the generated answer is supported by the provided source context.

IMPORTANT:
- Extract each distinct factual claim from the answer (numbers, dates, percentages, legal terms, obligations, conditions)
- For each claim, check if it is directly supported by the source context
- General legal knowledge or definitions do NOT count as support — only the provided context counts
- Be strict: if a claim adds specificity not present in the context, mark it as unsupported
- Citations like [Source N] should correspond to actual content in the context

GENERATED ANSWER:
"""
${answer}
"""

SOURCE CONTEXT:
"""
${context}
"""

Verify each factual claim in the answer against the source context.`,
  })

  return object
}
