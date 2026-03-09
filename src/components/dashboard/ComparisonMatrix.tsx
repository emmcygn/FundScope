'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatTermValue } from '@/lib/extraction/comparison'
import type {
  ComparisonRow,
  ComparisonCell,
  TermType,
} from '@/lib/extraction/schemas'

interface ComparisonMatrixProps {
  rows: ComparisonRow[]
  documents: Array<{ id: string; name: string }>
  isLoading?: boolean
}

/**
 * Comparison matrix table: rows = PE fund term types, columns = documents.
 * Cells are color-coded by market deviation:
 * - Green: within market standard range
 * - Yellow: minor deviation
 * - Red: major deviation
 * - Gray: term not found in document
 */
export function ComparisonMatrix({
  rows,
  documents,
  isLoading,
}: ComparisonMatrixProps) {
  const [expandedRow, setExpandedRow] = useState<TermType | null>(null)

  if (isLoading) {
    return <ComparisonSkeleton columnCount={documents.length} />
  }

  if (documents.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        Select documents to compare their terms.
      </div>
    )
  }

  // Filter out rows where no document has the term
  const visibleRows = rows.filter((row) =>
    row.cells.some((cell) => cell.term !== null)
  )

  return (
    <TooltipProvider>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48 bg-muted/50 font-semibold">
                Term
              </TableHead>
              {documents.map((doc) => (
                <TableHead key={doc.id} className="min-w-40 bg-muted/50">
                  <span className="truncate block max-w-48" title={doc.name}>
                    {doc.name}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={documents.length + 1}
                  className="text-center text-muted-foreground py-8"
                >
                  No terms extracted yet. Run extraction on the selected documents first.
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((row) => (
                <TableRow
                  key={row.termType}
                  className="cursor-pointer"
                  onClick={() =>
                    setExpandedRow(
                      expandedRow === row.termType ? null : row.termType
                    )
                  }
                >
                  <TableCell className="font-medium text-sm">
                    {row.label}
                  </TableCell>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.documentId}>
                      <ComparisonCellDisplay
                        cell={cell}
                        termType={row.termType}
                        expanded={expandedRow === row.termType}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  )
}

// ── Cell display ────────────────────────────────────────────────────────

function ComparisonCellDisplay({
  cell,
  termType,
  expanded,
}: {
  cell: ComparisonCell
  termType: TermType
  expanded: boolean
}) {
  if (!cell.term) {
    return (
      <span className="text-xs text-muted-foreground italic">Not found</span>
    )
  }

  const value = cell.term.term_value as Record<string, unknown>
  const displayValue = formatTermValue(termType, value)

  const bgColor = getDeviationBgColor(cell.deviationLevel)
  const confidenceBadge = getConfidenceBadge(cell.term.confidence)

  return (
    <div className="space-y-1">
      <Tooltip>
        <TooltipTrigger
          className={cn(
            'rounded px-2 py-1 text-sm inline-block cursor-default',
            bgColor
          )}
        >
          {displayValue}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {cell.term.deviation_notes ? (
            <p className="text-xs">{cell.term.deviation_notes}</p>
          ) : cell.deviationLevel === 'standard' ? (
            <p className="text-xs">Within market standard range</p>
          ) : (
            <p className="text-xs">No market benchmark available</p>
          )}
        </TooltipContent>
      </Tooltip>

      <div className="flex items-center gap-1">
        {confidenceBadge}
        {cell.term.source_clause && (
          <span className="text-xs text-muted-foreground">
            {cell.term.source_clause}
          </span>
        )}
      </div>

      {expanded && cell.term.source_text && (
        <p className="text-xs text-muted-foreground mt-1 whitespace-normal line-clamp-3 italic">
          &ldquo;{cell.term.source_text}&rdquo;
        </p>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getDeviationBgColor(
  level: 'standard' | 'minor' | 'major' | null
): string {
  switch (level) {
    case 'standard':
      return 'bg-[var(--severity-success)]/10 text-[var(--severity-success)]'
    case 'minor':
      return 'bg-[var(--severity-medium)]/10 text-[var(--severity-medium)]'
    case 'major':
      return 'bg-[var(--severity-critical)]/10 text-[var(--severity-critical)]'
    default:
      return 'bg-muted/50'
  }
}

function getConfidenceBadge(confidence: number) {
  if (confidence >= 0.8) {
    return (
      <Badge variant="outline" className="text-[10px] px-1 py-0">
        High
      </Badge>
    )
  }
  if (confidence >= 0.5) {
    return (
      <Badge variant="outline" className="text-[10px] px-1 py-0 text-yellow-600">
        Medium
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-[10px] px-1 py-0 text-red-600">
      Low
    </Badge>
  )
}

function ComparisonSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">
              <Skeleton className="h-4 w-20" />
            </TableHead>
            {Array.from({ length: columnCount || 2 }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-28" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              {Array.from({ length: columnCount || 2 }).map((_, j) => (
                <TableCell key={j}>
                  <Skeleton className="h-8 w-32" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
