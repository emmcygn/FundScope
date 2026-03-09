'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, FileText, Building } from 'lucide-react'

interface Fund {
  id: string
  name: string
  manager: string | null
  vintage_year: number | null
  fund_size_millions: number | null
  currency: string
  status: string
  created_at: string
  documents: Array<{ count: number }>
}

export default function DashboardPage() {
  const router = useRouter()
  const [funds, setFunds] = useState<Fund[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  useEffect(() => {
    fetchFunds()
  }, [])

  async function fetchFunds() {
    try {
      const res = await fetch('/api/funds')
      const data = await res.json()
      setFunds(data.funds ?? [])
    } catch {
      toast.error('Failed to load funds')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-serif text-2xl tracking-tight">Funds</h1>
          <p className="text-muted-foreground text-sm">
            Manage your PE fund documents and analysis
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Fund
        </Button>
      </div>

      {/* Fund grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : funds.length === 0 ? (
        <Card className="py-12">
          <CardContent className="text-center space-y-3">
            <Building className="h-10 w-10 mx-auto text-muted-foreground" />
            <h2 className="text-lg font-medium">No funds yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Create your first fund to start uploading and analyzing PE fund
              documents.
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create Fund
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {funds.map((fund, i) => (
            <Card
              key={fund.id}
              className="cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 animate-fade-in-up"
              style={{ animationDelay: `${i * 80}ms` }}
              onClick={() => router.push(`/funds/${fund.id}`)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{fund.name}</CardTitle>
                  <Badge variant="outline" className="text-[10px]">
                    {fund.status}
                  </Badge>
                </div>
                {fund.manager && (
                  <CardDescription>{fund.manager}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {fund.vintage_year && <span>{fund.vintage_year}</span>}
                  {fund.fund_size_millions && (
                    <span>
                      {fund.currency} {fund.fund_size_millions}M
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {fund.documents?.[0]?.count ?? 0} docs
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create fund dialog */}
      {showCreateDialog && (
        <CreateFundDialog
          onClose={() => setShowCreateDialog(false)}
          onCreated={() => {
            setShowCreateDialog(false)
            fetchFunds()
          }}
        />
      )}
    </div>
  )
}

// ── Create fund dialog ──────────────────────────────────────────────────

function CreateFundDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [manager, setManager] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const res = await fetch('/api/funds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, manager: manager || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to create fund')
        return
      }

      toast.success('Fund created')
      onCreated()
    } catch {
      toast.error('Failed to create fund')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle>Create Fund</CardTitle>
          <CardDescription>
            Add a new PE fund to start uploading documents
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="fund-name" className="text-sm font-medium">
                Fund Name *
              </label>
              <Input
                id="fund-name"
                placeholder="e.g., Apex Capital Fund III"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="fund-manager" className="text-sm font-medium">
                Fund Manager
              </label>
              <Input
                id="fund-manager"
                placeholder="e.g., Apex Capital Partners"
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </CardContent>
          <div className="flex justify-end gap-2 px-6 pb-6">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? 'Creating...' : 'Create Fund'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
