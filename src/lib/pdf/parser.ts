import { PDFParse } from 'pdf-parse'
import { DocumentProcessingError } from '@/lib/utils/errors'

export interface ParsedPage {
  pageNumber: number
  text: string
  charStart: number  // character offset from start of full document text
  charEnd: number
}

export interface ParsedDocument {
  fullText: string
  pages: ParsedPage[]
  pageCount: number
  metadata: {
    title?: string
    author?: string
    creationDate?: string
  }
}

export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // PDFParse is a class-based API: construct with { data }, then call methods.
  const parser = new PDFParse({ data: new Uint8Array(buffer) })

  try {
    // Get full text with per-page results.
    // pageJoiner: '' avoids inserting default page separators like "-- 1 of N --"
    const textResult = await parser.getText({ pageJoiner: '' })

    if (!textResult.text || textResult.text.trim().length === 0) {
      throw new DocumentProcessingError(
        'PDF appears to be empty or contains only images (OCR not yet supported)',
        { pageCount: textResult.total }
      )
    }

    // Build per-page data with character offsets
    const pages: ParsedPage[] = []
    let charOffset = 0

    for (const page of textResult.pages) {
      const pageText = page.text
      pages.push({
        pageNumber: page.num,
        text: pageText,
        charStart: charOffset,
        charEnd: charOffset + pageText.length,
      })
      charOffset += pageText.length
    }

    // Get document metadata (title, author, etc.)
    // InfoResult.info is the raw PDF info dictionary with fields like Title, Author, CreationDate
    let metadata: ParsedDocument['metadata'] = {}
    try {
      const infoResult = await parser.getInfo()
      const rawInfo = infoResult.info as Record<string, unknown> | undefined
      const dates = infoResult.getDateNode()
      metadata = {
        title: (rawInfo?.Title as string) ?? undefined,
        author: (rawInfo?.Author as string) ?? undefined,
        creationDate: dates.CreationDate?.toISOString() ?? undefined,
      }
    } catch {
      // Metadata extraction is non-critical — continue without it
    }

    return {
      fullText: textResult.text,
      pages,
      pageCount: textResult.total,
      metadata,
    }
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error
    throw new DocumentProcessingError(
      `Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { originalError: String(error) }
    )
  } finally {
    // Clean up parser resources
    await parser.destroy().catch(() => {})
  }
}
