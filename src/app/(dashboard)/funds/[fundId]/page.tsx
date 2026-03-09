'use client'

import { useEffect, useState, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { ChatInterface } from '@/components/chat/ChatInterface'
import { type Citation } from '@/components/chat/CitationLink'
import { PdfViewer, createHighlightFromCitation, type AnnotatedHighlight } from '@/components/documents/PdfViewer'
import type { PdfHighlighterUtils } from 'react-pdf-highlighter-extended'
import { toast } from 'sonner'
import {
  FileText,
  Upload,
  ArrowLeft,
  FileSearch,
  AlertTriangle,
  ClipboardList,
  X,
  Trash2,
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

  // PDF viewer split-panel state
  const [showPdfPanel, setShowPdfPanel] = useState(false)
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null)
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [activeDocName, setActiveDocName] = useState<string>('')
  const [citationHighlights, setCitationHighlights] = useState<AnnotatedHighlight[]>([])
  // Incremented on every citation click to force a clean PdfViewer remount.
  // This avoids react-pdf-highlighter-extended's createRoot() conflicts and
  // pdfjs offsetParent errors that occur when reusing the same viewer instance.
  const [pdfViewerKey, setPdfViewerKey] = useState(0)
  const highlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null)
  // Highlight to scroll to once the fresh viewer fires onUtilsReady
  const pendingScrollRef = useRef<AnnotatedHighlight | null>(null)
  // Monotonically increasing counter — incremented on every citation click.
  // Used to cancel stale scroll timeouts when the user clicks rapidly.
  const scrollGenRef = useRef(0)

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

  // Called by PdfHighlighter on every render (utilsRef fires in the render body).
  // We only scroll once utils.getViewer() is non-null — that's when pdfjs has
  // finished initialising the PDFViewer and page viewports are available.
  const handleUtilsReady = useCallback((utils: PdfHighlighterUtils) => {
    highlighterUtilsRef.current = utils

    if (!pendingScrollRef.current) return          // nothing to scroll to
    if (!utils.getViewer()) return                 // viewer not initialised yet — wait for next call

    // Viewer is ready. Capture pending target and clear the ref so later
    // handleUtilsReady calls (from re-renders) don't re-schedule the scroll.
    const pending = pendingScrollRef.current
    pendingScrollRef.current = null
    const gen = scrollGenRef.current

    // Small delay lets pdfjs finish its initial page layout before we try to
    // call scrollPageIntoView on a page whose viewport may not exist yet.
    setTimeout(() => {
      if (scrollGenRef.current !== gen) return     // user clicked again — skip stale scroll
      try {
        // scrollPageIntoView is more reliable than scrollToHighlight for
        // freshly-loaded PDFs — it only needs the page number, not scaled coords.
        const pageNumber = pending.position.boundingRect.pageNumber
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const viewer = (highlighterUtilsRef.current?.getViewer() as any)
        if (viewer && pageNumber) {
          viewer.scrollPageIntoView({ pageNumber })
        } else {
          highlighterUtilsRef.current?.scrollToHighlight(pending)
        }
      } catch { /* page not yet rendered — scroll is best-effort */ }
    }, 400)
  }, [])

  /**
   * Handle a citation click from the chat interface.
   *
   * Same-document (panel already open): skip remounting — just update the
   * highlight overlay and call scrollPageIntoView on the live viewer.
   * Remounting on every same-doc click caused the PDF to reload from scratch,
   * losing the scroll timing race and always landing on the default page.
   *
   * New document (or panel closed): remount the viewer with the new URL so
   * react-pdf-highlighter gets a clean React root, then scroll via
   * handleUtilsReady once pdfjs signals the viewer is initialised.
   */
  const handleCitationClick = useCallback(async (citation: Citation) => {
    if (!citation.pageNumber) {
      toast.error('This citation has no page reference')
      return
    }

    const highlight = createHighlightFromCitation(citation)
    if (!highlight) return

    // Monotonically increment so stale scroll timeouts can self-cancel
    scrollGenRef.current++
    const gen = scrollGenRef.current

    if (activeDocId === citation.documentId && activePdfUrl && showPdfPanel) {
      // PDF is already loaded and visible — scroll directly without remounting
      setCitationHighlights([highlight])
      setTimeout(() => {
        if (scrollGenRef.current !== gen) return
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const viewer = (highlighterUtilsRef.current?.getViewer() as any)
          if (viewer && citation.pageNumber) {
            viewer.scrollPageIntoView({ pageNumber: citation.pageNumber })
          } else {
            highlighterUtilsRef.current?.scrollToHighlight(highlight)
          }
        } catch { /* best effort */ }
      }, 50)
      return
    }

    // Panel closed or different document — (re)mount the viewer
    highlighterUtilsRef.current = null
    pendingScrollRef.current = highlight

    if (activeDocId === citation.documentId && activePdfUrl) {
      // Same document, panel was closed — remount to reopen
      setCitationHighlights([highlight])
      setPdfViewerKey((k) => k + 1)
      setShowPdfPanel(true)
      return
    }

    // Different document — fetch a signed URL first
    try {
      const res = await fetch(`/api/documents/${citation.documentId}/url`)
      if (!res.ok) {
        toast.error('Failed to load document')
        return
      }

      const data = await res.json() as {
        signedUrl: string
        documentName: string
        pageCount: number | null
      }

      setActivePdfUrl(data.signedUrl)
      setActiveDocId(citation.documentId)
      setActiveDocName(data.documentName)
      setCitationHighlights([highlight])
      setPdfViewerKey((k) => k + 1)
      setShowPdfPanel(true)
    } catch {
      toast.error('Failed to load document')
    }
  }, [activeDocId, activePdfUrl, showPdfPanel])

  if (isLoading) {
    return <FundDetailSkeleton />
  }

  if (!fund) return null

  return (
    <div className={`p-6 mx-auto space-y-6 ${showPdfPanel ? 'max-w-[1400px]' : 'max-w-6xl'}`}>
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

        {/* Chat tab — split panel: chat left, PDF right */}
        <TabsContent value="chat">
          <div className={`flex gap-4 ${showPdfPanel ? '' : ''}`}>
            {/* Chat panel */}
            <Card className={showPdfPanel ? 'w-1/2' : 'w-full'}>
              <CardContent className="p-0">
                <div className="h-[600px]">
                  <ChatInterface
                    fundId={fundId}
                    onCitationClick={handleCitationClick}
                  />
                </div>
              </CardContent>
            </Card>

            {/* PDF panel — shown when a citation is clicked */}
            {showPdfPanel && activePdfUrl && (
              <Card className="w-1/2">
                <CardContent className="p-0 h-[600px] flex flex-col">
                  {/* PDF header bar */}
                  <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{activeDocName}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 flex-shrink-0"
                      onClick={() => setShowPdfPanel(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  {/* PDF viewer */}
                  <div className="flex-1 overflow-hidden">
                    <PdfViewer
                      key={pdfViewerKey}
                      url={activePdfUrl}
                      highlights={citationHighlights}
                      onUtilsReady={handleUtilsReady}
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
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
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(docId: string, docName: string) {
    if (!confirm(`Delete "${docName}"? This will remove all chunks and cannot be undone.`)) return

    setDeletingId(docId)
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Delete failed')
        return
      }
      toast.success('Document deleted')
      onDocumentUploaded() // refresh list
    } catch {
      toast.error('Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

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
                <div className="flex items-center gap-2">
                  <ProcessingBadge status={doc.processing_status} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={deletingId === doc.id}
                    onClick={() => handleDelete(doc.id, doc.name)}
                    title="Delete document"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

// ── Extraction panel ────────────────────────────────────────────────────

// Shape of a term returned by /api/extract
interface ExtractedTermResult {
  termType: string
  confidence: number
  sourceClause: string | null
  sourcePage: number | null
  isMarketStandard: boolean | null
  deviationNotes: string | null
}

// Shape of an obligation returned by /api/obligations
interface ObligationResult {
  description: string
  category: string | null
  priority: string
  recurrence: string | null
  responsibleParty: string | null
}

const TERM_LABELS: Record<string, string> = {
  management_fee: 'Management Fee',
  carried_interest: 'Carried Interest',
  preferred_return: 'Preferred Return',
  hurdle_rate: 'Hurdle Rate',
  investment_period: 'Investment Period',
  fund_term: 'Fund Term',
  gp_commitment: 'GP Commitment',
  key_person: 'Key Person Provision',
  clawback: 'Clawback',
  mfn_rights: 'MFN Rights',
  no_fault_removal: 'No-Fault Removal',
  excuse_exclusion: 'Excuse/Exclusion Rights',
  distribution_waterfall: 'Distribution Waterfall',
  reporting_obligation: 'Reporting Obligation',
  fund_size_cap: 'Fund Size Cap',
  recycling_provision: 'Recycling Provision',
  co_investment_rights: 'Co-Investment Rights',
  advisory_committee: 'Advisory Committee',
  other: 'Other',
}

function ExtractionPanel({
  fundId,
  documents,
}: {
  fundId: string
  documents: Document[]
}) {
  const [isExtracting, setIsExtracting] = useState(false)
  const [terms, setTerms] = useState<ExtractedTermResult[]>([])
  const [obligations, setObligations] = useState<ObligationResult[]>([])
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

      setTerms(data.terms ?? [])
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

      setObligations(data.obligations ?? [])
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
    <div className="space-y-4">
      {/* Action buttons per document */}
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
                {isExtracting ? 'Extracting…' : 'Extract Terms'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleExtractObligations(doc.id)}
                disabled={isExtracting}
              >
                {isExtracting ? 'Extracting…' : 'Extract Obligations'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Extracted terms */}
      {terms.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Extracted Terms</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {terms.map((t, i) => (
              <div key={i} className="py-2.5 flex items-start justify-between gap-4">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-medium">{TERM_LABELS[t.termType] ?? t.termType}</p>
                  {t.sourceClause && (
                    <p className="text-xs text-muted-foreground">{t.sourceClause}{t.sourcePage ? ` · p.${t.sourcePage}` : ''}</p>
                  )}
                  {t.deviationNotes && (
                    <p className="text-xs text-[var(--severity-high)]">{t.deviationNotes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {t.isMarketStandard === false && (
                    <Badge className="bg-[var(--severity-high)]/15 text-[var(--severity-high)] border-0 text-[10px]">
                      Non-standard
                    </Badge>
                  )}
                  {t.isMarketStandard === true && (
                    <Badge className="bg-[var(--severity-success)]/15 text-[var(--severity-success)] border-0 text-[10px]">
                      Market standard
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">{Math.round(t.confidence * 100)}% conf.</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Extracted obligations */}
      {obligations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Obligations</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {obligations.map((o, i) => (
              <div key={i} className="py-2.5 flex items-start justify-between gap-4">
                <p className="text-sm min-w-0">{o.description}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {o.priority === 'critical' || o.priority === 'high' ? (
                    <Badge className="bg-[var(--severity-high)]/15 text-[var(--severity-high)] border-0 text-[10px] capitalize">
                      {o.priority}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] capitalize">{o.priority}</Badge>
                  )}
                  {o.responsibleParty && (
                    <span className="text-xs text-muted-foreground uppercase">{o.responsibleParty}</span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Risks panel ─────────────────────────────────────────────────────────

interface RiskFlagResult {
  category: string
  severity: string
  title: string
  description: string
  recommendation: string | null
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-[var(--severity-critical)]/15 text-[var(--severity-critical)]',
  high: 'bg-[var(--severity-high)]/15 text-[var(--severity-high)]',
  medium: 'bg-[var(--severity-medium)]/15 text-[var(--severity-medium)]',
  low: 'bg-[var(--severity-low)]/15 text-[var(--severity-low)]',
}

function RisksPanel({
  fundId,
  documents,
}: {
  fundId: string
  documents: Document[]
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [flags, setFlags] = useState<RiskFlagResult[]>([])
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

      setFlags(data.flags ?? [])
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
    <div className="space-y-4">
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
              {isAnalyzing ? 'Analyzing…' : 'Run Risk Analysis'}
            </Button>
          </CardContent>
        </Card>
      ))}

      {/* Risk flags */}
      {flags.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{flags.length} Risk Flag{flags.length !== 1 ? 's' : ''} Identified</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {flags.map((f, i) => (
              <div key={i} className="py-3 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge className={`${SEVERITY_STYLES[f.severity] ?? ''} border-0 text-[10px] capitalize`}>
                    {f.severity}
                  </Badge>
                  <p className="text-sm font-medium">{f.title}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.description}</p>
                {f.recommendation && (
                  <p className="text-xs text-foreground/70 italic">Recommendation: {f.recommendation}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
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
