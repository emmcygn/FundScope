import { createAdminClient } from '@/lib/supabase/server'
import { parsePdf, type ParsedDocument } from '@/lib/pdf/parser'
import { chunkDocument, type Chunk } from './chunker'
import { enrichChunksWithContext } from './contextual'
import { generateEmbeddings } from './embeddings'
import { DocumentProcessingError } from '@/lib/utils/errors'
import { DOC_TYPE_LABELS } from '@/lib/utils/constants'

interface IngestDocumentParams {
  documentId: string
  fundId: string
  fileName: string
  fileBuffer: Buffer
  docType: string
}

interface IngestResult {
  documentId: string
  chunksCreated: number
  pageCount: number
  processingTimeMs: number
}

/**
 * Full document ingestion pipeline.
 *
 * Flow: PDF Buffer → Parse → Chunk → Enrich → Embed → Store
 *
 * Updates the document's processing_status at each stage so the UI
 * can show progress to the user.
 */
export async function ingestDocument(params: IngestDocumentParams): Promise<IngestResult> {
  const { documentId, fundId, fileName, fileBuffer, docType } = params
  const startTime = Date.now()
  const supabase = createAdminClient()

  try {
    // Stage: Processing
    await updateDocumentStatus(supabase, documentId, 'processing')

    // 1. Parse PDF
    const parsed: ParsedDocument = await parsePdf(fileBuffer)

    await supabase
      .from('documents')
      .update({ page_count: parsed.pageCount, metadata: parsed.metadata })
      .eq('id', documentId)

    // Stage: Chunking
    await updateDocumentStatus(supabase, documentId, 'chunking')

    // 2. Chunk the document
    const chunks: Chunk[] = chunkDocument(parsed.fullText, parsed.pages)

    if (chunks.length === 0) {
      throw new DocumentProcessingError('Document produced no chunks after processing')
    }

    // Coverage gate: flag suspiciously low chunk counts.
    // A real LPA page contains ~500-800 words; with maxSize=1200 tokens we expect
    // at least 0.5 chunks per page on average. Fewer suggests incomplete extraction
    // (e.g. image-only pages, Form XObject content, or encrypted text layers).
    const minExpectedChunks = Math.max(1, Math.floor(parsed.pageCount * 0.5))
    if (chunks.length < minExpectedChunks) {
      console.warn(
        `[ingestion] Low coverage: ${chunks.length} chunks for ${parsed.pageCount}-page document ` +
        `(expected ≥ ${minExpectedChunks}). Some content may not be retrievable.`
      )
      // Store a warning in metadata but continue — partial extraction is better than nothing
      await supabase
        .from('documents')
        .update({ metadata: { ...parsed.metadata, extractionWarning: 'low_coverage' } })
        .eq('id', documentId)
    }

    // Stage: Embedding (includes contextual enrichment)
    await updateDocumentStatus(supabase, documentId, 'embedding')

    // 3. Enrich chunks with contextual summaries
    const enrichedChunks = await enrichChunksWithContext(
      chunks,
      fileName,
      DOC_TYPE_LABELS[docType] ?? docType,
      parsed.fullText.slice(0, 2000)
    )

    // 4. Generate embeddings
    const embeddings = await generateEmbeddings(
      enrichedChunks.map(c => c.text)
    )

    // 5. Store chunks with embeddings in Supabase
    const chunkRecords = enrichedChunks.map((chunk, i) => ({
      document_id: documentId,
      chunk_index: chunk.index,
      text: chunk.text,
      context_summary: (chunk.metadata.contextSummary as string) ?? null,
      embedding: JSON.stringify(embeddings[i]),
      section_number: chunk.sectionNumber,
      clause_id: chunk.clauseId,
      page_number: chunk.pageNumber,
      char_start: chunk.charStart,
      char_end: chunk.charEnd,
      metadata: { ...chunk.metadata, printed_page: chunk.printedPageNumber ?? null },
    }))

    // Insert in batches of 50 (Supabase has payload size limits)
    for (let i = 0; i < chunkRecords.length; i += 50) {
      const batch = chunkRecords.slice(i, i + 50)
      const { error } = await supabase.from('chunks').insert(batch)
      if (error) {
        throw new DocumentProcessingError(
          `Failed to store chunks (batch ${i / 50 + 1}): ${error.message}`,
          { supabaseError: error }
        )
      }
    }

    // Stage: Ready
    await updateDocumentStatus(supabase, documentId, 'ready')

    return {
      documentId,
      chunksCreated: enrichedChunks.length,
      pageCount: parsed.pageCount,
      processingTimeMs: Date.now() - startTime,
    }
  } catch (error) {
    // Mark document as errored
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await supabase
      .from('documents')
      .update({
        processing_status: 'error',
        processing_error: errorMessage,
      })
      .eq('id', documentId)

    throw error
  }
}

// Uses ReturnType to type the supabase client without importing the full type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateDocumentStatus(
  supabase: ReturnType<typeof createAdminClient>,
  documentId: string,
  status: string
): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({ processing_status: status })
    .eq('id', documentId)

  if (error) {
    console.warn(`Failed to update document status to ${status}:`, error.message)
  }
}
