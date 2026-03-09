/**
 * Debug endpoint: runs the full RAG retrieval pipeline and returns
 * intermediate results at each step so we can diagnose where Section 8.3.1
 * is being dropped.
 *
 * Usage: POST /api/debug/retrieval { "query": "...", "fundId": "..." }
 * DELETE this file before any production deploy.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hybridSearch } from '@/lib/rag/search'
import { rerankResults } from '@/lib/rag/reranker'
import { gradeChunks } from '@/lib/agents/grader'
import { generateQueryEmbedding } from '@/lib/rag/embeddings'
import { SEARCH_CONFIG } from '@/lib/utils/constants'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  // Tolerate spaces/encoding issues in param names by scanning all entries
  let query = 'What is the management fee after the commitment period ends?'
  let fundId = ''
  for (const [key, value] of searchParams.entries()) {
    const k = key.trim()
    if (k === 'q') query = value.trim()
    if (k === 'fundId') fundId = value.trim()
  }
  return runDebug(query, fundId)
}

export async function POST(request: NextRequest) {
  const { query, fundId } = await request.json()
  return runDebug(query, fundId)
}

async function runDebug(query: string, fundId: string) {

  // Step 0 — check how many chunks are stored for this fund
  const admin = createAdminClient()
  const { count: chunkCount } = await admin
    .from('chunks')
    .select('*', { count: 'exact', head: true })
    .eq('documents.fund_id', fundId)

  const { data: docRows } = await admin
    .from('documents')
    .select('id, name, processing_status')
    .eq('fund_id', fundId)

  // Count chunks per document
  const chunkCounts: Record<string, number> = {}
  for (const doc of docRows ?? []) {
    const { count } = await admin
      .from('chunks')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', doc.id)
    chunkCounts[doc.name] = count ?? 0
  }

  // Step 1 — BM25 only
  const STOP_WORDS = new Set([
    'what', 'whats', 'is', 'are', 'the', 'a', 'an', 'do', 'does', 'did',
    'how', 'when', 'where', 'which', 'who', 'why', 'can', 'will', 'would',
    'should', 'could', 'may', 'might', 'this', 'that', 'there', 'their',
    'with', 'for', 'not', 'but', 'any', 'all', 'has', 'have', 'been',
    'was', 'were', 'be', 'by', 'of', 'in', 'on', 'at', 'to', 'from',
    'and', 'or', 'if', 'its', 'it', 'me', 'my', 'we', 'our', 'about',
    'into', 'than', 'then', 'so', 'also', 'just', 'between', 'during',
    'within', 'without', 'under', 'over', 'after', 'before', 'as', 'per',
    'each', 'such', 'no', 'yes', 'i', 'you', 'they', 'them', 'he', 'she',
  ])
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((w: string) => w.replace(/[^\w]/g, ''))
    .filter((w: string) => w.length > 1 && !STOP_WORDS.has(w))
    .slice(0, 10)
  const tsQuery = terms.join(' | ')

  const { data: bm25Raw } = await admin
    .from('chunks')
    .select('id, document_id, text, section_number, page_number, documents!inner(fund_id)')
    .textSearch('fts', tsQuery)
    .eq('documents.fund_id', fundId)
    .limit(30)

  // Step 2 — full hybrid search
  const hybridResults = await hybridSearch(query, fundId)

  // Step 3 — reranked
  const reranked = await rerankResults(query, hybridResults)

  // Step 4 — graded
  const { relevant, irrelevant } = await gradeChunks(query, reranked)

  // Step 5 — keyword search for "8.3" specifically
  const { data: section83Raw } = await admin
    .from('chunks')
    .select('id, document_id, text, section_number, page_number, documents!inner(fund_id)')
    .textSearch('fts', '8.3 | management | fee')
    .eq('documents.fund_id', fundId)
    .limit(10)

  // Step 6 — ALL chunks full text so we can see exactly what was stored
  const docId = docRows?.[0]?.id ?? ''
  const { data: allChunks, error: chunksError } = await admin
    .from('chunks')
    .select('id, text, section_number, page_number, chunk_index')
    .eq('document_id', docId)
    .order('chunk_index', { ascending: true })

  return NextResponse.json({
    query,
    fundId,
    documentId: docId,
    chunksError: chunksError?.message ?? null,
    chunkCount: allChunks?.length ?? 0,
    allChunks: (allChunks ?? []).map((c: Record<string, unknown>) => ({
      chunkIndex: c.chunk_index,
      section: c.section_number,
      page: c.page_number,
      // Search for "1.75" or "8.3" in this output to find the management fee chunk
      text: (c.text as string),
    })),
  }, { status: 200 })
}
