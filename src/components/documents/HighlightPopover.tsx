'use client'

import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface Annotation {
  id: string
  page: number
  type: 'risk' | 'citation'
  severity?: 'critical' | 'high' | 'medium' | 'low'
  category?: string
  title: string
  description: string
  recommendation?: string | null
  sourceClause?: string | null
  sourceText?: string | null
  confidence?: number
}

interface HighlightPopoverProps {
  annotation: Annotation
  children: React.ReactNode
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-400',
}

const SEVERITY_BADGE_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
}

/**
 * Popover that appears when clicking an annotation marker on the PDF.
 * Shows risk details: severity, category, description, recommendation,
 * and source quote.
 */
export function HighlightPopover({
  annotation,
  children,
}: HighlightPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger className="cursor-pointer">{children}</PopoverTrigger>
      <PopoverContent side="right" sideOffset={8} className="w-80">
        <PopoverHeader>
          <div className="flex items-center gap-2">
            {annotation.severity && (
              <span
                className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase',
                  SEVERITY_BADGE_STYLES[annotation.severity]
                )}
              >
                {annotation.severity}
              </span>
            )}
            <PopoverTitle>{annotation.title}</PopoverTitle>
          </div>
          {annotation.category && (
            <Badge variant="outline" className="text-[10px] w-fit">
              {annotation.category.replace(/_/g, ' ')}
            </Badge>
          )}
        </PopoverHeader>

        <PopoverDescription>{annotation.description}</PopoverDescription>

        {annotation.recommendation && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Recommendation:</span>{' '}
            {annotation.recommendation}
          </div>
        )}

        {annotation.sourceText && (
          <div className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2">
            &ldquo;{annotation.sourceText}&rdquo;
          </div>
        )}

        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {annotation.sourceClause && <span>{annotation.sourceClause}</span>}
          <span>Page {annotation.page}</span>
          {annotation.confidence !== undefined && (
            <span>Confidence: {Math.round(annotation.confidence * 100)}%</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Small colored marker dot used as the trigger for the popover.
 */
export function AnnotationMarker({
  severity,
  index,
}: {
  severity?: string
  index: number
}) {
  return (
    <div
      className={cn(
        'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shadow-sm',
        SEVERITY_COLORS[severity ?? 'medium']
      )}
    >
      {index + 1}
    </div>
  )
}
