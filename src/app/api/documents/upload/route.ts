import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'
import { ingestDocument } from '@/lib/rag/pipeline'
import { v4 as uuidv4 } from 'uuid'

export const maxDuration = 300 // 5 minutes for long documents

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 2. Parse the multipart form data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const fundId = formData.get('fundId') as string | null
    const docType = formData.get('docType') as string | null

    if (!file || !fundId || !docType) {
      return NextResponse.json(
        { error: 'Missing required fields: file, fundId, docType' },
        { status: 400 }
      )
    }

    // 3. Validate file
    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: 'Only PDF files are supported' },
        { status: 400 }
      )
    }

    const maxSize = 50 * 1024 * 1024 // 50MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size exceeds 50MB limit' },
        { status: 400 }
      )
    }

    // 4. Verify fund ownership (RLS ensures user can only see their own funds)
    const { data: fund, error: fundError } = await supabase
      .from('funds')
      .select('id')
      .eq('id', fundId)
      .single()

    if (fundError || !fund) {
      return NextResponse.json(
        { error: 'Fund not found or access denied' },
        { status: 404 }
      )
    }

    // 5. Upload file to Supabase Storage
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const storagePath = `${user.id}/${fundId}/${uuidv4()}.pdf`

    const adminClient = createAdminClient()
    const { error: uploadError } = await adminClient.storage
      .from('documents')
      .upload(storagePath, fileBuffer, {
        contentType: 'application/pdf',
      })

    if (uploadError) {
      return NextResponse.json(
        { error: `File upload failed: ${uploadError.message}` },
        { status: 500 }
      )
    }

    // 6. Create document record
    const documentId = uuidv4()
    const { error: insertError } = await adminClient
      .from('documents')
      .insert({
        id: documentId,
        fund_id: fundId,
        user_id: user.id,
        name: file.name,
        file_path: storagePath,
        file_size_bytes: file.size,
        doc_type: docType,
        processing_status: 'pending',
      })

    if (insertError) {
      return NextResponse.json(
        { error: `Failed to create document record: ${insertError.message}` },
        { status: 500 }
      )
    }

    // 7. Trigger ingestion (async — don't await the full pipeline)
    // In production you'd use a queue. For the demo, we fire-and-forget.
    ingestDocument({
      documentId,
      fundId,
      fileName: file.name,
      fileBuffer,
      docType,
    }).catch((error) => {
      console.error(`Ingestion failed for document ${documentId}:`, error)
    })

    // 8. Return immediately with document ID (processing happens in background)
    return NextResponse.json({
      documentId,
      status: 'processing',
      message: 'Document uploaded successfully. Processing has started.',
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
