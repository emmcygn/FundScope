import path from 'path'
import { DocumentProcessingError } from '@/lib/utils/errors'

export interface ParsedPage {
  pageNumber: number
  /** Printed/footer page number detected from the page text, if any. Null for
   *  cover pages, TOC, and other front matter that lack a visible page number. */
  printedPageNumber: number | null
  text: string
  charStart: number
  charEnd: number
}

/**
 * Attempts to extract the printed (footer/header) page number from page text.
 *
 * Legal PDFs often include a running page number in the header or footer that
 * differs from the PDF's internal 1-based page index. We look for it in the
 * first 3 and last 3 non-empty lines of the extracted text using four patterns:
 *
 *  1. A line that is only digits            →  "7"
 *  2. "Page N" prefix                       →  "Page 7"
 *  3. Dash-wrapped center number            →  "– 7 –" / "- 7 -"
 *  4. Line ending with 2+ spaces then N     →  "Last Updated: July 2020  7"
 *
 * The candidate is validated against pdfPageIndex: the printed page number must
 * be within MAX_PAGE_OFFSET of the PDF index to reject false positives such as
 * TOC entry numbers (e.g. "...Notices  68" on page 3) and footnote markers
 * (e.g. a standalone "23" on a signature page at index 73).
 *
 * Returns null if no reliable printed number is found (falls back to PDF index).
 */
const MAX_PAGE_OFFSET = 20 // maximum expected front-matter pages

function detectPrintedPageNumber(pageText: string, pdfPageIndex: number): number | null {
  const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  if (lines.length === 0) return null

  const candidates = [...lines.slice(0, 3), ...lines.slice(-3)]

  for (const line of candidates) {
    // Pattern 1: line is purely a page number, e.g. "7"
    if (/^\d+$/.test(line)) {
      const n = parseInt(line, 10)
      if (n >= 1 && n <= 999 && Math.abs(pdfPageIndex - n) <= MAX_PAGE_OFFSET) return n
    }

    // Pattern 2: "Page 7" / "PAGE 7"
    const pageWord = /^page\s+(\d+)$/i.exec(line)
    if (pageWord) {
      const n = parseInt(pageWord[1]!, 10)
      if (n >= 1 && n <= 999 && Math.abs(pdfPageIndex - n) <= MAX_PAGE_OFFSET) return n
    }

    // Pattern 3: "- 7 -" or "– 7 –"
    const dashes = /^[-–]\s*(\d+)\s*[-–]$/.exec(line)
    if (dashes) {
      const n = parseInt(dashes[1]!, 10)
      if (n >= 1 && n <= 999 && Math.abs(pdfPageIndex - n) <= MAX_PAGE_OFFSET) return n
    }

    // Pattern 4: line ends with 2+ spaces then a number (min 10 chars before)
    // e.g. "Last Updated: July 2020  7" or "CONFIDENTIAL  42"
    const trailing = /^.{10,}\s{2,}(\d+)\s*$/.exec(line)
    if (trailing) {
      const n = parseInt(trailing[1]!, 10)
      if (n >= 1 && n <= 999 && Math.abs(pdfPageIndex - n) <= MAX_PAGE_OFFSET) return n
    }
  }

  return null
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

/**
 * Extracts text from a PDF buffer using pdfjs-dist.
 *
 * Why pdfjs over pdf-parse: pdfjs is the same engine that renders the PDF
 * viewer, so whatever it can display it can also extract. pdf-parse uses an
 * older PDF.js fork that misses text in many modern PDFs (custom fonts,
 * complex layouts, encrypted-then-decrypted documents, etc.).
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // Dynamic import: pdfjs-dist is ESM-only (no CJS build) so we import
  // lazily to avoid module-initialisation issues in Next.js server context.
  // Use the legacy build — the standard build requires DOMMatrix and other
  // browser globals that don't exist in Node.js. The legacy build polyfills them.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  // Point workerSrc to the locally installed worker file.
  // Setting '' causes pdfjs to fetch the worker from the CDN (unpkg.com) at
  // whatever version it considers "latest", which won't match our installed
  // version. Using the local file path avoids the version mismatch error.
  // path.resolve(process.cwd(), ...) works both locally and on Vercel where
  // next.js bundles the file into the serverless function payload.
  // Build a properly-encoded file:// URL so paths with spaces (e.g. "LegalTech Demo")
  // don't silently corrupt the URL and cause pdfjs to fall back to a CDN worker
  // at a different version (the pdf-parse nested pdfjs-dist 5.4.296).
  const workerAbsPath = path.resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(`file://${workerAbsPath.replace(/\\/g, '/')}`).href

  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      verbosity: 0, // suppress pdfjs console warnings
    })
    const pdf = await loadingTask.promise
    const numPages: number = pdf.numPages

    if (numPages === 0) {
      throw new DocumentProcessingError('PDF has no pages')
    }

    const pages: ParsedPage[] = []
    let fullText = ''

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i)
      // includeMarkedContent: captures text inside Tagged PDF marked-content sequences.
      // disableCombineTextItems: false keeps word-level items so we can detect line breaks.
      const content = await page.getTextContent({ includeMarkedContent: true })

      // Reconstruct readable text by detecting line breaks from y-position changes.
      // pdfjs returns individual text items (words/spans) with 2D transform matrices;
      // item.transform[5] is the y-coordinate. A y-jump > 2pt means a new line.
      // MarkedContent items (type='beginMarkedContent' etc.) have no str — skip them.
      type TextItem = { str: string; transform: number[]; type?: string }
      const items = (content.items as TextItem[]).filter(item => item.str !== undefined)

      let pageText = ''
      let lastY: number | null = null

      for (const item of items) {
        const y: number = item.transform[5] ?? 0
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          pageText += '\n'
        } else if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
          pageText += ' '
        }
        pageText += item.str
        lastY = y
      }

      const charStart = fullText.length
      fullText += pageText + '\n'

      pages.push({
        pageNumber: i,
        printedPageNumber: detectPrintedPageNumber(pageText, i),
        text: pageText,
        charStart,
        charEnd: fullText.length,
      })
    }

    if (fullText.trim().length === 0) {
      throw new DocumentProcessingError(
        'PDF appears to be empty or image-only (OCR not yet supported)',
        { pageCount: numPages }
      )
    }

    // Extract document metadata (best-effort)
    let metadata: ParsedDocument['metadata'] = {}
    try {
      const meta = await pdf.getMetadata()
      const info = meta?.info as Record<string, unknown> | undefined
      metadata = {
        title: (info?.Title as string) ?? undefined,
        author: (info?.Author as string) ?? undefined,
        creationDate: (info?.CreationDate as string) ?? undefined,
      }
    } catch {
      // Non-critical — proceed without metadata
    }

    return { fullText, pages, pageCount: numPages, metadata }
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error
    throw new DocumentProcessingError(
      `Failed to parse PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { originalError: String(error) }
    )
  }
}
