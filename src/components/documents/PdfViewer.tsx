'use client'

import { useCallback, useRef, useState } from 'react'
import {
  PdfLoader,
  PdfHighlighter,
  TextHighlight,
  AreaHighlight,
  MonitoredHighlightContainer,
  useHighlightContainerContext,
  usePdfHighlighterContext,
  type PdfHighlighterUtils,
} from 'react-pdf-highlighter-extended'
import type {
  Highlight,
  GhostHighlight,
  ScaledPosition,
  ViewportHighlight,
  Tip,
} from 'react-pdf-highlighter-extended'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// ── Annotation types ────────────────────────────────────────────────────

/** Extended highlight with metadata for risk flags / citations */
export interface AnnotatedHighlight extends Highlight {
  type: 'text' | 'area'
  meta: {
    annotationType: 'risk' | 'citation'
    severity?: 'critical' | 'high' | 'medium' | 'low'
    category?: string
    title: string
    description: string
    recommendation?: string | null
    sourceClause?: string | null
    confidence?: number
  }
}

// ── Props ───────────────────────────────────────────────────────────────

interface PdfViewerProps {
  /** URL to the PDF file (Supabase storage signed URL or public URL) */
  url: string
  /** Highlights to overlay on the PDF */
  highlights: AnnotatedHighlight[]
  /** Called when the user selects text (for creating new annotations) */
  onTextSelect?: (selection: GhostHighlight) => void
  /** Expose the highlighter utils to parent for external scroll-to control */
  onUtilsReady?: (utils: PdfHighlighterUtils) => void
  /** CSS class for the container */
  className?: string
}

// ── Severity styling ────────────────────────────────────────────────────

const SEVERITY_HIGHLIGHT_COLORS: Record<string, string> = {
  critical: 'rgba(239, 68, 68, 0.25)',   // red
  high: 'rgba(249, 115, 22, 0.25)',       // orange
  medium: 'rgba(234, 179, 8, 0.2)',       // yellow
  low: 'rgba(59, 130, 246, 0.15)',        // blue
}

const SEVERITY_BADGE_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
}

// ── Main component ──────────────────────────────────────────────────────

export function PdfViewer({
  url,
  highlights,
  onTextSelect,
  onUtilsReady,
  className,
}: PdfViewerProps) {
  const highlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null)

  const handleUtilsRef = useCallback(
    (utils: PdfHighlighterUtils) => {
      highlighterUtilsRef.current = utils
      onUtilsReady?.(utils)
    },
    [onUtilsReady]
  )

  const handleSelection = useCallback(
    (selection: { makeGhostHighlight: () => GhostHighlight }) => {
      if (onTextSelect) {
        onTextSelect(selection.makeGhostHighlight())
      }
    },
    [onTextSelect]
  )

  return (
    // pdfjs requires the viewer container to be position:absolute.
    // We wrap it in a relative div to give it a positioning context.
    <div className={cn('h-full w-full relative overflow-hidden', className)}>
      <PdfLoader
        document={url}
        workerSrc="/pdf.worker.min.mjs"
        beforeLoad={() => <PdfLoadingSkeleton />}
        errorMessage={(error) => (
          <div className="flex items-center justify-center h-full p-8 text-sm text-red-600">
            Failed to load PDF: {error.message}
          </div>
        )}
      >
        {(pdfDocument) => (
          <PdfHighlighter
            pdfDocument={pdfDocument}
            highlights={highlights}
            utilsRef={handleUtilsRef}
            pdfScaleValue="page-width"
            onSelection={handleSelection}
            textSelectionColor="rgba(59, 130, 246, 0.3)"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              overflow: 'auto',
            }}
          >
            <HighlightRenderer />
          </PdfHighlighter>
        )}
      </PdfLoader>
    </div>
  )
}

// ── Highlight renderer (child of PdfHighlighter) ────────────────────────

/**
 * Renders each highlight using the context provided by PdfHighlighter.
 * This component is instantiated once per highlight.
 */
function HighlightRenderer() {
  const { highlight, isScrolledTo } =
    useHighlightContainerContext<AnnotatedHighlight>()
  const highlighterUtils = usePdfHighlighterContext()
  const [showTip, setShowTip] = useState(false)

  const severity = highlight.meta?.severity ?? 'medium'
  const highlightColor = SEVERITY_HIGHLIGHT_COLORS[severity]

  const handleMouseEnter = () => {
    setShowTip(true)
    // Show tip positioned at the highlight
    highlighterUtils.setTip({
      position: highlight.position,
      content: <HighlightTipContent meta={highlight.meta} />,
    })
  }

  const handleMouseLeave = () => {
    setShowTip(false)
    highlighterUtils.setTip(null)
  }

  const tipContent = showTip
    ? {
        position: highlight.position,
        content: <HighlightTipContent meta={highlight.meta} />,
      }
    : undefined

  if (highlight.type === 'area') {
    return (
      <MonitoredHighlightContainer
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        highlightTip={tipContent}
      >
        <AreaHighlight
          highlight={highlight}
          isScrolledTo={isScrolledTo}
          style={{
            background: highlightColor,
            border: `1px solid ${severity === 'critical' ? 'rgba(239,68,68,0.5)' : 'rgba(0,0,0,0.1)'}`,
          }}
        />
      </MonitoredHighlightContainer>
    )
  }

  // Text highlight
  return (
    <MonitoredHighlightContainer
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      highlightTip={tipContent}
    >
      <TextHighlight
        highlight={highlight}
        isScrolledTo={isScrolledTo}
        style={{ background: highlightColor }}
      />
    </MonitoredHighlightContainer>
  )
}

// ── Highlight tip (popover content shown on hover) ──────────────────────

function HighlightTipContent({
  meta,
}: {
  meta: AnnotatedHighlight['meta']
}) {
  return (
    <div className="bg-popover text-popover-foreground rounded-lg shadow-lg border p-3 max-w-xs space-y-1.5 text-sm">
      {/* Header */}
      <div className="flex items-center gap-2">
        {meta.severity && (
          <span
            className={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase',
              SEVERITY_BADGE_STYLES[meta.severity]
            )}
          >
            {meta.severity}
          </span>
        )}
        <span className="font-medium text-sm">{meta.title}</span>
      </div>

      {/* Category */}
      {meta.category && (
        <Badge variant="outline" className="text-[10px]">
          {meta.category.replace(/_/g, ' ')}
        </Badge>
      )}

      {/* Description */}
      <p className="text-xs text-muted-foreground">{meta.description}</p>

      {/* Recommendation */}
      {meta.recommendation && (
        <p className="text-xs text-muted-foreground italic">
          <span className="font-medium not-italic">Recommendation: </span>
          {meta.recommendation}
        </p>
      )}

      {/* Footer */}
      <div className="flex gap-2 text-[10px] text-muted-foreground">
        {meta.sourceClause && <span>{meta.sourceClause}</span>}
        {meta.confidence !== undefined && (
          <span>Confidence: {Math.round(meta.confidence * 100)}%</span>
        )}
      </div>
    </div>
  )
}

// ── Loading skeleton ────────────────────────────────────────────────────

function PdfLoadingSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
      <Skeleton className="w-full max-w-lg h-[600px] rounded-md" />
      <p className="text-sm text-muted-foreground">Loading PDF...</p>
    </div>
  )
}

// ── Helper: create highlights from risk flags ───────────────────────────

/**
 * Converts risk flag data into highlight objects for the PdfViewer.
 *
 * Since we may not have exact text coordinates, we create area highlights
 * at approximate positions on the page. If bounding_rect data is available
 * from the DB, we use that for precise positioning.
 */
export function createHighlightsFromRiskFlags(
  riskFlags: Array<{
    id: string
    category: string
    severity: string
    title: string
    description: string
    recommendation?: string | null
    confidence_score: number
    source_clause?: string | null
    source_page?: number | null
    source_text?: string | null
    bounding_rect?: Record<string, unknown> | null
  }>
): AnnotatedHighlight[] {
  return riskFlags
    .filter((flag) => flag.source_page !== null && flag.source_page !== undefined)
    .map((flag, index) => {
      const pageNumber = flag.source_page!

      // Use bounding_rect if available, otherwise create a page-margin area highlight
      const position: ScaledPosition = flag.bounding_rect
        ? (flag.bounding_rect as unknown as ScaledPosition)
        : {
            boundingRect: {
              x1: 0.05,
              y1: 0.05 + (index % 5) * 0.18, // Stagger vertically to avoid overlap
              x2: 0.95,
              y2: 0.05 + (index % 5) * 0.18 + 0.15,
              width: 1,
              height: 1,
              pageNumber,
            },
            rects: [
              {
                x1: 0.05,
                y1: 0.05 + (index % 5) * 0.18,
                x2: 0.95,
                y2: 0.05 + (index % 5) * 0.18 + 0.15,
                width: 1,
                height: 1,
                pageNumber,
              },
            ],
          }

      return {
        id: flag.id,
        type: 'area' as const,
        position,
        meta: {
          annotationType: 'risk' as const,
          severity: flag.severity as AnnotatedHighlight['meta']['severity'],
          category: flag.category,
          title: flag.title,
          description: flag.description,
          recommendation: flag.recommendation,
          sourceClause: flag.source_clause,
          confidence: flag.confidence_score,
        },
      }
    })
}

/**
 * Creates a highlight from a chat citation for scroll-to functionality.
 */
export function createHighlightFromCitation(citation: {
  chunkId: string
  pageNumber: number | null
  sectionNumber: string | null
  text: string
}): AnnotatedHighlight | null {
  if (!citation.pageNumber) return null

  return {
    id: `citation-${citation.chunkId}`,
    type: 'area' as const,
    position: {
      boundingRect: {
        x1: 0.02,
        y1: 0.02,
        x2: 0.98,
        y2: 0.3,
        width: 1,
        height: 1,
        pageNumber: citation.pageNumber,
      },
      rects: [
        {
          x1: 0.02,
          y1: 0.02,
          x2: 0.98,
          y2: 0.3,
          width: 1,
          height: 1,
          pageNumber: citation.pageNumber,
        },
      ],
    },
    meta: {
      annotationType: 'citation' as const,
      title: citation.sectionNumber
        ? `Citation — ${citation.sectionNumber}`
        : 'Citation',
      description: citation.text,
    },
  }
}
