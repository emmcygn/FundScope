import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createAdminClient } from '@/lib/supabase/server'
import { ExtractionError } from '@/lib/utils/errors'
import {
  obligationExtractionResponseSchema,
  type ExtractedObligation,
} from './schemas'

// Free-tier rate limit is 30k input tokens/min. Each batch of 4 chunks
// is ~2-3k tokens; a 5s delay between batches keeps us well under the cap.
const CHUNK_BATCH_SIZE = 4
const BATCH_DELAY_MS = 5000

/**
 * Extracts time-bound obligations from a document's chunks.
 *
 * Follows the same batch → deduplicate → store pattern as term extraction.
 * Obligations include: reporting deadlines, capital call notice periods,
 * consent requirements, MFN election windows, etc.
 */
export async function extractObligationsFromDocument(
  documentId: string,
  fundId: string
): Promise<ExtractedObligation[]> {
  const supabase = createAdminClient()

  // 1. Fetch chunks
  const { data: chunks, error: chunkError } = await supabase
    .from('chunks')
    .select('text, page_number, section_number, chunk_index')
    .eq('document_id', documentId)
    .order('chunk_index', { ascending: true })

  if (chunkError) {
    throw new ExtractionError(`Failed to fetch chunks: ${chunkError.message}`, {
      documentId,
    })
  }

  if (!chunks || chunks.length === 0) {
    throw new ExtractionError('No chunks found for document', { documentId })
  }

  // 2. Process in batches
  const allObligations: ExtractedObligation[] = []

  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE)
    const batchText = batch
      .map(
        (c: { text: string; page_number: number | null; section_number: string | null }, idx: number) =>
          `[Chunk ${i + idx + 1} | Page ${c.page_number ?? '?'} | ${c.section_number ?? 'N/A'}]\n${c.text}`
      )
      .join('\n\n---\n\n')

    try {
      const batchObligations = await extractObligationsFromBatch(batchText)
      allObligations.push(...batchObligations)
    } catch (error) {
      console.error(`Obligation extraction failed for batch at chunk ${i}:`, error)
    }
    // Throttle to stay under free-tier rate limit (30k input tokens/min)
    if (i + CHUNK_BATCH_SIZE < chunks.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
    }
  }

  // 3. Deduplicate (by description similarity — keep first occurrence)
  const deduplicated = deduplicateObligations(allObligations)

  // 4. Delete existing obligations for this document, then insert
  const { error: deleteError } = await supabase
    .from('obligations')
    .delete()
    .eq('document_id', documentId)

  if (deleteError) {
    console.error('Failed to delete old obligations:', deleteError.message)
  }

  if (deduplicated.length > 0) {
    const rows = deduplicated.map((o) => ({
      document_id: documentId,
      fund_id: fundId,
      description: o.description,
      responsible_party: o.responsible_party,
      due_description: o.due_description,
      recurrence: o.recurrence,
      trigger_event: o.trigger_event,
      category: o.category,
      priority: o.priority,
      status: 'pending' as const,
      source_clause: o.source_clause,
      source_page: o.source_page,
      source_text: o.source_text,
    }))

    const { error: insertError } = await supabase
      .from('obligations')
      .insert(rows)

    if (insertError) {
      throw new ExtractionError(`Failed to store obligations: ${insertError.message}`, {
        documentId,
        count: rows.length,
      })
    }
  }

  return deduplicated
}

// ── LLM extraction ──────────────────────────────────────────────────────

async function extractObligationsFromBatch(
  batchText: string
): Promise<ExtractedObligation[]> {
  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-20250514'),
    schema: obligationExtractionResponseSchema,
    maxOutputTokens: 4000,
    temperature: 0,
    experimental_telemetry: { isEnabled: true, functionId: 'extract-obligations' },
    prompt: `You are a PE fund document analyst specializing in obligation tracking. Extract all time-bound obligations, requirements, and commitments from the following document chunks.

OBLIGATION CATEGORIES:
- reporting: Financial reports, audit delivery, investor letters, K-1s, quarterly/annual reports
- capital_call: Capital call notice requirements, funding deadlines, default provisions
- distribution: Distribution timing, waterfall calculations, tax distributions
- consent: LP consent requirements, LPAC approval, advisory committee matters
- mfn_election: MFN election windows and notification requirements
- key_person: Key person event notifications and cure periods
- annual_meeting: Annual meeting requirements, advisory committee meetings
- tax: Tax-related filings, withholding obligations, FATCA/CRS
- regulatory: Regulatory filings, compliance requirements
- notification: General notification obligations, material event disclosures

PRIORITY GUIDELINES:
- critical: Obligations with hard legal deadlines or severe consequences for breach
- high: Important recurring requirements (quarterly reports, capital call notices)
- medium: Standard periodic obligations (annual meetings, investor updates)
- low: Best-effort or optional obligations

RULES:
1. Only extract obligations that are EXPLICITLY stated — do NOT infer implied obligations
2. Include the EXACT verbatim quote in source_text
3. For recurring obligations, identify the correct recurrence pattern
4. Set responsible_party based on who must perform the action (gp, lp, administrator, etc.)
5. If a trigger event is specified (e.g., "within 10 days of a key person event"), include it
6. If no obligations appear in a chunk, return an empty array

DOCUMENT CHUNKS:
${batchText}`,
  })

  return object.obligations
}

// ── Deduplication ───────────────────────────────────────────────────────

/**
 * Deduplicate obligations by comparing descriptions.
 * Two obligations are considered duplicates if their descriptions
 * are very similar (same category + similar wording).
 */
function deduplicateObligations(
  obligations: ExtractedObligation[]
): ExtractedObligation[] {
  const seen = new Map<string, ExtractedObligation>()

  for (const obligation of obligations) {
    // Create a dedup key from category + normalized description
    const key = `${obligation.category}:${normalizeForDedup(obligation.description)}`

    if (!seen.has(key)) {
      seen.set(key, obligation)
    }
    // Keep first occurrence (earlier in document = more authoritative)
  }

  return Array.from(seen.values())
}

/** Normalize a string for deduplication comparison */
function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) // Compare first 80 chars only
}
