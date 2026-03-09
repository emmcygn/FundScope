'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { ChatInterface } from '@/components/chat/ChatInterface'
import { toast } from 'sonner'
import {
  FileText,
  Upload,
  ArrowLeft,
  FileSearch,
  AlertTriangle,
  ClipboardList,
} from 'lucide-react'

interface Fund {
  id: string
  name: string
  manager: string | null
  vintage_year: number | null
  fund_size_millions: number | null
  currency: string
  status: string
}

interface Document {
  id: string
  name: string
  doc_type: string
  processing_status: string
  page_count: number | null
  created_at: string
}

export default function FundDetailPage({
  params,
}: {
  params: Promise<{ fundId: string }>
}) {
  const { fundId } = use(params)
  const router = useRouter()
  const [fund, setFund] = useState<Fund | null>(null)
  const [documents, setDocuments] = useState<Document[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchFundData = useCallback(async () => {
    const supabase = createClient()

    const [fundRes, docsRes] = await Promise.all([
      supabase.from('funds').select('*').eq('id', fundId).single(),
      supabase
        .from('documents')
        .select('id, name, doc_type, processing_status, page_count, created_at')
        .eq('fund_id', fundId)
        .order('created_at', { ascending: false }),
    ])

    if (fundRes.error) {
      toast.error('Fund not found')
      router.push('/')
      return
    }

    setFund(fundRes.data)
    setDocuments(docsRes.data ?? [])
    setIsLoading(false)
  }, [fundId, router])

  useEffect(() => {
    fetchFundData()
  }, [fetchFundData])

  if (isLoading) {
    return <FundDetailSkeleton />
  }

  if (!fund) return null

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="heading-serif text-2xl tracking-tight">{fund.name}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {fund.manager && <span>{fund.manager}</span>}
            {fund.vintage_year && <span>{fund.vintage_year}</span>}
            {fund.fund_size_millions && (
              <span>
                {fund.currency} {fund.fund_size_millions}M
              </span>
            )}
            <Badge variant="outline" className="text-[10px]">
              {fund.status}
            </Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="chat" className="gap-1.5">
            <FileSearch className="h-3.5 w-3.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="extraction" className="gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" />
            Extraction
          </TabsTrigger>
          <TabsTrigger value="risks" className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Risks
          </TabsTrigger>
        </TabsList>

        {/* Documents tab */}
        <TabsContent value="documents" className="space-y-4">
          <DocumentsPanel
            fundId={fundId}
            documents={documents}
            onDocumentUploaded={fetchFundData}
          />
        </TabsContent>

        {/* Chat tab */}
        <TabsContent value="chat">
          <Card>
            <CardContent className="p-0">
              <div className="h-[600px]">
                <ChatInterface fundId={fundId} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Extraction tab */}
        <TabsContent value="extraction" className="space-y-4">
          <ExtractionPanel fundId={fundId} documents={documents} />
        </TabsContent>

        {/* Risks tab */}
        <TabsContent value="risks" className="space-y-4">
          <RisksPanel fundId={fundId} documents={documents} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Documents panel ─────────────────────────────────────────────────────

function DocumentsPanel({
  fundId,
  documents,
  onDocumentUploaded,
}: {
  fundId: string
  documents: Document[]
  onDocumentUploaded: () => void
}) {
  const [isUploading, setIsUploading] = useState(false)

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files are supported')
      return
    }

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('fundId', fundId)
    formData.append('docType', 'lpa') // Default; could add a selector

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Upload failed')
        return
      }

      toast.success('Document uploaded and processing started')
      onDocumentUploaded()
    } catch {
      toast.error('Upload failed')
    } finally {
      setIsUploading(false)
      // Reset the file input
      e.target.value = ''
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Documents</h2>
        <div>
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileUpload}
            disabled={isUploading}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload">
            <Button type="button" disabled={isUploading} className="cursor-pointer" onClick={() => document.getElementById('file-upload')?.click()}>
              <Upload className="h-4 w-4 mr-1.5" />
              {isUploading ? 'Uploading...' : 'Upload PDF'}
            </Button>
          </label>
        </div>
      </div>

      {documents.length === 0 ? (
        <Card className="py-8">
          <CardContent className="text-center space-y-2">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No documents yet. Upload a PDF to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="flex items-center justify-between py-3 px-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{doc.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{doc.doc_type.replace(/_/g, ' ')}</span>
                      {doc.page_count && <span>{doc.page_count} pages</span>}
                    </div>
                  </div>
                </div>
                <ProcessingBadge status={doc.processing_status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

// ── Extraction panel ────────────────────────────────────────────────────

function ExtractionPanel({
  fundId,
  documents,
}: {
  fundId: string
  documents: Document[]
}) {
  const [isExtracting, setIsExtracting] = useState(false)
  const readyDocs = documents.filter((d) => d.processing_status === 'ready')

  async function handleExtract(docId: string) {
    setIsExtracting(true)
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: docId, fundId }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Extraction failed')
        return
      }

      toast.success(`Extracted ${data.termsExtracted} terms`)
    } catch {
      toast.error('Extraction failed')
    } finally {
      setIsExtracting(false)
    }
  }

  async function handleExtractObligations(docId: string) {
    setIsExtracting(true)
    try {
      const res = await fetch('/api/obligations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: docId, fundId }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Obligation extraction failed')
        return
      }

      toast.success(`Extracted ${data.obligationsExtracted} obligations`)
    } catch {
      toast.error('Obligation extraction failed')
    } finally {
      setIsExtracting(false)
    }
  }

  if (readyDocs.length === 0) {
    return (
      <Card className="py-8">
        <CardContent className="text-center space-y-2">
          <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Upload and process documents first, then extract terms and obligations.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {readyDocs.map((doc) => (
        <Card key={doc.id}>
          <CardContent className="flex items-center justify-between py-3 px-4">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-medium">{doc.name}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleExtract(doc.id)}
                disabled={isExtracting}
              >
                Extract Terms
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleExtractObligations(doc.id)}
                disabled={isExtracting}
              >
                Extract Obligations
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Risks panel ─────────────────────────────────────────────────────────

function RisksPanel({
  fundId,
  documents,
}: {
  fundId: string
  documents: Document[]
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const readyDocs = documents.filter((d) => d.processing_status === 'ready')

  async function handleAnalyze(docId: string) {
    setIsAnalyzing(true)
    try {
      const res = await fetch('/api/risks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: docId, fundId }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Risk analysis failed')
        return
      }

      toast.success(`Generated ${data.flagsGenerated} risk flags`)
    } catch {
      toast.error('Risk analysis failed')
    } finally {
      setIsAnalyzing(false)
    }
  }

  if (readyDocs.length === 0) {
    return (
      <Card className="py-8">
        <CardContent className="text-center space-y-2">
          <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Upload and process documents first, then run risk analysis.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {readyDocs.map((doc) => (
        <Card key={doc.id}>
          <CardContent className="flex items-center justify-between py-3 px-4">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-medium">{doc.name}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleAnalyze(doc.id)}
              disabled={isAnalyzing}
            >
              Run Risk Analysis
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ── Shared components ───────────────────────────────────────────────────

function ProcessingBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
    processing: { label: 'Processing', className: 'bg-[var(--severity-low)]/15 text-[var(--severity-low)]' },
    chunking: { label: 'Chunking', className: 'bg-[var(--severity-low)]/15 text-[var(--severity-low)]' },
    embedding: { label: 'Embedding', className: 'bg-[var(--severity-low)]/15 text-[var(--severity-low)]' },
    extracting: { label: 'Extracting', className: 'bg-[var(--severity-medium)]/15 text-[var(--severity-medium)]' },
    ready: { label: 'Ready', className: 'bg-[var(--severity-success)]/15 text-[var(--severity-success)]' },
    error: { label: 'Error', className: 'bg-[var(--severity-critical)]/15 text-[var(--severity-critical)]' },
  }

  const v = variants[status] ?? variants['pending']!

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${v.className}`}>
      {v.label}
    </span>
  )
}

function FundDetailSkeleton() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8" />
        <div className="space-y-1">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-10 w-96" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  )
}
