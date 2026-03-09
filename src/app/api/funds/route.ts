import { createServerSupabaseClient } from '@/lib/supabase/server'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  manager: z.string().optional(),
  vintageYear: z.number().int().min(1990).max(2030).optional(),
  fundSizeMillions: z.number().positive().optional(),
  currency: z.string().default('USD'),
})

// GET: list user's funds
export async function GET() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: funds, error } = await supabase
    .from('funds')
    .select(`
      id,
      name,
      manager,
      vintage_year,
      fund_size_millions,
      currency,
      status,
      created_at,
      documents(count)
    `)
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ funds })
}

// POST: create a new fund
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = createSchema.safeParse(body)

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { data: fund, error } = await supabase
    .from('funds')
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      manager: parsed.data.manager ?? null,
      vintage_year: parsed.data.vintageYear ?? null,
      fund_size_millions: parsed.data.fundSizeMillions ?? null,
      currency: parsed.data.currency,
    })
    .select('id, name')
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ fund }, { status: 201 })
}
