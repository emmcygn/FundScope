'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { AnnotatedHighlight } from './PdfViewer'

interface AnnotationSidebarProps {
  highlights: AnnotatedHighlight[]
  activeHighlightId?: string | null
  onHighlightClick: (highlight: AnnotatedHighlight) => void
}

const SEVERITY_DOT_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-400',
}

/**
 * Sidebar listing all annotations grouped by page.
 * Clicking an annotation scrolls the PDF viewer to that highlight.
 */
export function AnnotationSidebar({
  highlights,
  activeHighlightId,
  onHighlightClick,
}: AnnotationSidebarProps) {
  if (highlights.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No annotations found. Run risk analysis to generate document annotations.
      </div>
    )
  }

  // Group by page number
  const byPage = new Map<number, AnnotatedHighlight[]>()
  for (const hl of highlights) {
    const page = hl.position.boundingRect.pageNumber
    if (!byPage.has(page)) {
      byPage.set(page, [])
    }
    byPage.get(page)!.push(hl)
  }

  const sortedPages = Array.from(byPage.keys()).sort((a, b) => a - b)

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">
          Annotations ({highlights.length})
        </h3>

        {sortedPages.map((page) => (
          <div key={page}>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              Page {page}
            </div>

            <div className="space-y-1">
              {byPage.get(page)!.map((hl) => (
                <button
                  key={hl.id}
                  onClick={() => onHighlightClick(hl)}
                  className={cn(
                    'w-full text-left rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50',
                    activeHighlightId === hl.id && 'bg-muted'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {hl.meta.severity && (
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full shrink-0',
                          SEVERITY_DOT_COLORS[hl.meta.severity]
                        )}
                      />
                    )}
                    <span className="truncate text-xs font-medium">
                      {hl.meta.title}
                    </span>
                  </div>
                  {hl.meta.category && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 mt-0.5"
                    >
                      {hl.meta.category.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </button>
              ))}
            </div>

            <Separator className="mt-2" />
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
