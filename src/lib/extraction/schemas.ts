import { z } from 'zod'

// ── Term type enum (matches DB check constraint) ────────────────────────

export const TermType = z.enum([
  'management_fee',
  'carried_interest',
  'preferred_return',
  'hurdle_rate',
  'investment_period',
  'fund_term',
  'gp_commitment',
  'key_person',
  'clawback',
  'mfn_rights',
  'no_fault_removal',
  'excuse_exclusion',
  'distribution_waterfall',
  'reporting_obligation',
  'fund_size_cap',
  'recycling_provision',
  'co_investment_rights',
  'advisory_committee',
  'other',
])
export type TermType = z.infer<typeof TermType>

// ── Individual term value schemas ───────────────────────────────────────
// Each term type has a specific shape for its `term_value` jsonb column.

export const managementFeeValue = z.object({
  rate_percent: z.number().describe('Annual management fee rate as a percentage'),
  basis: z.string().describe('Basis for calculation, e.g. "committed capital", "invested capital", "net asset value"'),
  step_down: z.boolean().describe('Whether the fee steps down after investment period'),
  step_down_rate_percent: z.number().optional().describe('Post-step-down rate, if applicable'),
  step_down_trigger: z.string().optional().describe('What triggers the step-down, e.g. "end of investment period"'),
  offset_percentage: z.number().optional().describe('Percentage of portfolio company fees offset against management fee'),
})

export const carriedInterestValue = z.object({
  rate_percent: z.number().describe('Carry percentage (typically 20%)'),
  waterfall_type: z.enum(['european', 'american', 'hybrid']).describe('Distribution waterfall structure'),
  catch_up: z.boolean().describe('Whether GP has a catch-up provision'),
  catch_up_rate_percent: z.number().optional().describe('GP catch-up rate, e.g. 100% or 80%'),
})

export const preferredReturnValue = z.object({
  rate_percent: z.number().describe('Annual preferred return / hurdle rate'),
  compounding: z.enum(['simple', 'compound', 'unspecified']).describe('How the preferred return compounds'),
})

export const investmentPeriodValue = z.object({
  years: z.number().describe('Length of investment period in years'),
  extension_option: z.boolean().describe('Whether the GP can extend'),
  extension_years: z.number().optional().describe('Maximum extension length'),
  extension_approval: z.string().optional().describe('Who must approve extension, e.g. "LPAC", "majority LPs"'),
})

export const fundTermValue = z.object({
  years: z.number().describe('Total fund term in years'),
  extension_option: z.boolean().describe('Whether the GP can extend'),
  extension_years: z.number().optional().describe('Maximum total extension'),
})

export const gpCommitmentValue = z.object({
  rate_percent: z.number().optional().describe('GP commitment as % of total fund'),
  amount_millions: z.number().optional().describe('GP commitment in millions (currency per fund)'),
})

export const keyPersonValue = z.object({
  named_persons: z.array(z.string()).describe('Names of key persons'),
  trigger: z.string().describe('What constitutes a key person event'),
  consequence: z.string().describe('What happens on a key person event, e.g. "suspension of investment period"'),
})

export const clawbackValue = z.object({
  exists: z.boolean().describe('Whether a clawback provision exists'),
  scope: z.string().optional().describe('Scope of clawback, e.g. "net of taxes", "gross"'),
  guarantee: z.string().optional().describe('Whether backed by personal guarantee or escrow'),
})

export const distributionWaterfallValue = z.object({
  type: z.enum(['european', 'american', 'hybrid']).describe('Waterfall structure'),
  tiers: z.array(z.string()).describe('Description of each tier in the waterfall'),
})

// Generic value for simpler terms
export const genericTermValue = z.object({
  description: z.string().describe('Description of the term or provision'),
  exists: z.boolean().describe('Whether this provision exists in the document'),
  details: z.string().optional().describe('Additional details or conditions'),
})

// ── Extracted term (single item from LLM) ───────────────────────────────

export const extractedTermSchema = z.object({
  term_type: TermType,
  term_value: z.record(z.string(), z.unknown()).describe('Structured value — shape depends on term_type'),
  confidence: z.number().min(0).max(1).describe('How confident the extraction is (1 = explicitly stated, <0.6 = inferred/ambiguous)'),
  source_clause: z.string().nullable().describe('Clause or section reference, e.g. "Section 4.2(a)"'),
  source_page: z.number().nullable().describe('Page number where this term appears'),
  source_text: z.string().describe('Verbatim quote from the document supporting this extraction'),
})

export type ExtractedTerm = z.infer<typeof extractedTermSchema>

// ── Batch extraction response (what the LLM returns per chunk batch) ────

export const extractionResponseSchema = z.object({
  terms: z.array(extractedTermSchema),
})

export type ExtractionResponse = z.infer<typeof extractionResponseSchema>

// ── DB row type (what we store in extracted_terms table) ────────────────

export interface ExtractedTermRow {
  id: string
  document_id: string
  fund_id: string
  term_type: TermType
  term_value: Record<string, unknown>
  confidence: number
  source_clause: string | null
  source_page: number | null
  source_text: string | null
  is_market_standard: boolean | null
  deviation_notes: string | null
  created_at: string
}

// ── Obligation types (matches DB schema) ────────────────────────────────

export const ResponsibleParty = z.enum([
  'gp', 'lp', 'administrator', 'auditor', 'legal_counsel', 'other',
])
export type ResponsibleParty = z.infer<typeof ResponsibleParty>

export const Recurrence = z.enum([
  'one_time', 'quarterly', 'semi_annually', 'annually', 'per_event', 'ongoing',
])
export type Recurrence = z.infer<typeof Recurrence>

export const ObligationCategory = z.enum([
  'reporting', 'capital_call', 'distribution', 'consent',
  'mfn_election', 'key_person', 'annual_meeting', 'tax',
  'regulatory', 'notification', 'other',
])
export type ObligationCategory = z.infer<typeof ObligationCategory>

export const ObligationPriority = z.enum(['critical', 'high', 'medium', 'low'])
export type ObligationPriority = z.infer<typeof ObligationPriority>

export const ObligationStatus = z.enum(['pending', 'completed', 'overdue', 'waived'])
export type ObligationStatus = z.infer<typeof ObligationStatus>

export const extractedObligationSchema = z.object({
  description: z.string().describe('Clear description of the obligation'),
  responsible_party: ResponsibleParty,
  due_description: z.string().nullable().describe('Human-readable due date description, e.g. "Within 90 days of fiscal year end"'),
  recurrence: Recurrence,
  trigger_event: z.string().nullable().describe('Event that triggers this obligation, if any'),
  category: ObligationCategory,
  priority: ObligationPriority,
  source_clause: z.string().nullable().describe('Clause reference, e.g. "Section 8.1"'),
  source_page: z.number().nullable().describe('Page number'),
  source_text: z.string().describe('Verbatim quote from the document'),
})

export type ExtractedObligation = z.infer<typeof extractedObligationSchema>

export const obligationExtractionResponseSchema = z.object({
  obligations: z.array(extractedObligationSchema),
})

export interface ObligationRow {
  id: string
  fund_id: string
  document_id: string
  description: string
  responsible_party: ResponsibleParty | null
  due_date: string | null
  due_description: string | null
  recurrence: Recurrence | null
  trigger_event: string | null
  category: ObligationCategory | null
  priority: ObligationPriority
  status: ObligationStatus
  source_clause: string | null
  source_page: number | null
  source_text: string | null
  created_at: string
  updated_at: string
}

// ── Risk flag types (matches DB schema) ─────────────────────────────────

export const RiskCategory = z.enum([
  'lp_unfriendly', 'unusual_fee', 'broad_gp_discretion', 'weak_governance',
  'missing_clause', 'non_standard_term', 'regulatory_risk', 'conflict_of_interest',
  'ambiguous_language', 'other',
])
export type RiskCategory = z.infer<typeof RiskCategory>

export const RiskSeverity = z.enum(['critical', 'high', 'medium', 'low'])
export type RiskSeverity = z.infer<typeof RiskSeverity>

export const extractedRiskFlagSchema = z.object({
  category: RiskCategory,
  severity: RiskSeverity,
  title: z.string().describe('Short title for the risk flag'),
  description: z.string().describe('Detailed explanation of the risk'),
  recommendation: z.string().nullable().describe('Suggested action or negotiation point'),
  source_clause: z.string().nullable().describe('Clause reference'),
  source_page: z.number().nullable().describe('Page number'),
  source_text: z.string().describe('Verbatim quote from the document'),
})

export type ExtractedRiskFlag = z.infer<typeof extractedRiskFlagSchema>

export const riskExtractionResponseSchema = z.object({
  risk_flags: z.array(extractedRiskFlagSchema),
})

export interface RiskFlagRow {
  id: string
  document_id: string
  fund_id: string
  chunk_id: string | null
  category: RiskCategory
  severity: RiskSeverity
  title: string
  description: string
  recommendation: string | null
  confidence_score: number
  source_clause: string | null
  source_page: number | null
  source_text: string | null
  bounding_rect: Record<string, unknown> | null
  created_at: string
}

// ── Risk dashboard aggregate types ──────────────────────────────────────

export interface FundRiskSummary {
  fundId: string
  overallScore: number // 0-100, higher = riskier
  totalFlags: number
  bySeverity: Record<string, number>
  byCategory: Record<string, number>
  topRisks: RiskFlagRow[]
}

// ── Comparison types ────────────────────────────────────────────────────

export interface ComparisonCell {
  documentId: string
  documentName: string
  term: ExtractedTermRow | null
  isMarketStandard: boolean | null
  deviationLevel: 'standard' | 'minor' | 'major' | null
}

export interface ComparisonRow {
  termType: TermType
  label: string
  cells: ComparisonCell[]
}
