import { createServerSupabaseClient } from '@/lib/supabase/server'
import { generateRiskFlags } from '@/lib/extraction/risks'
import { computeFundRiskSummary } from '@/lib/extraction/risks'
import { z } from 'zod'

export const maxDuration = 120

// POST: trigger risk analysis for a document
const postSchema = z.object({
  documentId: z.string().uuid(),
  fundId: z.string().uuid(),
})

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = postSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { documentId, fundId } = parsed.data

  // Verify ownership
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('id, name')
    .eq('id', documentId)
    .eq('fund_id', fundId)
    .single()

  if (docError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  try {
    const flags = await generateRiskFlags(documentId, fundId)

    return Response.json({
      documentId,
      documentName: doc.name,
      flagsGenerated: flags.length,
      flags: flags.map((f) => ({
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        recommendation: f.recommendation,
      })),
    })
  } catch (error) {
    console.error('Risk analysis failed:', error)
    return Response.json(
      {
        error: 'Risk analysis failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// GET: retrieve fund-level risk summary
const getSchema = z.object({
  fundId: z.string().uuid(),
})

export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const parsed = getSchema.safeParse({ fundId: searchParams.get('fundId') })

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request — fundId query parameter required' },
      { status: 400 }
    )
  }

  // Verify fund ownership via RLS
  const { data: fund, error: fundError } = await supabase
    .from('funds')
    .select('id')
    .eq('id', parsed.data.fundId)
    .single()

  if (fundError || !fund) {
    return Response.json({ error: 'Fund not found' }, { status: 404 })
  }

  try {
    const summary = await computeFundRiskSummary(parsed.data.fundId)
    return Response.json(summary)
  } catch (error) {
    console.error('Risk summary failed:', error)
    return Response.json(
      {
        error: 'Failed to compute risk summary',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
