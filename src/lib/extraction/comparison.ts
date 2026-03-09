import { createAdminClient } from '@/lib/supabase/server'
import { MARKET_STANDARDS } from '@/lib/utils/constants'
import { TERM_LABELS } from './terms'
import type {
  ExtractedTermRow,
  ComparisonRow,
  ComparisonCell,
  TermType,
} from './schemas'

// All term types in display order (most important first)
const TERM_DISPLAY_ORDER: TermType[] = [
  'management_fee',
  'carried_interest',
  'preferred_return',
  'hurdle_rate',
  'distribution_waterfall',
  'investment_period',
  'fund_term',
  'gp_commitment',
  'key_person',
  'clawback',
  'mfn_rights',
  'no_fault_removal',
  'excuse_exclusion',
  'fund_size_cap',
  'recycling_provision',
  'co_investment_rights',
  'advisory_committee',
  'reporting_obligation',
]

interface DocumentInfo {
  id: string
  name: string
}

/**
 * Builds a comparison matrix across multiple documents.
 *
 * Rows = term types, Columns = documents.
 * Each cell contains the extracted term (or null if not found)
 * plus deviation flagging against market standards.
 */
export async function buildComparisonMatrix(
  documentIds: string[]
): Promise<{ rows: ComparisonRow[]; documents: DocumentInfo[] }> {
  const supabase = createAdminClient()

  // Fetch document names
  const { data: docs, error: docError } = await supabase
    .from('documents')
    .select('id, name')
    .in('id', documentIds)

  if (docError) {
    throw new Error(`Failed to fetch documents: ${docError.message}`)
  }

  const documents: DocumentInfo[] = (docs ?? []).map((d: { id: string; name: string }) => ({
    id: d.id,
    name: d.name,
  }))

  // Fetch all extracted terms for these documents
  const { data: terms, error: termError } = await supabase
    .from('extracted_terms')
    .select('*')
    .in('document_id', documentIds)

  if (termError) {
    throw new Error(`Failed to fetch terms: ${termError.message}`)
  }

  // Group terms by document_id and term_type
  const termsByDoc = new Map<string, Map<string, ExtractedTermRow>>()
  for (const term of terms ?? []) {
    const row = term as ExtractedTermRow
    if (!termsByDoc.has(row.document_id)) {
      termsByDoc.set(row.document_id, new Map())
    }
    termsByDoc.get(row.document_id)!.set(row.term_type, row)
  }

  // Build comparison rows
  const rows: ComparisonRow[] = TERM_DISPLAY_ORDER.map((termType) => ({
    termType,
    label: TERM_LABELS[termType],
    cells: documents.map((doc): ComparisonCell => {
      const docTerms = termsByDoc.get(doc.id)
      const term = docTerms?.get(termType) ?? null

      return {
        documentId: doc.id,
        documentName: doc.name,
        term,
        isMarketStandard: term?.is_market_standard ?? null,
        deviationLevel: computeDeviationLevel(termType, term),
      }
    }),
  }))

  return { rows, documents }
}

/**
 * Computes deviation level for a single term against market standards.
 * Returns 'standard', 'minor', 'major', or null (if no standard exists or term is missing).
 */
function computeDeviationLevel(
  termType: TermType,
  term: ExtractedTermRow | null
): 'standard' | 'minor' | 'major' | null {
  if (!term) return null

  // Check if we have a market standard for this term type
  const standardsKey = getStandardsKey(termType)
  if (!standardsKey) return null

  const standard = MARKET_STANDARDS[standardsKey]
  const numericValue = getNumericValue(termType, term.term_value as Record<string, unknown>)
  if (numericValue === null) return null

  const [low, high] = standard.typical_range
  if (numericValue >= low && numericValue <= high) return 'standard'

  const rangeWidth = high - low || 1
  const distance = numericValue < low ? low - numericValue : numericValue - high
  return distance / rangeWidth > 0.5 ? 'major' : 'minor'
}

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

/**
 * Formats a term value into a human-readable summary string for display.
 */
export function formatTermValue(
  termType: TermType,
  value: Record<string, unknown>
): string {
  switch (termType) {
    case 'management_fee': {
      const rate = value['rate_percent']
      const basis = value['basis'] ?? 'committed capital'
      const stepDown = value['step_down']
      let text = `${rate}% of ${basis}`
      if (stepDown && value['step_down_rate_percent']) {
        text += ` (steps down to ${value['step_down_rate_percent']}%)`
      }
      return text
    }
    case 'carried_interest': {
      const rate = value['rate_percent']
      const waterfall = value['waterfall_type']
      return `${rate}% (${waterfall} waterfall)`
    }
    case 'preferred_return':
    case 'hurdle_rate':
      return `${value['rate_percent']}%`
    case 'investment_period':
    case 'fund_term': {
      const years = value['years']
      const ext = value['extension_option']
      let text = `${years} years`
      if (ext && value['extension_years']) {
        text += ` (+${value['extension_years']}yr ext.)`
      }
      return text
    }
    case 'gp_commitment': {
      if (value['rate_percent']) return `${value['rate_percent']}%`
      if (value['amount_millions']) return `$${value['amount_millions']}M`
      return String(value['description'] ?? 'N/A')
    }
    default: {
      // For complex/generic terms, show description or stringify
      if (typeof value['description'] === 'string') return value['description']
      if (typeof value['exists'] === 'boolean') return value['exists'] ? 'Yes' : 'No'
      return JSON.stringify(value)
    }
  }
}
