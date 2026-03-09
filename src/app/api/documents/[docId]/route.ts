import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const { docId } = await params

    // 1. Authenticate user
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Look up the document (RLS ensures user can only see their own)
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, file_path')
      .eq('id', docId)
      .single()

    if (docError || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const admin = createAdminClient()

    // 3. Delete storage file (non-fatal if missing)
    if (doc.file_path) {
      const { error: storageError } = await admin.storage
        .from('documents')
        .remove([doc.file_path])

      if (storageError) {
        console.warn('Storage delete failed (continuing):', storageError.message)
      }
    }

    // 4. Delete document record — chunks cascade via ON DELETE CASCADE
    const { error: deleteError } = await admin
      .from('documents')
      .delete()
      .eq('id', docId)

    if (deleteError) {
      return NextResponse.json(
        { error: `Failed to delete document: ${deleteError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Document delete error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
