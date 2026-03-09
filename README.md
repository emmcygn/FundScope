# FundScope

AI-powered contract analysis for private equity fund documentation. Upload LPAs, side letters, and term sheets — FundScope extracts key economics, tracks obligations, flags risks, and answers questions about your documents with verifiable citations.

> **Live demo:** *(Loom walkthrough coming soon)*

---

## What it does

**Document Q&A with citations** — Ask anything about your fund documents. Every answer links back to the exact page and clause it came from. Click a citation to jump to that location in the PDF viewer.

**Structured term extraction** — Automatically pulls out management fees, carried interest, hurdle rates, distribution waterfall structure, GP commitment, investment period, key person provisions, and more — mapped to a standard PE fund schema.

**Risk flagging** — Identifies clauses that deviate from market standard (ILPA guidelines), missing provisions, and LP-unfavorable terms with severity scoring.

**Obligation tracking** — Extracts time-bound LP/GP obligations (reporting deadlines, capital call windows, MFN election periods) into a calendar view.

**Cross-document comparison** — Compare terms across multiple documents side-by-side (e.g. draft LPA vs. final LPA, or multiple fund vintages).

---

## Architecture

The retrieval pipeline goes beyond basic RAG:

```
PDF Upload
    │
    ▼
pdfjs-dist extraction          — handles complex layouts, tagged PDFs
    │
    ▼
Hierarchical chunking          — splits on section headers first, then paragraphs, then sentences
    │
    ▼
Contextual enrichment          — Claude prepends a document-aware summary to each chunk before embedding
    │                            (~67% retrieval improvement per Anthropic's technique)
    ▼
pgvector storage               — 1024-dim embeddings via text-embedding-3-large
    │
    ▼
Hybrid search (dense + BM25)   — RRF merge, Cohere rerank
    │
    ▼
Agentic RAG loop               — relevance grading → query rewrite → retry (max 2)
    │
    ▼
Generation + hallucination check — Claude Sonnet, self-correction on failure
    │
    ▼
Streaming response with citations
```

**Structured extraction** uses `generateObject()` with Zod schemas — the LLM outputs typed objects, not free text, so downstream code can rely on field presence and types.

**Observability** — every LLM call, search operation, and pipeline step is traced in Langfuse with token counts and latency.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router | Server components for data fetching, streaming RSC for chat |
| AI SDK | Vercel AI SDK v5 | `streamText`, `generateObject`, `useChat` with parts API |
| LLM | Claude Sonnet (`claude-sonnet-4-20250514`) | Best reasoning-to-cost ratio for legal text |
| Lightweight LLM | GPT-4o-mini | Query routing, relevance grading — 10x cheaper for classification |
| Embeddings | OpenAI `text-embedding-3-large` (1024-dim) | Best retrieval quality at reasonable cost |
| Database | Supabase Postgres + pgvector | RLS for multi-tenancy, vector similarity via `match_chunks` RPC |
| Auth | Supabase Auth | Email/password, RLS enforced on every table |
| Storage | Supabase Storage | PDFs stored per `{userId}/{fundId}/{uuid}.pdf` |
| Reranking | Cohere Rerank v3 | Significant precision improvement; graceful fallback if key absent |
| PDF viewing | react-pdf-highlighter-extended | Annotated highlights, bidirectional chat↔document linking |
| Observability | Langfuse v3 | Traces, cost tracking, eval dashboards |
| UI | shadcn/ui + Tailwind v4 | |

---

## Project structure

```
src/
├── app/
│   ├── (auth)/                 # Login / signup
│   ├── (dashboard)/            # Protected app pages
│   └── api/
│       ├── chat/               # Streaming agentic RAG endpoint
│       ├── documents/          # Upload, delete, signed URL
│       ├── extract/            # Structured term extraction
│       └── debug/              # parse + retrieval diagnostic endpoints
├── lib/
│   ├── pdf/parser.ts           # pdfjs extraction + printed page detection
│   ├── rag/
│   │   ├── chunker.ts          # Hierarchical recursive splitter
│   │   ├── contextual.ts       # Anthropic contextual enrichment
│   │   ├── embeddings.ts       # Batch embedding generation
│   │   ├── search.ts           # Hybrid search + BM25 + rerank
│   │   └── pipeline.ts         # Full ingestion orchestrator
│   ├── agents/
│   │   ├── router.ts           # Query routing
│   │   ├── grader.ts           # Relevance grading
│   │   ├── generator.ts        # Answer generation + citation building
│   │   └── checker.ts          # Hallucination detection + self-correction
│   ├── extraction/             # Zod schemas + term extraction
│   └── utils/constants.ts      # Market standard PE fund ranges
└── components/
    ├── chat/                   # ChatInterface, CitationLink, SourcesList
    ├── documents/              # Upload flow, PdfViewer
    └── dashboard/              # RiskDashboard, ComparisonMatrix, ObligationTracker
```

---

## Running locally

**Prerequisites:** Node.js 20+, a Supabase project with pgvector enabled, API keys for Anthropic, OpenAI, and optionally Cohere and Langfuse.

```bash
git clone https://github.com/emmcygn/FundScope.git
cd FundScope
npm install
cp .env.example .env.local   # fill in your keys
npm run dev
```

**Required environment variables:**

```
ANTHROPIC_API_KEY
OPENAI_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
```

**Optional (graceful degradation without them):**

```
COHERE_API_KEY
LANGFUSE_PUBLIC_KEY
LANGFUSE_SECRET_KEY
NEXT_PUBLIC_LANGFUSE_HOST
```

Run the SQL migrations in `supabase/migrations/` via the Supabase SQL editor to create the schema and `match_chunks` RPC.

---

## Key design decisions

**Why pdfjs-dist over pdf-parse** — pdf-parse uses an older PDF.js fork that misses text in tagged PDFs, custom fonts, and complex layouts. pdfjs-dist is the same engine as the browser viewer — if it can render it, it can extract it.

**Why printed page detection matters** — Legal PDFs have front matter (cover, TOC, definitions) that shifts page numbers. PDF internal index 10 might be printed page 7. FundScope detects footer page numbers at ingestion and stores them separately, so citation links and source panel always show the page number the lawyer sees.

**Why not just dense vector search** — Exact legal terms (clause numbers, defined terms like "Commitment Period") match poorly against semantic embeddings but perfectly with BM25. Hybrid search with RRF merge handles both.

**Why a grading + rewrite loop** — A single retrieval pass often misses the right chunk on ambiguous queries. Grading the chunks against the query and rewriting if coverage is poor makes a measurable difference on multi-hop legal questions.

---

## Evaluation

The `eval/` directory contains a RAGAS evaluation suite with a golden test set of 50 PE fund Q&A pairs. Run it after ingesting documents:

```bash
cd eval
pip install -r requirements.txt
python run_eval.py
```

Metrics tracked: faithfulness, answer relevancy, context precision, context recall.

---

## Status

Core pipeline is complete and working locally. Actively developing toward a hosted demo.
