'use client'

import { type ReactNode, useState } from 'react'
import { FileText, ChevronDown, ChevronUp } from 'lucide-react'

// Shape returned by buildCitations() in the chat API
export interface Citation {
  chunkId: string
  documentId: string
  pageNumber: number | null     // PDF internal index — used for navigation
  printedPage?: number | null   // Printed footer number — shown to user (may differ from pageNumber)
  sectionNumber: string | null
  text: string
}

// ─── Citation marker parsing ──────────────────────────────────────────────────

/**
 * Regex that matches the [CITES:base64] marker appended by the chat API.
 * The `$` anchors to end-of-string so it only matches the complete marker.
 */
const CITES_RE = /\[CITES:([A-Za-z0-9+/=]+)\]$/
/**
 * During streaming the marker may be incomplete — strip any partial prefix too.
 */
const PARTIAL_CITES_RE = /\[CITES:[A-Za-z0-9+/=]*$/

/**
 * Extracts the citation array embedded in the message text by the API, and
 * returns the clean display text (marker stripped).
 */
export function parseCitationsFromText(text: string): {
  cleanText: string
  citations: Citation[]
} {
  const match = CITES_RE.exec(text)
  if (match) {
    try {
      const citations = JSON.parse(atob(match[1]!)) as Citation[]
      const cleanText = text.slice(0, match.index).replace(PARTIAL_CITES_RE, '').trimEnd()
      return { cleanText, citations }
    } catch {
      // Fall through to return raw text on parse error
    }
  }

  // Strip any incomplete marker that appears during streaming
  const cleanText = text.replace(PARTIAL_CITES_RE, '').trimEnd()
  return { cleanText, citations: [] }
}

// ─── Inline citation badge ────────────────────────────────────────────────────

interface CitationLinkProps {
  sourceNumber: number
  citation: Citation | undefined
  onClick?: (citation: Citation) => void
}

/**
 * Compact inline badge for a single source reference, e.g. [1].
 * Shows page + text preview on hover. Calls onClick when the user clicks.
 */
export function CitationLink({ sourceNumber, citation, onClick }: CitationLinkProps) {
  const displayPage = citation ? (citation.printedPage ?? citation.pageNumber) : null
  const tooltipText = citation
    ? `Page ${displayPage ?? '?'}${citation.sectionNumber ? ` · ${citation.sectionNumber}` : ''} — ${citation.text.slice(0, 100)}${citation.text.length > 100 ? '...' : ''}`
    : `Source ${sourceNumber}`

  return (
    <button
      type="button"
      onClick={() => citation && onClick?.(citation)}
      className="inline-flex items-center justify-center w-5 h-5 mx-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary hover:bg-primary/25 transition-colors cursor-pointer align-baseline leading-none"
      title={tooltipText}
      aria-label={`Source ${sourceNumber}`}
    >
      {sourceNumber}
    </button>
  )
}

// ─── Sources footer panel ─────────────────────────────────────────────────────

interface SourcesListProps {
  citations: Citation[]
  onCitationClick?: (citation: Citation) => void
}

/**
 * Collapsible footer that lists all sources for a message.
 * Each row shows the source number, page, and a short text preview.
 * Clicking a row triggers onCitationClick to open the PDF viewer.
 * Scales gracefully to 50+ sources via a scrollable container.
 */
export function SourcesList({ citations, onCitationClick }: SourcesListProps) {
  const [open, setOpen] = useState(false)

  if (citations.length === 0) return null

  return (
    <div className="mt-3 pt-2 border-t border-border/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <FileText className="h-3 w-3" />
        <span>{citations.length} source{citations.length !== 1 ? 's' : ''}</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <div className="mt-1.5 max-h-52 overflow-y-auto space-y-0.5 pr-1">
          {citations.map((citation, i) => (
            <button
              key={citation.chunkId}
              type="button"
              onClick={() => onCitationClick?.(citation)}
              className="w-full text-left flex gap-2 items-start px-2 py-1.5 rounded text-xs hover:bg-muted/70 transition-colors group"
            >
              {/* Source number badge */}
              <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded bg-primary/15 text-primary text-[10px] font-semibold group-hover:bg-primary/25 transition-colors">
                {i + 1}
              </span>
              {/* Page + text preview — show printed footer page if available */}
              <span className="text-muted-foreground leading-relaxed">
                {(citation.printedPage ?? citation.pageNumber) != null ? (
                  <span className="font-medium text-foreground mr-1">
                    p.{citation.printedPage ?? citation.pageNumber}
                  </span>
                ) : null}
                {citation.text.slice(0, 80)}{citation.text.length > 80 ? '…' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Text processor ───────────────────────────────────────────────────────────

/**
 * Walks ReactMarkdown children and replaces [Source N] / [Source N, Source M]
 * patterns with compact CitationLink badge(s).
 */
export function processTextChildren(
  children: ReactNode,
  citations: Citation[],
  onCitationClick?: (citation: Citation) => void
): ReactNode {
  if (typeof children === 'string') {
    const parts = splitSourceRefs(children, citations, onCitationClick)
    return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') {
        const parts = splitSourceRefs(child, citations, onCitationClick)
        if (parts.length === 1 && typeof parts[0] === 'string') return parts[0]
        return <span key={i}>{parts}</span>
      }
      return child
    })
  }

  return children
}

/**
 * Splits a string on [Source N] and [Source N, Source M, ...] groups,
 * replacing each with one CitationLink badge per source number.
 */
function splitSourceRefs(
  text: string,
  citations: Citation[],
  onCitationClick?: (citation: Citation) => void
): ReactNode[] {
  // Match bracket groups with one or more "Source N" separated by commas
  const groupPattern = /\[Source\s+\d+(?:,\s*Source\s+\d+)*\]/g
  const numPattern = /\d+/g

  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = groupPattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))

    // Extract every number from the group, e.g. "[Source 1, Source 2]" → [1, 2]
    const nums: number[] = []
    const scanner = new RegExp(numPattern.source, 'g')
    let numMatch: RegExpExecArray | null
    while ((numMatch = scanner.exec(match[0])) !== null) {
      nums.push(parseInt(numMatch[0], 10))
    }

    parts.push(
      <span key={`grp-${match.index}`} className="inline-flex gap-0.5 align-baseline">
        {nums.map((n) => (
          <CitationLink
            key={n}
            sourceNumber={n}
            citation={citations[n - 1]}
            onClick={onCitationClick}
          />
        ))}
      </span>
    )

    lastIndex = groupPattern.lastIndex
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length > 0 ? parts : [text]
}
