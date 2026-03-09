import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createAdminClient } from '@/lib/supabase/server'
import { MARKET_STANDARDS } from '@/lib/utils/constants'
import { ExtractionError } from '@/lib/utils/errors'
import {
  riskExtractionResponseSchema,
  type ExtractedRiskFlag,
  type ExtractedTermRow,
  type RiskFlagRow,
  type FundRiskSummary,
  type RiskSeverity,
} from './schemas'

// Free-tier rate limit is 30k input tokens/min. Each batch of 4 chunks
// is ~2-3k tokens; a 5s delay between batches keeps us well under the cap.
const CHUNK_BATCH_SIZE = 4
const BATCH_DELAY_MS = 5000

// Severity weights for aggregate scoring
const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
}

/**
 * Generates risk flags for a document by:
 * 1. Analyzing extracted terms against market standards (automated)
 * 2. Scanning document chunks for risk patterns via LLM
 * 3. Storing all flags in the risk_flags table
 */
export async function generateRiskFlags(
  documentId: string,
  fundId: string
): Promise<ExtractedRiskFlag[]> {
  const supabase = createAdminClient()

  // 1. Generate automated risk flags from extracted terms
  const termFlags = await generateTermBasedFlags(documentId, fundId)

  // 2. Fetch chunks for LLM-based risk scanning
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

  // 3. LLM-based risk scanning in batches
  const llmFlags: ExtractedRiskFlag[] = []

  if (chunks && chunks.length > 0) {
    for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
      const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE)
      const batchText = batch
        .map(
          (c: { text: string; page_number: number | null; section_number: string | null }, idx: number) =>
            `[Chunk ${i + idx + 1} | Page ${c.page_number ?? '?'} | ${c.section_number ?? 'N/A'}]\n${c.text}`
        )
        .join('\n\n---\n\n')

      try {
        const batchFlags = await scanForRisks(batchText)
        llmFlags.push(...batchFlags)
      } catch (error) {
        console.error(`Risk scanning failed for batch at chunk ${i}:`, error)
        // Continue with remaining batches
      }
      // Throttle to stay under free-tier rate limit (30k input tokens/min)
      if (i + CHUNK_BATCH_SIZE < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
      }
    }
  }

  // 4. Combine and deduplicate
  const allFlags = deduplicateFlags([...termFlags, ...llmFlags])

  // 5. Delete existing flags, then insert
  const { error: deleteError } = await supabase
    .from('risk_flags')
    .delete()
    .eq('document_id', documentId)

  if (deleteError) {
    console.error('Failed to delete old risk flags:', deleteError.message)
  }

  if (allFlags.length > 0) {
    const rows = allFlags.map((f) => ({
      document_id: documentId,
      fund_id: fundId,
      category: f.category,
      severity: f.severity,
      title: f.title,
      description: f.description,
      recommendation: f.recommendation,
      confidence_score: 0.85, // Default for LLM-generated flags
      source_clause: f.source_clause,
      source_page: f.source_page,
      source_text: f.source_text,
    }))

    const { error: insertError } = await supabase
      .from('risk_flags')
      .insert(rows)

    if (insertError) {
      throw new ExtractionError(`Failed to store risk flags: ${insertError.message}`, {
        documentId,
        count: rows.length,
      })
    }
  }

  return allFlags
}

// ── Automated term-based risk flags ─────────────────────────────────────

/**
 * Checks extracted terms against market standards and generates risk flags
 * for any deviations. This is deterministic (no LLM needed).
 */
async function generateTermBasedFlags(
  documentId: string,
  fundId: string
): Promise<ExtractedRiskFlag[]> {
  const supabase = createAdminClient()

  const { data: terms, error } = await supabase
    .from('extracted_terms')
    .select('*')
    .eq('document_id', documentId)

  if (error || !terms) return []

  const flags: ExtractedRiskFlag[] = []

  for (const term of terms as ExtractedTermRow[]) {
    if (term.is_market_standard === false && term.deviation_notes) {
      flags.push({
        category: 'non_standard_term',
        severity: determineSeverity(term),
        title: `Non-standard ${term.term_type.replace(/_/g, ' ')}`,
        description: term.deviation_notes,
        recommendation: `Review ${term.term_type.replace(/_/g, ' ')} — consider negotiating toward market standard range.`,
        source_clause: term.source_clause,
        source_page: term.source_page,
        source_text: term.source_text ?? '',
      })
    }
  }

  // Check for missing critical terms
  const extractedTypes = new Set(terms.map((t: ExtractedTermRow) => t.term_type))
  const criticalTerms: Array<{ type: string; label: string }> = [
    { type: 'clawback', label: 'Clawback provision' },
    { type: 'key_person', label: 'Key person provision' },
    { type: 'no_fault_removal', label: 'No-fault GP removal rights' },
  ]

  for (const ct of criticalTerms) {
    if (!extractedTypes.has(ct.type)) {
      flags.push({
        category: 'missing_clause',
        severity: 'high',
        title: `Missing ${ct.label}`,
        description: `No ${ct.label.toLowerCase()} was found in the document. This is an important LP protection that is typically included in fund documents.`,
        recommendation: `Request the inclusion of a ${ct.label.toLowerCase()} in the final agreement.`,
        source_clause: null,
        source_page: null,
        source_text: '',
      })
    }
  }

  return flags
}

/** Determines severity based on how far a term deviates from market standard */
function determineSeverity(term: ExtractedTermRow): RiskSeverity {
  const value = term.term_value as Record<string, unknown>
  const standardsKey = getStandardsKey(term.term_type)
  if (!standardsKey) return 'medium'

  const standard = MARKET_STANDARDS[standardsKey]
  const numericValue = getNumericValue(term.term_type, value)
  if (numericValue === null) return 'medium'

  const [low, high] = standard.typical_range
  const rangeWidth = high - low || 1
  const distance = numericValue < low ? low - numericValue : numericValue - high

  if (distance / rangeWidth > 1.0) return 'critical'
  if (distance / rangeWidth > 0.5) return 'high'
  return 'medium'
}

// ── LLM-based risk scanning ─────────────────────────────────────────────

async function scanForRisks(batchText: string): Promise<ExtractedRiskFlag[]> {
  const { object } = await generateObject({
    model: anthropic('claude-sonnet-4-20250514'),
    schema: riskExtractionResponseSchema,
    maxOutputTokens: 4000,
    temperature: 0,
    experimental_telemetry: { isEnabled: true, functionId: 'scan-risks' },
    prompt: `You are a PE fund legal risk analyst. Scan the following document chunks for potential risks, red flags, and provisions that may be unfavorable to limited partners (LPs).

RISK CATEGORIES:
- lp_unfriendly: Provisions that significantly disadvantage LPs (e.g., no LP consent for key decisions)
- unusual_fee: Fee structures that deviate from market norms (e.g., hidden fees, unusual expense pass-throughs)
- broad_gp_discretion: Language giving the GP unusually broad or unchecked authority
- weak_governance: Inadequate LP protections, weak LPAC powers, limited information rights
- missing_clause: Notable absence of standard protections (flag only if you see evidence it should be there)
- non_standard_term: Terms that differ significantly from typical PE fund structures
- regulatory_risk: Potential regulatory or compliance concerns
- conflict_of_interest: GP conflicts of interest or related-party transaction risks
- ambiguous_language: Vague or unclear provisions that could be interpreted against LP interests

SEVERITY GUIDELINES:
- critical: Could result in material financial loss or complete loss of LP rights
- high: Significantly disadvantages LPs or departs materially from market norms
- medium: Moderately unusual or somewhat LP-unfriendly
- low: Minor concerns or areas worth noting

RULES:
1. Only flag genuine risks — do NOT flag standard, market-norm provisions
2. Include specific verbatim quotes in source_text
3. Provide actionable recommendations where possible
4. If no risks are found in a chunk, return an empty array
5. Focus on substance over form — flag real risks, not stylistic preferences

DOCUMENT CHUNKS:
${batchText}`,
  })

  return object.risk_flags
}

// ── Deduplication ───────────────────────────────────────────────────────

function deduplicateFlags(flags: ExtractedRiskFlag[]): ExtractedRiskFlag[] {
  const seen = new Map<string, ExtractedRiskFlag>()

  for (const flag of flags) {
    const key = `${flag.category}:${flag.title.toLowerCase().slice(0, 50)}`
    if (!seen.has(key)) {
      seen.set(key, flag)
    } else {
      // Keep higher severity
      const existing = seen.get(key)!
      const severityOrder = ['low', 'medium', 'high', 'critical']
      if (severityOrder.indexOf(flag.severity) > severityOrder.indexOf(existing.severity)) {
        seen.set(key, flag)
      }
    }
  }

  return Array.from(seen.values())
}

// ── Risk score aggregation ──────────────────────────────────────────────

/**
 * Computes an aggregate risk summary for a fund across all its documents.
 * Score is 0-100: 0 = no risk flags, 100 = maximum risk.
 */
export async function computeFundRiskSummary(
  fundId: string
): Promise<FundRiskSummary> {
  const supabase = createAdminClient()

  const { data: flags, error } = await supabase
    .from('risk_flags')
    .select('*')
    .eq('fund_id', fundId)
    .order('severity', { ascending: false })

  if (error) {
    throw new ExtractionError(`Failed to fetch risk flags: ${error.message}`, { fundId })
  }

  const riskFlags = (flags ?? []) as RiskFlagRow[]

  // Count by severity
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  const byCategory: Record<string, number> = {}

  let weightedScore = 0

  for (const flag of riskFlags) {
    bySeverity[flag.severity] = (bySeverity[flag.severity] ?? 0) + 1
    byCategory[flag.category] = (byCategory[flag.category] ?? 0) + 1
    weightedScore += SEVERITY_WEIGHTS[flag.severity] ?? 0
  }

  // Normalize to 0-100 (cap at 100)
  const overallScore = Math.min(100, weightedScore)

  return {
    fundId,
    overallScore,
    totalFlags: riskFlags.length,
    bySeverity,
    byCategory,
    topRisks: riskFlags.slice(0, 5), // Top 5 risks by severity
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────

function getStandardsKey(
  termType: string
): keyof typeof MARKET_STANDARDS | null {
  const mapping: Record<string, keyof typeof MARKET_STANDARDS> = {
    management_fee: 'management_fee',
    carried_interest: 'carried_interest',
    preferred_return: 'preferred_return',
    gp_commitment: 'gp_commitment',
    investment_period: 'investment_period',
    fund_term: 'fund_term',
  }
  return mapping[termType] ?? null
}

function getNumericValue(
  termType: string,
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
