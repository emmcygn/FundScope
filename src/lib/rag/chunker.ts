import { CHUNK_CONFIG } from '@/lib/utils/constants'

export interface Chunk {
  text: string
  index: number
  pageNumber: number | null
  /** Printed/footer page number from the source PDF page, if detected. */
  printedPageNumber: number | null
  sectionNumber: string | null
  clauseId: string | null
  charStart: number
  charEnd: number
  metadata: Record<string, unknown>
}

interface ChunkOptions {
  maxSize?: number
  overlap?: number
  minSize?: number
}

/**
 * Chunks a legal document using a hierarchical recursive strategy.
 *
 * The approach:
 * 1. First, try to split on section headers (ARTICLE I, Section 1.1, etc.)
 * 2. If a section is still too long, split on paragraph boundaries (\n\n)
 * 3. If a paragraph is still too long, split on sentence boundaries (. )
 * 4. Last resort: split on word boundaries
 *
 * Each chunk tracks its position in the original document so we can
 * link citations back to exact locations.
 */
export function chunkDocument(
  fullText: string,
  pages: Array<{ pageNumber: number; printedPageNumber: number | null; charStart: number; charEnd: number }>,
  options: ChunkOptions = {}
): Chunk[] {
  const maxSize = options.maxSize ?? CHUNK_CONFIG.maxSize
  const overlap = options.overlap ?? CHUNK_CONFIG.overlap
  const minSize = options.minSize ?? CHUNK_CONFIG.minSize

  // Step 1: Split on legal section headers
  const sections = splitOnSectionHeaders(fullText)

  const chunks: Chunk[] = []
  let chunkIndex = 0

  for (const section of sections) {
    // Step 2: If section is within size limit, keep it as one chunk
    const tokenEstimate = estimateTokens(section.text)

    if (tokenEstimate <= maxSize) {
      if (tokenEstimate >= minSize) {
        chunks.push(createChunk(
          section.text, chunkIndex++, section.charStart,
          section.charStart + section.text.length,
          section.sectionNumber, pages
        ))
      }
      continue
    }

    // Step 3: Section too long — split recursively
    const subChunks = recursiveSplit(
      section.text, section.charStart, maxSize, overlap, minSize,
      ['\n\n', '\n', '. ', ' ']
    )

    for (const sub of subChunks) {
      chunks.push(createChunk(
        sub.text, chunkIndex++, sub.charStart, sub.charEnd,
        section.sectionNumber, pages
      ))
    }
  }

  return chunks
}

function splitOnSectionHeaders(text: string): Array<{
  text: string
  charStart: number
  sectionNumber: string | null
}> {
  // Match common legal document section patterns:
  // 1. Keyword-prefixed: "ARTICLE I", "Section 1.1", "SCHEDULE 1", "EXHIBIT A"
  // 2. Bare numbered: "9.1 Successor Fund", "10. REMOVAL OF THE GENERAL PARTNER"
  //    Requires uppercase first word after the number to distinguish from inline text.
  //    Uses [^\n] instead of \s in char class to prevent matching across lines.
  const sectionPattern = /^(?:(?:ARTICLE|Article|SECTION|Section|SCHEDULE|Schedule|EXHIBIT|Exhibit|APPENDIX|Appendix)\s+[IVXLCDM\d]+\.?\s*[-–—:]?\s*.+|(?:\d+\.(?:\d+\.?)*)\s+[A-Z][^\n]{3,})$/gm

  const sections: Array<{ text: string; charStart: number; sectionNumber: string | null }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = sectionPattern.exec(text)) !== null) {
    // Save text before this header as a section (if non-trivial)
    if (match.index > lastIndex) {
      const prevText = text.slice(lastIndex, match.index).trim()
      if (prevText.length > 0) {
        sections.push({
          text: prevText,
          charStart: lastIndex,
          sectionNumber: extractSectionNumber(prevText),
        })
      }
    }
    lastIndex = match.index
  }

  // Remaining text after last header
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim()
    if (remaining.length > 0) {
      sections.push({
        text: remaining,
        charStart: lastIndex,
        sectionNumber: extractSectionNumber(remaining),
      })
    }
  }

  // If no sections were found, treat the whole text as one section
  if (sections.length === 0) {
    sections.push({ text: text, charStart: 0, sectionNumber: null })
  }

  return sections
}

function extractSectionNumber(text: string): string | null {
  // Only check the FIRST line of the text to avoid picking up inline cross-references
  // like "Section 6.2 (Terms and Conditions...)" that appear mid-paragraph
  const firstLine = text.split('\n')[0] ?? ''

  // Match keyword-prefixed headers: "Section 9.1", "ARTICLE IV"
  const keywordMatch = firstLine.match(/^(?:ARTICLE|Article|SECTION|Section)\s+([IVXLCDM\d]+\.?\d*)/)
  if (keywordMatch?.[1]) return keywordMatch[1]

  // Match bare numbered headers: "9.1 Successor Fund", "10. REMOVAL"
  const bareMatch = firstLine.match(/^(\d+(?:\.\d+)*\.?)\s+[A-Z]/)
  if (bareMatch?.[1]) return bareMatch[1].replace(/\.$/, '') // strip trailing dot

  return null
}

function recursiveSplit(
  text: string,
  globalCharStart: number,
  maxSize: number,
  overlap: number,
  minSize: number,
  separators: string[]
): Array<{ text: string; charStart: number; charEnd: number }> {
  if (estimateTokens(text) <= maxSize) {
    return [{ text, charStart: globalCharStart, charEnd: globalCharStart + text.length }]
  }

  const separator = separators[0]
  if (!separator) {
    // Last resort: hard split by character count
    const results: Array<{ text: string; charStart: number; charEnd: number }> = []
    const charsPerChunk = maxSize * 4 // rough chars-per-token estimate
    for (let i = 0; i < text.length; i += charsPerChunk - overlap * 4) {
      const chunk = text.slice(i, i + charsPerChunk)
      results.push({
        text: chunk,
        charStart: globalCharStart + i,
        charEnd: globalCharStart + i + chunk.length,
      })
    }
    return results
  }

  const parts = text.split(separator)
  const results: Array<{ text: string; charStart: number; charEnd: number }> = []
  let currentChunk = ''
  let currentStart = globalCharStart

  for (const part of parts) {
    const candidate = currentChunk ? currentChunk + separator + part : part

    if (estimateTokens(candidate) > maxSize && currentChunk.length > 0) {
      // Current chunk is full — save it
      if (estimateTokens(currentChunk) >= minSize) {
        results.push({
          text: currentChunk.trim(),
          charStart: currentStart,
          charEnd: currentStart + currentChunk.length,
        })
      }

      // Start new chunk with overlap
      const overlapText = getOverlapText(currentChunk, overlap)
      currentStart = currentStart + currentChunk.length - overlapText.length
      currentChunk = overlapText + separator + part
    } else {
      currentChunk = candidate
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim().length > 0 && estimateTokens(currentChunk) >= minSize) {
    results.push({
      text: currentChunk.trim(),
      charStart: currentStart,
      charEnd: currentStart + currentChunk.length,
    })
  }

  // If any resulting chunk is still too large, recursively split with next separator
  const finalResults: Array<{ text: string; charStart: number; charEnd: number }> = []
  for (const result of results) {
    if (estimateTokens(result.text) > maxSize && separators.length > 1) {
      finalResults.push(
        ...recursiveSplit(result.text, result.charStart, maxSize, overlap, minSize, separators.slice(1))
      )
    } else {
      finalResults.push(result)
    }
  }

  return finalResults
}

function getOverlapText(text: string, overlapTokens: number): string {
  const words = text.split(' ')
  const overlapWords = Math.min(overlapTokens, Math.floor(words.length / 3))
  return words.slice(-overlapWords).join(' ')
}

function createChunk(
  text: string,
  index: number,
  charStart: number,
  charEnd: number,
  sectionNumber: string | null,
  pages: Array<{ pageNumber: number; printedPageNumber: number | null; charStart: number; charEnd: number }>
): Chunk {
  // Find which page this chunk starts on
  const page = pages.find(p => charStart >= p.charStart && charStart < p.charEnd)

  return {
    text: text.trim(),
    index,
    pageNumber: page?.pageNumber ?? null,
    printedPageNumber: page?.printedPageNumber ?? null,
    sectionNumber,
    clauseId: null,
    charStart,
    charEnd,
    metadata: {},
  }
}

/**
 * Rough token estimate: ~4 characters per token for English text.
 * This is an approximation — actual tokenization varies by model.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
