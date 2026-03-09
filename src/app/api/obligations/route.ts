import { createServerSupabaseClient } from '@/lib/supabase/server'
import { extractObligationsFromDocument } from '@/lib/extraction/obligations'
import { z } from 'zod'

export const maxDuration = 120

// POST: trigger obligation extraction for a document
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
    const obligations = await extractObligationsFromDocument(documentId, fundId)

    return Response.json({
      documentId,
      documentName: doc.name,
      obligationsExtracted: obligations.length,
      obligations: obligations.map((o) => ({
        description: o.description,
        category: o.category,
        priority: o.priority,
        recurrence: o.recurrence,
        responsibleParty: o.responsible_party,
      })),
    })
  } catch (error) {
    console.error('Obligation extraction failed:', error)
    return Response.json(
      {
        error: 'Extraction failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// PATCH: update obligation status (mark as completed, waived, etc.)
const patchSchema = z.object({
  obligationId: z.string().uuid(),
  status: z.enum(['pending', 'completed', 'overdue', 'waived']),
})

export async function PATCH(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = patchSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { obligationId, status } = parsed.data

  // Update via RLS — only the user's obligations will be accessible
  // Obligations link to funds via fund_id, and RLS on funds ensures ownership
  const { data, error } = await supabase
    .from('obligations')
    .update({ status })
    .eq('id', obligationId)
    .select('id, status')
    .single()

  if (error) {
    return Response.json(
      { error: 'Failed to update obligation', message: error.message },
      { status: 500 }
    )
  }

  if (!data) {
    return Response.json({ error: 'Obligation not found' }, { status: 404 })
  }

  return Response.json({ id: data.id, status: data.status })
}
