import { createServerSupabaseClient } from '@/lib/supabase/server'
import { hybridSearch } from '@/lib/rag/search'
import { rerankResults } from '@/lib/rag/reranker'
import { routeQuery } from '@/lib/agents/router'
import { gradeChunks } from '@/lib/agents/grader'
import { rewriteQuery } from '@/lib/agents/rewriter'
import {
  generateStreamingAnswer,
  generateFullAnswer,
  formatContext,
  buildCitations,
} from '@/lib/agents/generator'
import { checkHallucinations } from '@/lib/agents/checker'
import { getLangfuse, flushLangfuse } from '@/lib/observability/langfuse'
import type { SearchResult } from '@/lib/rag/search'

export const maxDuration = 60

const MAX_REWRITE_RETRIES = 2
const MAX_HALLUCINATION_RETRIES = 2
const MIN_RELEVANT_CHUNKS = 2

export async function POST(request: Request) {
  // 1. Authenticate
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Parse request
  const { messages, fundId } = await request.json()
  const lastMessage = messages[messages.length - 1]

  if (!lastMessage || lastMessage.role !== 'user') {
    return new Response('Invalid message format', { status: 400 })
  }

  const userQuery: string = lastMessage.content

  // Langfuse trace for this request
  const langfuse = getLangfuse()
  const trace = langfuse?.trace({
    name: 'chat-request',
    input: { query: userQuery, fundId },
    userId: user.id,
  })

  // 3. Route the query — determines retrieval strategy
  let routing
  try {
    routing = await routeQuery(userQuery)
  } catch (error) {
    console.error('Router failed, defaulting to simple_lookup:', error)
    routing = {
      queryType: 'simple_lookup' as const,
      reasoning: 'Router failed — using default',
      suggestedSearchQueries: [userQuery],
    }
  }

  trace?.update({ metadata: { queryType: routing.queryType } })

  // For general queries (greetings, meta-questions), skip RAG entirely
  if (routing.queryType === 'general' && !fundId) {
    const result = generateStreamingAnswer(messages, '')
    await flushLangfuse()
    return result.toTextStreamResponse()
  }

  // 4. Retrieve + Grade + Rewrite loop
  let relevantChunks: SearchResult[] = []
  let context = ''
  let citations: ReturnType<typeof buildCitations> = []

  if (fundId) {
    try {
      relevantChunks = await retrieveAndGrade(
        userQuery,
        fundId,
        routing.suggestedSearchQueries
      )
    } catch (error) {
      console.error('Retrieval pipeline failed:', error)
      // Continue without context — generator will say "I don't have enough info"
    }

    if (relevantChunks.length > 0) {
      context = formatContext(relevantChunks)
      citations = buildCitations(relevantChunks)
    }
  }

  // 5. Generate + Check hallucinations loop
  // If hallucination checking is needed, we generate non-streaming first,
  // then stream the verified answer. This costs one extra generation but
  // ensures quality.
  let finalAnswer: string | null = null

  if (context) {
    try {
      finalAnswer = await generateAndVerify(messages, context)
    } catch (error) {
      console.error('Generation/verification failed, falling back to streaming:', error)
      // Fall through to direct streaming below
    }
  }

  // 6. Return response
  trace?.update({
    output: finalAnswer ? { verified: true } : { verified: false, fallback: true },
  })
  await flushLangfuse()

  if (finalAnswer !== null) {
    // We have a verified answer — stream it as a simple text response
    const response = new Response(finalAnswer, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'x-citations': JSON.stringify(citations),
        'x-query-type': routing.queryType,
      },
    })
    return response
  }

  // Fallback: stream directly (no hallucination checking)
  const result = generateStreamingAnswer(messages, context)
  const response = result.toTextStreamResponse()
  response.headers.set('x-citations', JSON.stringify(citations))
  response.headers.set('x-query-type', routing.queryType)
  return response
}

/**
 * Retrieve chunks, grade for relevance, and rewrite the query if needed.
 * Retries up to MAX_REWRITE_RETRIES times.
 */
async function retrieveAndGrade(
  originalQuery: string,
  fundId: string,
  suggestedQueries: string[]
): Promise<SearchResult[]> {
  // Use the first suggested query (or original) for initial search
  let searchQuery = suggestedQueries[0] ?? originalQuery

  for (let attempt = 0; attempt <= MAX_REWRITE_RETRIES; attempt++) {
    // Search
    const searchResults = await hybridSearch(searchQuery, fundId)
    const reranked = await rerankResults(searchQuery, searchResults)

    // Grade
    const { relevant, irrelevant } = await gradeChunks(originalQuery, reranked)

    if (relevant.length >= MIN_RELEVANT_CHUNKS) {
      return relevant
    }

    // Not enough relevant chunks — try rewriting
    if (attempt < MAX_REWRITE_RETRIES) {
      console.warn(
        `Only ${relevant.length} relevant chunks found (attempt ${attempt + 1}), rewriting query...`
      )
      const rewrite = await rewriteQuery(
        originalQuery,
        irrelevant.map((c) => c.text)
      )
      searchQuery = rewrite.rewrittenQuery
    } else {
      // Last attempt — return whatever we have (even if insufficient)
      // Include both relevant and some irrelevant as fallback
      return relevant.length > 0 ? relevant : reranked.slice(0, 3)
    }
  }

  // TypeScript: unreachable, but satisfies the return type
  return []
}

/**
 * Generate an answer, check for hallucinations, and retry if needed.
 * Returns the verified answer text, or null if verification can't be completed.
 */
async function generateAndVerify(
  messages: Parameters<typeof generateFullAnswer>[0],
  context: string
): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_HALLUCINATION_RETRIES; attempt++) {
    const isRetry = attempt > 0
    const answer = await generateFullAnswer(messages, context, isRetry)

    // Check for hallucinations
    const checkResult = await checkHallucinations(answer, context)

    if (checkResult.overallSupported) {
      return answer
    }

    // Log the unsupported claims for observability
    console.warn(
      `Hallucination detected (attempt ${attempt + 1}):`,
      checkResult.unsupportedSummary
    )

    // On last attempt, return the answer anyway (imperfect > nothing)
    if (attempt === MAX_HALLUCINATION_RETRIES) {
      console.warn('Max hallucination retries reached, returning best-effort answer')
      return answer
    }
  }

  return null
}
