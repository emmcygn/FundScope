import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createAdminClient } from '@/lib/supabase/server'
import { MARKET_STANDARDS } from '@/lib/utils/constants'
import { ExtractionError } from '@/lib/utils/errors'
import {
  extractionResponseSchema,
  type ExtractedTerm,
  type TermType,
} from './schemas'

// Free-tier rate limit is 30k input tokens/min. Each batch of 4 chunks
// is ~2-3k tokens; a 5s delay between batches keeps us well under the cap.
const CHUNK_BATCH_SIZE = 4
const BATCH_DELAY_MS = 5000

// ── Term type display labels ────────────────────────────────────────────

const TERM_LABELS: Record<TermType, string> = {
  management_fee: 'Management Fee',
  carried_interest: 'Carried Interest',
  preferred_return: 'Preferred Return',
  hurdle_rate: 'Hurdle Rate',
  investment_period: 'Investment Period',
  fund_term: 'Fund Term',
  gp_commitment: 'GP Commitment',
  key_person: 'Key Person Provision',
  clawback: 'Clawback',
  mfn_rights: 'MFN Rights',
  no_fault_removal: 'No-Fault Removal',
  excuse_exclusion: 'Excuse/Exclusion Rights',
  distribution_waterfall: 'Distribution Waterfall',
  reporting_obligation: 'Reporting Obligation',
  fund_size_cap: 'Fund Size Cap',
  recycling_provision: 'Recycling Provision',
  co_investment_rights: 'Co-Investment Rights',
  advisory_committee: 'Advisory Committee',
  other: 'Other',
}

export { TERM_LABELS }

// ── Main extraction function ────────────────────────────────────────────

/**
 * Extracts structured PE fund terms from a document's chunks.
 *
 * Strategy:
 * 1. Fetch all chunks for the document, ordered by chunk_index
 * 2. Process chunks in batches through Claude with generateObject()
 * 3. Deduplicate across batches (keep highest confidence per term_type)
 * 4. Flag market deviations
 * 5. Store in extracted_terms table
 */
export async function extractTermsFromDocument(
  documentId: string,
  fundId: string
): Promise<ExtractedTerm[]> {
  const supabase = createAdminClient()

  // 1. Fetch all chunks for this document
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
  const allTerms: ExtractedTerm[] = []

  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE)
    const batchText = batch
      .map(
        (c: { text: string; page_number: number | null; section_number: string | null }, idx: number) =>
          `[Chunk ${i + idx + 1} | Page ${c.page_number ?? '?'} | ${c.section_number ?? 'N/A'}]\n${c.text}`
      )
      .join('\n\n---\n\n')

    try {
      const batchTerms = await extractFromBatch(batchText)
      allTerms.push(...batchTerms)
    } catch (error) {
      console.error(`Extraction failed for batch starting at chunk ${i}:`, error)
      // Continue with remaining batches — partial extraction is better than none
    }
    // Throttle to stay under free-tier rate limit (30k input tokens/min)
    if (i + CHUNK_BATCH_SIZE < chunks.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
    }
  }

  // 3. Deduplicate: keep highest confidence per term_type
  const deduplicated = deduplicateTerms(allTerms)

  // 4. Flag market deviations
  const withDeviations = deduplicated.map(flagMarketDeviation)

  // 5. Delete existing terms for this document (re-extraction), then insert new ones
  const { error: deleteError } = await supabase
    .from('extracted_terms')
    .delete()
    .eq('document_id', documentId)

  if (deleteError) {
    console.error('Failed to delete old terms:', deleteError.message)
  }

  if (withDeviations.length > 0) {
    const rows = withDeviations.map((term) => ({
      document_id: documentId,
      fund_id: fundId,
      term_type: term.term_type,
      term_value: term.term_value,
      confidence: term.confidence,
      source_clause: term.source_clause,
      source_page: term.source_page,
      source_text: term.source_text,
      is_market_standard: term.is_market_standard ?? null,
      deviation_notes: term.deviation_notes ?? null,
    }))

    const { error: insertError } = await supabase
      .from('extracted_terms')
      .insert(rows)

    if (insertError) {
      throw new ExtractionError(`Failed to store extracted terms: ${insertError.message}`, {
        documentId,
        termCount: rows.length,
      })
    }
  }

  return withDeviations
}

// ── LLM extraction for a batch of chunks ────────────────────────────────

async function extractFromBatch(batchText: string): Promise<ExtractedTerm[]> {
  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-20250514'),
    schema: extractionResponseSchema,
    maxOutputTokens: 4000,
    temperature: 0,
    experimental_telemetry: { isEnabled: true, functionId: 'extract-terms' },
    prompt: `You are a PE fund document analyst. Extract all structured fund terms from the following document chunks.

TERM TYPES TO LOOK FOR:
- management_fee: Rate, basis (committed/invested capital), step-down provisions, fee offsets
- carried_interest: Rate (typically 20%), waterfall type (European/American/hybrid), catch-up
- preferred_return: Hurdle rate percentage, compounding method
- hurdle_rate: Same as preferred_return (use preferred_return if both appear)
- investment_period: Duration in years, extension options
- fund_term: Total fund life in years, extension options
- gp_commitment: GP co-investment amount or percentage
- key_person: Named key persons, trigger events, consequences
- clawback: Whether exists, scope, guarantees
- mfn_rights: Most Favored Nation election rights
- no_fault_removal: GP removal provisions without cause
- excuse_exclusion: LP rights to be excused from investments
- distribution_waterfall: Tier structure, return of capital, carry distribution
- reporting_obligation: Reporting requirements and frequency
- fund_size_cap: Maximum fund size / hard cap
- recycling_provision: Ability to recycle returned capital
- co_investment_rights: LP co-investment opportunities
- advisory_committee: LPAC composition and powers

RULES:
1. Only extract terms that are EXPLICITLY stated in the text. Do NOT infer or fabricate.
2. If a term is ambiguous, set confidence < 0.6 and include what is actually stated.
3. Include the EXACT verbatim quote in source_text — do not paraphrase.
4. Set source_page from the chunk metadata if available.
5. If a term type does not appear in these chunks, do NOT include it.
6. For term_value, use the appropriate structure for each term type:
   - Numeric terms (fees, rates): include rate_percent, basis
   - Duration terms: include years, extension options
   - Boolean terms: include exists, description
   - Complex terms (waterfall, key person): include all relevant fields

DOCUMENT CHUNKS:
${batchText}`,
  })

  return object.terms
}

// ── Deduplication ───────────────────────────────────────────────────────

/**
 * When multiple batches extract the same term_type, keep the one with
 * the highest confidence. If confidence is tied, keep the one with a
 * source_page (better citation).
 */
function deduplicateTerms(terms: ExtractedTerm[]): ExtractedTerm[] {
  const byType = new Map<string, ExtractedTerm>()

  for (const term of terms) {
    const existing = byType.get(term.term_type)
    if (!existing) {
      byType.set(term.term_type, term)
    } else if (
      term.confidence > existing.confidence ||
      (term.confidence === existing.confidence && term.source_page !== null && existing.source_page === null)
    ) {
      byType.set(term.term_type, term)
    }
  }

  return Array.from(byType.values())
}

// ── Market deviation flagging ───────────────────────────────────────────

interface FlaggedTerm extends ExtractedTerm {
  is_market_standard?: boolean
  deviation_notes?: string
}

function flagMarketDeviation(term: ExtractedTerm): FlaggedTerm {
  const value = term.term_value as Record<string, unknown>

  // Map term types to their market standard key in MARKET_STANDARDS
  const standardsKey = getStandardsKey(term.term_type)
  if (!standardsKey) return term

  const standard = MARKET_STANDARDS[standardsKey]
  const numericValue = getNumericValue(term.term_type, value)

  if (numericValue === null) return term

  const [low, high] = standard.typical_range
  const isStandard = numericValue >= low && numericValue <= high

  // Determine severity: minor if within 25% of range, major if beyond
  let deviationLevel: string | undefined
  if (!isStandard) {
    const rangeWidth = high - low || 1 // Avoid division by zero
    const distance = numericValue < low ? low - numericValue : numericValue - high
    deviationLevel = distance / rangeWidth > 0.5 ? 'major' : 'minor'
  }

  return {
    ...term,
    is_market_standard: isStandard,
    deviation_notes: isStandard
      ? undefined
      : `${numericValue} ${standard.unit} is ${deviationLevel} deviation from market range ${low}-${high} ${standard.unit}`,
  }
}

/** Maps term_type to the key in MARKET_STANDARDS */
function getStandardsKey(
  termType: TermType
): keyof typeof MARKET_STANDARDS | null {
  const mapping: Partial<Record<TermType, keyof typeof MARKET_STANDARDS>> = {
    management_fee: 'management_fee',
    carried_interest: 'carried_interest',
    preferred_return: 'preferred_return',
    gp_commitment: 'gp_commitment',
    investment_period: 'investment_period',
    fund_term: 'fund_term',
  }
  return mapping[termType] ?? null
}

/** Extracts the primary numeric value from a term_value object for comparison */
function getNumericValue(
  termType: TermType,
  value: Record<string, unknown>
): number | null {
  switch (termType) {
    case 'management_fee':
    case 'carried_interest':
    case 'preferred_return':
    case 'gp_commitment':
      return typeof value['rate_percent'] === 'number' ? value['rate_percent'] : null
    case 'investment_period':
    case 'fund_term':
      return typeof value['years'] === 'number' ? value['years'] : null
    default:
      return null
  }
}
