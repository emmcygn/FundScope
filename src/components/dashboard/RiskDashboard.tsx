'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type {
  FundRiskSummary,
  RiskFlagRow,
  ObligationRow,
  ObligationStatus,
} from '@/lib/extraction/schemas'

// ── Main dashboard ──────────────────────────────────────────────────────

interface RiskDashboardProps {
  riskSummary: FundRiskSummary | null
  obligations: ObligationRow[]
  isLoading?: boolean
  onObligationStatusChange?: (obligationId: string, status: ObligationStatus) => void
}

export function RiskDashboard({
  riskSummary,
  obligations,
  isLoading,
  onObligationStatusChange,
}: RiskDashboardProps) {
  if (isLoading) {
    return <DashboardSkeleton />
  }

  return (
    <div className="space-y-6">
      {/* Risk score overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RiskScoreCard score={riskSummary?.overallScore ?? 0} />
        <SeverityBreakdownCard bySeverity={riskSummary?.bySeverity ?? {}} />
        <ObligationSummaryCard obligations={obligations} />
      </div>

      {/* Top risks */}
      <TopRisksCard risks={riskSummary?.topRisks ?? []} />

      {/* Obligations list */}
      <ObligationsCard
        obligations={obligations}
        onStatusChange={onObligationStatusChange}
      />
    </div>
  )
}

// ── Risk score card ─────────────────────────────────────────────────────

function RiskScoreCard({ score }: { score: number }) {
  const color = getScoreColor(score)
  const label = getScoreLabel(score)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Overall Risk Score
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className={cn('text-4xl font-bold', color)}>{score}</span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </div>
        <p className={cn('text-sm mt-1', color)}>{label}</p>
      </CardContent>
    </Card>
  )
}

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-[var(--severity-critical)]'
  if (score >= 40) return 'text-[var(--severity-medium)]'
  return 'text-[var(--severity-success)]'
}

function getScoreLabel(score: number): string {
  if (score >= 70) return 'High Risk'
  if (score >= 40) return 'Moderate Risk'
  if (score > 0) return 'Low Risk'
  return 'No Risks Detected'
}

// ── Severity breakdown card ─────────────────────────────────────────────

function SeverityBreakdownCard({
  bySeverity,
}: {
  bySeverity: Record<string, number>
}) {
  const severities: Array<{ key: string; label: string; color: string }> = [
    { key: 'critical', label: 'Critical', color: 'bg-[var(--severity-critical)]' },
    { key: 'high', label: 'High', color: 'bg-[var(--severity-high)]' },
    { key: 'medium', label: 'Medium', color: 'bg-[var(--severity-medium)]' },
    { key: 'low', label: 'Low', color: 'bg-[var(--severity-low)]' },
  ]

  const total = Object.values(bySeverity).reduce((sum, n) => sum + n, 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Risk Flags ({total})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {severities.map(({ key, label, color }) => {
          const count = bySeverity[key] ?? 0
          return (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full', color)} />
                <span className="text-sm">{label}</span>
              </div>
              <span className="text-sm font-medium">{count}</span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ── Obligation summary card ─────────────────────────────────────────────

function ObligationSummaryCard({
  obligations,
}: {
  obligations: ObligationRow[]
}) {
  const pending = obligations.filter((o) => o.status === 'pending').length
  const overdue = obligations.filter((o) => o.status === 'overdue').length
  const completed = obligations.filter((o) => o.status === 'completed').length

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Obligations ({obligations.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm">Pending</span>
          <Badge variant="outline">{pending}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--severity-critical)]">Overdue</span>
          <Badge variant="destructive">{overdue}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--severity-success)]">Completed</span>
          <Badge variant="outline" className="border-[var(--severity-success)]/30 text-[var(--severity-success)]">
            {completed}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Top risks card ──────────────────────────────────────────────────────

function TopRisksCard({ risks }: { risks: RiskFlagRow[] }) {
  if (risks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top Risks</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No risk flags found. Run risk analysis on your documents to identify potential issues.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top Risks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {risks.map((risk) => (
          <div key={risk.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={risk.severity} />
              <span className="text-sm font-medium">{risk.title}</span>
              <CategoryBadge category={risk.category} />
            </div>
            <p className="text-sm text-muted-foreground pl-6">
              {risk.description}
            </p>
            {risk.recommendation && (
              <p className="text-xs text-muted-foreground pl-6 italic">
                Recommendation: {risk.recommendation}
              </p>
            )}
            {risk !== risks[risks.length - 1] && <Separator className="mt-2" />}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ── Obligations card ────────────────────────────────────────────────────

function ObligationsCard({
  obligations,
  onStatusChange,
}: {
  obligations: ObligationRow[]
  onStatusChange?: (obligationId: string, status: ObligationStatus) => void
}) {
  if (obligations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Obligations</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No obligations extracted yet. Run obligation extraction on your documents.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Sort: overdue first, then pending, then completed/waived
  const statusOrder: Record<string, number> = {
    overdue: 0,
    pending: 1,
    completed: 2,
    waived: 3,
  }
  const sorted = [...obligations].sort(
    (a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4)
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Obligations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.map((obligation) => (
          <div key={obligation.id} className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={obligation.status} />
              <PriorityIndicator priority={obligation.priority} />
              <span className="text-sm font-medium flex-1">
                {obligation.description}
              </span>
              {onStatusChange && obligation.status === 'pending' && (
                <div className="flex gap-1">
                  <button
                    onClick={() => onStatusChange(obligation.id, 'completed')}
                    className="text-xs text-green-600 hover:underline"
                  >
                    Complete
                  </button>
                  <button
                    onClick={() => onStatusChange(obligation.id, 'waived')}
                    className="text-xs text-muted-foreground hover:underline"
                  >
                    Waive
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 pl-6 text-xs text-muted-foreground">
              {obligation.responsible_party && (
                <span>Responsible: {obligation.responsible_party.toUpperCase()}</span>
              )}
              {obligation.recurrence && obligation.recurrence !== 'one_time' && (
                <span>Recurrence: {obligation.recurrence.replace(/_/g, ' ')}</span>
              )}
              {obligation.due_description && (
                <span>Due: {obligation.due_description}</span>
              )}
              {obligation.source_clause && (
                <span>{obligation.source_clause}</span>
              )}
            </div>
            {obligation !== sorted[sorted.length - 1] && (
              <Separator className="mt-2" />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// ── Badge components ────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const variants: Record<string, string> = {
    critical: 'bg-[var(--severity-critical)]/15 text-[var(--severity-critical)]',
    high: 'bg-[var(--severity-high)]/15 text-[var(--severity-high)]',
    medium: 'bg-[var(--severity-medium)]/15 text-[var(--severity-medium)]',
    low: 'bg-[var(--severity-low)]/15 text-[var(--severity-low)]',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase',
        variants[severity] ?? variants['medium']
      )}
    >
      {severity}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="outline" className="text-[10px] px-1 py-0">
      {category.replace(/_/g, ' ')}
    </Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: 'bg-muted text-muted-foreground',
    overdue: 'bg-[var(--severity-critical)]/15 text-[var(--severity-critical)]',
    completed: 'bg-[var(--severity-success)]/15 text-[var(--severity-success)]',
    waived: 'bg-muted text-muted-foreground',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
        variants[status] ?? variants['pending']
      )}
    >
      {status}
    </span>
  )
}

function PriorityIndicator({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-[var(--severity-critical)]',
    high: 'bg-[var(--severity-high)]',
    medium: 'bg-[var(--severity-medium)]',
    low: 'bg-[var(--severity-low)]',
  }

  return (
    <div
      className={cn('w-1.5 h-1.5 rounded-full', colors[priority] ?? colors['medium'])}
      title={`Priority: ${priority}`}
    />
  )
}

// ── Loading skeleton ────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-10 w-20" />
              <Skeleton className="h-3 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-96" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
