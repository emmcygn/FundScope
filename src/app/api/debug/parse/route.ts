/**
 * Debug endpoint: downloads the stored PDF and runs pdf-parse on it,
 * returning the extracted text per page. Diagnoses whether pdf-parse
 * is missing pages.
 *
 * Usage: GET /api/debug/parse?docId=<document_uuid>
 * DELETE before production deploy.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parsePdf } from '@/lib/pdf/parser'

export async function GET(request: NextRequest) {
  const docId = new URL(request.url).searchParams.get('docId') ?? ''
  if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 })

  const admin = createAdminClient()

  // Get document record
  const { data: doc, error: docErr } = await admin
    .from('documents')
    .select('id, name, file_path')
    .eq('id', docId)
    .single()

  if (docErr || !doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Download from storage
  const { data: fileData, error: downloadErr } = await admin.storage
    .from('documents')
    .download(doc.file_path)

  if (downloadErr || !fileData) {
    return NextResponse.json({ error: `Download failed: ${downloadErr?.message}` }, { status: 500 })
  }

  // Parse
  const buffer = Buffer.from(await fileData.arrayBuffer())
  let parsed
  try {
    parsed = await parsePdf(buffer)
  } catch (e) {
    return NextResponse.json({ error: `Parse failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 })
  }

  return NextResponse.json({
    documentName: doc.name,
    pageCount: parsed.pageCount,
    fullTextLength: parsed.fullText.length,
    pages: parsed.pages.map(p => ({
      pageNumber: p.pageNumber,
      printedPageNumber: p.printedPageNumber,
      charCount: p.text.length,
      textPreview: p.text.slice(0, 300),
    })),
  })
}
