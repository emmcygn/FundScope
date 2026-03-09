import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params

  // Auth check — RLS ensures the user can only see their own documents
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch document metadata (RLS-protected)
  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, name, file_path, page_count')
    .eq('id', docId)
    .single()

  if (error || !doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Create a signed URL via admin client (storage operations need elevated access)
  try {
    const admin = createAdminClient()
    const { data: urlData, error: urlError } = await admin
      .storage
      .from('documents')
      .createSignedUrl(doc.file_path, 3600) // 1-hour expiry

    if (urlError || !urlData) {
      console.error('Failed to create signed URL:', urlError)
      return NextResponse.json({ error: 'Failed to create signed URL' }, { status: 500 })
    }

    return NextResponse.json({
      signedUrl: urlData.signedUrl,
      documentName: doc.name,
      pageCount: doc.page_count,
    })
  } catch (err) {
    console.error('Signed URL generation error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
