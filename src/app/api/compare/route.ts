import { createServerSupabaseClient } from '@/lib/supabase/server'
import { buildComparisonMatrix } from '@/lib/extraction/comparison'
import { z } from 'zod'

const requestSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(10),
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

  const { documentIds } = parsed.data

  // 3. Verify user owns all documents (via fund ownership through RLS)
  const { data: docs, error: docError } = await supabase
    .from('documents')
    .select('id')
    .in('id', documentIds)

  if (docError) {
    return Response.json({ error: 'Failed to verify documents' }, { status: 500 })
  }

  // RLS filters out docs the user doesn't own — check if all requested docs were found
  const foundIds = new Set((docs ?? []).map((d) => d.id))
  const missingIds = documentIds.filter((id) => !foundIds.has(id))
  if (missingIds.length > 0) {
    return Response.json(
      { error: 'Documents not found', missingIds },
      { status: 404 }
    )
  }

  // 4. Build comparison matrix
  try {
    const matrix = await buildComparisonMatrix(documentIds)
    return Response.json(matrix)
  } catch (error) {
    console.error('Comparison failed:', error)
    return Response.json(
      {
        error: 'Comparison failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
