import { createServerSupabaseClient } from '@/lib/supabase/server'
import { extractTermsFromDocument } from '@/lib/extraction/terms'
import { z } from 'zod'

export const maxDuration = 120 // Extraction can be slow for large documents

const requestSchema = z.object({
  documentId: z.string().uuid(),
  fundId: z.string().uuid(),
})

export async function POST(request: Request) {
  // 1. Authenticate
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Validate input
  const body = await request.json()
  const parsed = requestSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { documentId, fundId } = parsed.data

  // 3. Verify user owns this fund and document
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, fund_id, name')
    .eq('id', documentId)
    .eq('fund_id', fundId)
    .single()

  if (docError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  // 4. Run extraction
  try {
    const terms = await extractTermsFromDocument(documentId, fundId)

    return Response.json({
      documentId,
      documentName: doc.name,
      termsExtracted: terms.length,
      terms: terms.map((t) => ({
        termType: t.term_type,
        confidence: t.confidence,
        sourceClause: t.source_clause,
        sourcePage: t.source_page,
        isMarketStandard: (t as Record<string, unknown>).is_market_standard ?? null,
        deviationNotes: (t as Record<string, unknown>).deviation_notes ?? null,
      })),
    })
  } catch (error) {
    console.error('Extraction failed:', error)
    return Response.json(
      {
        error: 'Extraction failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
