import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

/**
 * Query types determine retrieval strategy:
 * - simple_lookup: Single fact from one document (e.g., "What is the management fee?")
 * - comparison: Cross-document analysis (e.g., "How does Fund A's carry compare to Fund B?")
 * - multi_hop: Requires reasoning across multiple sections/documents
 * - general: Conversational or non-document queries
 */
export const QueryType = z.enum([
  'simple_lookup',
  'comparison',
  'multi_hop',
  'general',
])
export type QueryType = z.infer<typeof QueryType>

const routingSchema = z.object({
  queryType: QueryType,
  reasoning: z.string().describe('Brief explanation of why this classification was chosen'),
  suggestedSearchQueries: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe('Search queries to use for retrieval — rephrase the user query for better search results'),
})

export type RoutingResult = z.infer<typeof routingSchema>

/**
 * Classifies a user query to determine retrieval strategy.
 * Uses GPT-4o-mini for speed — classification is a lightweight task.
 */
export async function routeQuery(query: string): Promise<RoutingResult> {
  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: routingSchema,
    maxOutputTokens: 300,
    temperature: 0,
    experimental_telemetry: { isEnabled: true, functionId: 'route-query' },
    prompt: `You are a query classifier for a legal document analysis platform focused on private equity fund documents (LPAs, side letters, term sheets).

Classify this user query into one of these types:
- simple_lookup: Looking for a specific fact or term from a single document (e.g., "What is the management fee?", "What is the fund term?")
- comparison: Comparing terms across multiple documents or funds (e.g., "How does Fund A's carry compare to Fund B?", "Compare the fee structures")
- multi_hop: Requires combining information from multiple sections or documents to answer (e.g., "Does the side letter's MFN clause override the LPA's fee structure?", "What obligations trigger if a key person event occurs?")
- general: Conversational, greetings, or questions not about specific document content (e.g., "Hello", "What can you do?", "Explain what carried interest means in general")

Also generate 1-3 search queries optimized for retrieving relevant document chunks. Use precise legal terminology where appropriate.

User query: "${query}"`,
  })

  return object
}
