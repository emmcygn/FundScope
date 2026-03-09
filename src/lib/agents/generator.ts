import { streamText, generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import type { SearchResult } from '@/lib/rag/search'
import type { ModelMessage } from 'ai'

/** Formats search results into a numbered context block for the LLM prompt. */
export function formatContext(chunks: SearchResult[]): string {
  return chunks
    .map(
      (r, i) =>
        `[Source ${i + 1} | Page ${r.pageNumber ?? '?'} | ${r.sectionNumber ?? 'N/A'}]\n${r.text}`
    )
    .join('\n\n---\n\n')
}

/**
 * Strips the "[Context: ...]\n\n" prefix that contextual enrichment prepends
 * before embedding. Returns the raw document text for display purposes.
 */
function stripContextPrefix(text: string): string {
  // Prefix format: "[Context: <summary>]\n\n<original text>"
  const match = text.match(/^\[Context:[^\]]*\]\n\n([\s\S]*)$/m)
  return match?.[1]?.trim() ?? text.trim()
}

/**
 * Fixes common UTF-8-decoded-as-Latin-1 artifacts that appear when a PDF's
 * text encoding is misidentified. The most common patterns are smart quotes
 * and dashes whose UTF-8 byte sequences (E2 80 xx) get decoded as Latin-1,
 * producing sequences like â€" (em-dash), â€™ (right single quote), etc.
 */
function normalizeEncodingArtifacts(text: string): string {
  return text
    .replace(/\u00e2\u0080\u0094/g, '\u2014') // â€" → em-dash
    .replace(/\u00e2\u0080\u0093/g, '\u2013') // â€" → en-dash
    .replace(/\u00e2\u0080\u0099/g, '\u2019') // â€™ → right single quote
    .replace(/\u00e2\u0080\u0098/g, '\u2018') // â€˜ → left single quote
    .replace(/\u00e2\u0080\u009c/g, '\u201c') // â€œ → left double quote
    .replace(/\u00e2\u0080\u009d/g, '\u201d') // â€  → right double quote
    .replace(/\u00e2\u0080\u00a2/g, '\u2022') // â€¢ → bullet
    .replace(/\u00c2\u00a0/g, ' ')            // Â  → non-breaking space → regular space
}

/** Builds citation metadata for the response. Uses original text (no prefix) for display. */
export function buildCitations(chunks: SearchResult[]) {
  return chunks.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    pageNumber: r.pageNumber,                                    // PDF internal — used for navigation
    printedPage: (r.metadata?.printed_page as number | null) ?? null, // footer number — shown to user
    sectionNumber: r.sectionNumber,
    text: normalizeEncodingArtifacts(stripContextPrefix(r.text)).slice(0, 200),
  }))
}

function buildSystemPrompt(context: string, isRetry: boolean): string {
  const stricterInstructions = isRetry
    ? `\nSTRICTER RULES (this is a retry after hallucination was detected):
- Do NOT add any information not explicitly stated in the context
- If you are unsure about a detail, say "the document does not specify" rather than guessing
- Only include claims you can directly quote from the context
- Reduce the scope of your answer to only what is clearly supported\n`
    : ''

  return `You are FundScope, an AI legal analyst specializing in private equity fund documentation. You help legal professionals analyze LPAs, side letters, term sheets, and other fund formation documents.

CRITICAL RULES:
1. ONLY answer based on the provided document context. If the context doesn't contain the answer, say "I don't have enough information in the uploaded documents to answer this question."
2. ALWAYS cite your sources using [Source N] notation that corresponds to the provided context sections.
3. Be precise about legal terms — never paraphrase in a way that changes legal meaning.
4. When discussing monetary terms, include the exact figures and the basis (e.g., "2% of committed capital" not just "2%").
5. Flag any ambiguities or potential risks you notice in the clauses you reference.
6. Use professional but accessible language — the user may be a lawyer or a fund manager.
${stricterInstructions}
${context ? `\nRELEVANT DOCUMENT CONTEXT:\n\n${context}` : '\nNo documents have been uploaded to this fund yet. Ask the user to upload fund documents first.'}`
}

/**
 * Generates a streaming response using Claude Sonnet with the relevant context.
 * Returns the streamText result so the caller can convert it to a streaming response.
 */
export function generateStreamingAnswer(
  messages: ModelMessage[],
  context: string,
  isRetry: boolean = false
) {
  return streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: buildSystemPrompt(context, isRetry),
    messages,
    maxOutputTokens: 2000,
    temperature: 0.1,
    experimental_telemetry: { isEnabled: true, functionId: 'generate-streaming-answer' },
  })
}

/**
 * Generates a non-streaming answer for use in the hallucination check loop.
 * We need the full text to run it through the checker before sending to the user.
 */
export async function generateFullAnswer(
  messages: ModelMessage[],
  context: string,
  isRetry: boolean = false
): Promise<string> {
  const result = await generateText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: buildSystemPrompt(context, isRetry),
    messages,
    maxOutputTokens: 2000,
    temperature: 0.1,
    experimental_telemetry: { isEnabled: true, functionId: 'generate-full-answer' },
  })

  return result.text
}
