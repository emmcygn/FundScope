# FundScope — Comprehensive Gate Testing Guide

Every stage has gate criteria that must ALL pass before the stage is considered complete. We built stages 0–8 but haven't verified any gates yet. This document is the single source of truth for running every test.

---

## Prerequisites

### Test Documents

You need real and synthetic PE fund documents. See `TEST_DOCUMENTS_GUIDE.md` for full details.

**Minimum viable test corpus (3 documents):**

| ID | Document | Source | Type |
|----|----------|--------|------|
| Doc A | ILPA Model LPA (Whole-of-Fund) | [ILPA website](https://ilpa.org/wp-content/uploads/2020/07/ILPA-Model-Limited-Partnership-Agreement-WOF.pdf) | LPA |
| Doc E | MEABF Sample Side Letter | [MEABF website](https://www.meabf.org/wp-content/uploads/2025/10/6.-MEABF-Sample-Side-Letter-7.22.2022.pdf) | Side Letter |
| Doc I | Basic NDA | [NDA template](https://nondisclosureagreement.com/wp-content/uploads/2020/11/Basic-Non-Disclosure-Agreement.pdf) | NDA |

**Recommended additions (synthetic — generate with Claude, save as PDF):**

| ID | Document | Purpose |
|----|----------|---------|
| Doc F | Synthetic side letter for "Acme Capital Partners III" | Known terms for golden test set verification |
| Doc H | Synthetic term sheet for "Granite Peak Capital Fund IV" | Cross-document comparison testing |

See `TEST_DOCUMENTS_GUIDE.md` Section 2 and Section 3 for the exact Claude prompts to generate these.

### Environment

1. `fundscope/.env.local` has all required keys (Supabase, Anthropic, OpenAI, Cohere, Langfuse)
2. Supabase project is running with schema deployed
3. App runs locally: `npm run dev` at `http://localhost:3000`
4. A test user account exists in Supabase Auth

### Conventions

- **PASS** = criterion met, record the evidence (screenshot, log output, value)
- **FAIL** = criterion not met, file a bug and fix before moving on
- **SKIP** = cannot test yet (document dependency, external service issue) — must revisit

---

## Stage 0: Project Scaffolding & Infrastructure

| # | Criterion | How to Test | Pass Condition |
|---|-----------|-------------|----------------|
| 0.1 | Dev server starts | Run `npm run dev`. Open `http://localhost:3000` in browser. | Page loads without crash. |
| 0.2 | TypeScript strict mode compiles | Run `npx tsc --noEmit`. | Exit code 0, zero errors. |
| 0.3 | Supabase connection works | Create a temporary API route that runs `select now()` via Supabase client, hit it with curl, then delete the route. **Or**: verify any existing API route (e.g., `GET /api/funds`) returns a valid response when authenticated. | Returns a timestamp or valid JSON, not a connection error. |
| 0.4 | All 8 database tables exist | Open Supabase Dashboard → Table Editor. | Tables visible: `funds`, `documents`, `chunks`, `extracted_terms`, `obligations`, `risk_flags`, `chat_sessions`, `chat_messages`. |
| 0.5 | RLS is active on all tables | Supabase Dashboard → each table → shows "RLS enabled" badge. | All 8 tables have RLS enabled. |
| 0.6 | Storage bucket exists | Supabase Dashboard → Storage. | Bucket named `documents` is present. |
| 0.7 | Environment variables are set | Run `npx tsx scripts/check-env.ts` (loads `.env.local`). | Script prints "All required environment variables are set". |
| 0.8 | shadcn/ui components render | Visit any page with shadcn components (e.g., `/login`). | Buttons, cards, inputs render with correct styling (not unstyled HTML). |

### How to run all Stage 0 gates:

```bash
cd fundscope

# 0.1 + 0.8: Start dev server and check pages
npm run dev
# Visit http://localhost:3000/login — should see styled login card

# 0.2: TypeScript check
npx tsc --noEmit

# 0.7: Environment check
npx tsx scripts/check-env.ts

# 0.3–0.6: Manual checks in Supabase Dashboard
# Go to your Supabase project URL → Table Editor, Storage
```

---

## Stage 1: Document Ingestion Pipeline

**Prerequisite**: Download at least Doc A (ILPA Model LPA) as a PDF.

| # | Criterion | How to Test | Pass Condition |
|---|-----------|-------------|----------------|
| 1.1 | PDF parsing works on a real legal document | Upload Doc A via the UI (`/funds/[id]` → Documents tab → Upload PDF). Check server logs. **Or** write a test script that calls `parsePdf()` directly. | Output shows realistic page count (50+), non-empty text, recognizable legal language. |
| 1.2 | Chunking produces reasonable chunks | After upload, query Supabase: `SELECT COUNT(*), AVG(LENGTH(text)) FROM chunks WHERE document_id = '<id>'`. | Chunk count proportional to document length (100–350 for a large LPA). Average text length 500–3000 chars. No empty chunks. |
| 1.3 | Contextual enrichment runs | Query: `SELECT text FROM chunks WHERE document_id = '<id>' LIMIT 3`. | Each chunk's text starts with `[Context: ...]` mentioning document type and section. Context is specific, not generic. |
| 1.4 | Embeddings are generated correctly | Query: `SELECT id, embedding IS NOT NULL as has_embedding, array_length(embedding, 1) as dims FROM chunks WHERE document_id = '<id>' LIMIT 5`. | All chunks have non-null embeddings with exactly 1024 dimensions. |
| 1.5 | Full pipeline stores chunks in Supabase | After upload completes, check document status: `SELECT processing_status FROM documents WHERE id = '<id>'`. | Status is `'ready'`. Chunks exist with embeddings, page numbers, and context summaries. |
| 1.6 | Error handling works | Upload a non-PDF file (rename a .txt to .pdf) or an empty file. | Document row shows `processing_status = 'error'` and `processing_error` has a human-readable message. |

### How to run all Stage 1 gates:

```bash
# Start the dev server
npm run dev

# 1. Sign in at http://localhost:3000/login
# 2. Create a fund (e.g., "Test Fund Alpha")
# 3. Navigate to the fund → Documents tab
# 4. Upload the ILPA Model LPA PDF
# 5. Wait for processing (watch server logs for progress)

# Once processing completes, run these Supabase SQL queries in the SQL Editor:

-- Get the document ID
SELECT id, name, processing_status, page_count FROM documents ORDER BY created_at DESC LIMIT 1;

-- 1.2: Check chunk stats (replace <doc_id>)
SELECT COUNT(*) as chunk_count,
       AVG(LENGTH(text)) as avg_text_length,
       MIN(LENGTH(text)) as min_text_length
FROM chunks WHERE document_id = '<doc_id>';

-- 1.3: Check contextual enrichment
SELECT LEFT(text, 200) as text_preview FROM chunks
WHERE document_id = '<doc_id>' ORDER BY chunk_index LIMIT 3;

-- 1.4: Check embeddings
SELECT id,
       embedding IS NOT NULL as has_embedding
FROM chunks WHERE document_id = '<doc_id>' LIMIT 5;

-- 1.6: Upload a corrupt file and check
SELECT processing_status, processing_error FROM documents
WHERE name LIKE '%corrupt%' OR processing_status = 'error';
```

---

## Stage 2: Hybrid Search + Basic Chat

**Prerequisite**: Stage 1 passed. At least one document is ingested with status `'ready'`.

| # | Criterion | How to Test | Pass Condition |
|---|-----------|-------------|----------------|
| 2.1 | Dense search returns relevant results | Go to fund → Chat tab. Ask: "What is the management fee?" | At least 3 of top 5 retrieved chunks (visible in server logs or via Langfuse) mention fees, percentages, or management compensation. |
| 2.2 | BM25 search finds exact terms | Ask: "Section 4.2" or a specific defined term from the LPA (e.g., "Limited Partner Advisory Committee"). | Top result contains the exact text from that section. |
| 2.3 | Hybrid search outperforms either alone | Run 5 different queries. Compare quality of answers. | Answers reference specific sections and page numbers. Responses feel relevant and precise. |
| 2.4 | Re-ranking improves result quality | Ask a nuanced query (e.g., "What happens when the GP is removed without cause?"). Check Langfuse trace for reranking. | Cohere reranker trace shows it ran. Top result after reranking is more relevant than before (or graceful degradation if no Cohere key). |
| 2.5 | Chat streaming works | Ask any question. Watch the response appear. | Response appears progressively (word-by-word streaming), not all at once. Response cites specific `[Source N]` with pages. |
| 2.6 | Chat refuses to hallucinate | Ask: "What is the fund's cryptocurrency allocation policy?" (not in ILPA LPA). | Response says "I don't have enough information" or similar — does NOT fabricate a crypto policy. |
| 2.7 | No fund context yields helpful message | Open chat without selecting a fund, or on a fund with no documents. Send "Hello". | Response tells user to upload documents. No crash, no hallucination. |

### How to run all Stage 2 gates:

```
1. Navigate to your test fund → Chat tab
2. Ask each question from the table above, one at a time
3. Record the response for each
4. For 2.6: Ask the hallucination-trap question and verify the refusal
5. For 2.7: Create an empty fund (no documents), go to its chat, send a message
```

---

## Stage 3: Agentic RAG with Self-Correction

**Prerequisite**: Stage 2 passed.

| # | Criterion | How to Test | Pass Condition |
|---|-----------|-------------|----------------|
| 3.1 | Router correctly classifies query types | Ask these questions and check the `x-query-type` response header or Langfuse trace: `"What is the management fee?"` → `simple_lookup`. `"Hello, what can you do?"` → `general`. | Each query is classified to the correct type. |
| 3.2 | Grader filters irrelevant chunks | Ask a specific question. Check Langfuse trace or server logs for grading results. | Logs show relevant/irrelevant split. At least some chunks are filtered out as irrelevant. |
| 3.3 | Query rewriting triggers on poor results | Ask a question using unusual phrasing: "What's the GP's cut of the upside?" (colloquial for carried interest). | Server logs show `"rewriting query..."`. The rewritten query uses formal terms like "carried interest". |
| 3.4 | Hallucination checker catches fabricated claims | Ask a factual question. Check Langfuse trace for the checker span. | Checker runs and marks the answer as `overallSupported: true` (or catches unsupported claims if any). |
| 3.5 | Self-correction loop has maximum depth | Check server logs across multiple queries. | No query triggers more than 2 rewrite retries. System always returns a response (never hangs). |
| 3.6 | UI shows "thinking" states | Ask a question. Watch the chat interface during processing. | Loading spinner or "thinking" indicator appears while processing. User never sees a blank screen during the agentic loop. |

### How to run all Stage 3 gates:

```
1. Open browser DevTools → Network tab to see response headers (x-query-type)
2. Open Langfuse dashboard in another tab to watch traces
3. Ask each question from the table
4. For 3.3: Use deliberately colloquial phrasing
5. For 3.5: Ask 5+ different questions, check logs show max 2 retries
6. For 3.6: Watch the UI closely during each question
```

---

## Stage 4: Structured Extraction + Comparison

**Prerequisite**: At least one document ingested and ready. Ideally two documents (for comparison).

| # | Criterion | How to Test | Pass Condition |
|---|-----------|-------------|----------------|
| 4.1 | Extraction finds management fee in sample LPA | Go to fund → Extraction tab → click "Extract Terms" on the ingested LPA. Check `extracted_terms` table in Supabase. | `term_type = 'management_fee'` row exists with a reasonable `term_value`. |
| 4.2 | Confidence scores are calibrated | Check `extracted_terms` for the document. | Explicit terms (management_fee, carried_interest) have confidence > 0.8. Less clear terms have lower confidence. No term has confidence exactly 1.0 or 0.0. |
| 4.3 | Missing terms are handled gracefully | Check `extracted_terms`. | Terms not present in the document (e.g., `recycling_provision` if not in the LPA) are simply absent from the table, not fabricated. |
| 4.4 | Comparison matrix shows correct deviations | Upload two documents with different fee structures. Go to comparison view (if available) or query `extracted_terms` for both. | Terms with values outside market standard ranges have `is_market_standard = false` and non-null `deviation_notes`. |
| 4.5 | Source citations are verifiable | For 5 extracted terms, check `source_page` and `source_text`. Open the PDF and verify. | The quoted `source_text` actually appears on the stated `source_page` in the PDF. |

### How to run all Stage 4 gates:

```bash
# 1. Navigate to fund → Extraction tab
# 2. Click "Extract Terms" on a ready document
# 3. Wait for extraction to complete (toast notification)

# Then verify in Supabase SQL Editor:

-- 4.1: Check management fee extraction
SELECT term_type, term_value, confidence, source_page, source_clause
FROM extracted_terms WHERE document_id = '<doc_id>'
ORDER BY term_type;

-- 4.2: Check confidence distribution
SELECT term_type, confidence FROM extracted_terms
WHERE document_id = '<doc_id>'
ORDER BY confidence DESC;

-- 4.4: Check market deviation flags
SELECT term_type, term_value, is_market_standard, deviation_notes
FROM extracted_terms
WHERE document_id = '<doc_id>' AND is_market_standard = false;

-- 4.5: Check source citations (manually verify 5 against the PDF)
SELECT term_type, source_page, source_clause, LEFT(source_text, 100) as source_preview
FROM extracted_terms WHERE document_id = '<doc_id>'
LIMIT 5;
```

---

## Stage 5: Obligation Tracking + Risk Dashboard

**Prerequisite**: Stage 4 passed. Terms extracted for at least one document.

| # | Criterion | How to Test | Pass Condition |
|---|-----------|-------------|----------------|
| 5.1 | Obligations are extracted with correct descriptions | Go to fund → Extraction tab → click "Extract Obligations" on a ready document. Query `obligations` table. | Obligations exist with descriptions matching real provisions in the document (reporting deadlines, notice periods, etc.). |
| 5.2 | Recurring obligations are identified | Check `recurrence` field in `obligations` table. | Quarterly reporting has `recurrence = 'quarterly'`. Annual meeting has `recurrence = 'annually'`. One-time items have `recurrence = 'one_time'`. |
| 5.3 | Risk flags are generated for off-market terms | Go to fund → Risks tab → click "Run Risk Analysis". Query `risk_flags` table. | At least one risk flag exists. If a term is non-standard, a `non_standard_term` or `missing_clause` flag is generated. |
| 5.4 | Dashboard aggregates correctly | Call the risk summary API or check the Risks tab UI. | Fund-level risk score (0–100) increases when more high-severity flags are present. Score of 0 only when no flags exist. |
| 5.5 | Obligation status can be updated | In the risk dashboard UI, click "Complete" or "Waive" on an obligation. | Obligation status changes in the database. UI updates to reflect the new status. |

### How to run all Stage 5 gates:

```bash
# 1. Navigate to fund → Extraction tab
# 2. Click "Extract Obligations" on a ready document
# 3. Navigate to fund → Risks tab
# 4. Click "Run Risk Analysis" on a ready document
# 5. Observe the Risk Dashboard (if integrated)

# Verify in Supabase:

-- 5.1: Check obligations
SELECT description, responsible_party, category, priority, recurrence, due_description
FROM obligations WHERE document_id = '<doc_id>'
ORDER BY priority;

-- 5.2: Check recurrence patterns
SELECT description, recurrence FROM obligations
WHERE document_id = '<doc_id>' AND recurrence != 'one_time';

-- 5.3: Check risk flags
SELECT category, severity, title, description
FROM risk_flags WHERE document_id = '<doc_id>'
ORDER BY severity;

-- 5.4: Check aggregate score (sum severity weights)
SELECT
  COUNT(*) as total_flags,
  COUNT(*) FILTER (WHERE severity = 'critical') as critical,
  COUNT(*) FILTER (WHERE severity = 'high') as high,
  COUNT(*) FILTER (WHERE severity = 'medium') as medium,
  COUNT(*) FILTER (WHERE severity = 'low') as low
FROM risk_flags WHERE fund_id = '<fund_id>';
```

---

## Stage 6: PDF Annotation Viewer

**Prerequisite**: Stage 5 passed. Risk flags exist for at least one document.

| # | Criterion | How to Test | Pass Condition |
|---|-----------|-------------|----------------|
| 6.1 | PDF renders correctly | Navigate to the PDF viewer for an uploaded document. | All pages display. Text is readable. No rendering artifacts. |
| 6.2 | Risk highlights appear on correct text | View a document that has risk flags. Look for colored highlights. | At least one highlight overlay appears on the text that matches a risk flag's `source_text`. |
| 6.3 | Click-to-scroll works (citation → PDF) | In the chat, get a response with `[Source N]` citations. Click one. | PDF viewer scrolls to and highlights the referenced section. |
| 6.4 | Highlight popovers show analysis | Click a risk highlight in the PDF viewer. | Popover shows: risk category, severity, description, and recommendation. |

### How to run all Stage 6 gates:

```
1. Navigate to a fund with a processed document that has risk flags
2. Open the PDF viewer (if accessible from the document list or a dedicated tab)
3. Visually inspect for highlights
4. Click a highlight → check popover content
5. Go to Chat tab → ask a question → click a [Source N] citation → verify PDF scrolls
```

**Note**: If the PDF viewer is not yet integrated into the main UI flow, this stage may need a dedicated page or component mount to test.

---

## Stage 7: Auth, Polish, and Deployment

| # | Criterion | How to Test | Pass Condition |
|---|-----------|-------------|----------------|
| 7.1 | Can sign up, log in, log out | 1. Go to `/signup`, create a new account. 2. Go to `/login`, sign in. 3. Click "Sign out" in sidebar. | All three actions complete successfully. Redirects work correctly. |
| 7.2 | User A cannot see User B's data | Create two accounts. Upload a document under User 1. Log in as User 2. | User 2 sees zero funds. Cannot access User 1's fund by URL. |
| 7.3 | App is deployed and accessible | Visit the Vercel deployment URL (if deployed). | All features work: auth, upload, chat, extraction, risk dashboard. |
| 7.4 | No console errors in production | Open browser DevTools → Console. Navigate through: login → dashboard → fund → each tab. | Zero JavaScript errors. Warnings are acceptable. |
| 7.5 | Core user flow completes in under 30 seconds | Time the flow: Sign in → Create fund → Navigate to fund. (Exclude upload processing time.) | Under 30 seconds for the interactive steps. |

### How to run all Stage 7 gates:

```
1. Open an incognito window
2. Go to /signup → create account → verify redirect to /login
3. Log in → verify redirect to dashboard
4. Create a fund → navigate to it
5. Click Sign out → verify redirect to /login
6. For 7.2: Open another incognito window, create second account, verify isolation
7. For 7.4: Keep DevTools Console open throughout all navigation
```

---

## Stage 8: Evaluation Suite + Documentation

| # | Criterion | How to Test | Pass Condition |
|---|-----------|-------------|----------------|
| 8.1 | Golden test set has 50+ questions | `python -c "import json; d=json.load(open('eval/golden_test_set.json')); print(len(d['questions']))"` | Output: 50 or more. |
| 8.2 | Evaluation script runs end-to-end | `python eval/run_eval.py --fund-id <id> --email <email> --password <pass> --limit 3` | Script authenticates, sends 3 questions, prints results table, saves JSON. No crashes. |
| 8.3 | Faithfulness score > 0.85 | Run full eval with populated expected answers: `python eval/run_eval.py --fund-id <id>` | RAGAS faithfulness metric ≥ 0.85. (Requires populated `expected_answer` fields.) |
| 8.4 | Hallucination rate < 10% | From eval results, count questions where the system provided unsupported claims. | < 10% of responses contain fabricated information. |
| 8.5 | Langfuse shows traces | Open Langfuse dashboard after sending several chat messages. | At least 10 traces visible with spans for: `route-query`, `grade-chunk`, `generate-*`, `check-hallucinations`, `cohere-rerank`. |
| 8.6 | README has architecture diagram | Open `README.md` on GitHub. | Mermaid diagram renders showing system architecture. |
| 8.7 | DECISIONS.md has at least 8 entries | Check `docs/DECISIONS.md`. | At least 8 technology decisions with alternatives considered and tradeoffs. |

### How to run all Stage 8 gates:

```bash
# 8.1: Count questions
python -c "import json; d=json.load(open('eval/golden_test_set.json')); print(f'Questions: {len(d[\"questions\"])}')"

# 8.2: Quick smoke test (3 questions)
python eval/run_eval.py --fund-id <FUND_UUID> --email <your_email> --password <your_pass> --limit 3

# 8.3 + 8.4: Full eval (requires populated expected_answer fields in golden_test_set.json)
# First populate answers after ingesting real documents, then:
python eval/run_eval.py --fund-id <FUND_UUID> --email <your_email> --password <your_pass>

# 8.5: Open Langfuse dashboard and verify traces
# URL: https://cloud.langfuse.com (or your self-hosted URL)

# 8.6 + 8.7: These are documentation tasks — check files exist and have content
```

---

## Final End-to-End Integration Tests

These are the ultimate acceptance tests. ALL must pass for the project to be considered complete.

| # | Test | Steps | Pass Condition |
|---|------|-------|----------------|
| E2E-1 | Full user flow | New user signs up → creates fund → uploads LPA → asks "What is the management fee?" | Correct answer with `[Source N]` citation pointing to the right page. |
| E2E-2 | Cross-document comparison | Upload two documents with different fee structures → run extraction on both → view comparison. | Comparison shows both fees. Market deviations are flagged with colors. |
| E2E-3 | Hallucination resistance | Ask: "What is the fund's cryptocurrency allocation policy?" (not in any uploaded document). | System responds with "I don't have enough information" — does NOT fabricate. |
| E2E-4 | Large document ingestion | Upload a 100+ page document (ILPA Model LPA). Wait for processing. | Completes within 5 minutes. All chunks have embeddings. Status is `'ready'`. |
| E2E-5 | Multi-hop reasoning | Ask: "If a key person event occurs, what obligations are triggered and within what timeframes?" | Answer synthesizes information from multiple sections. All sources cited. |
| E2E-6 | PDF viewer + citations | View uploaded PDF. See risk highlights. Click a `[Source N]` citation from chat. | PDF scrolls to the correct location. Highlights are visible on the right text. |
| E2E-7 | RLS isolation | Log in as User A. Cannot see User B's funds, documents, or chat history. | Complete data isolation between users. |
| E2E-8 | Evaluation metrics | Run full eval suite. | Faithfulness > 0.85. Hallucination rate < 10%. |
| E2E-9 | Production deployment | Visit Vercel URL. Complete E2E-1 flow on production. | All features work in the deployed environment. |
| E2E-10 | Demo video | Record a 2-minute video showing core features. | Video exists and demonstrates: upload → chat → extraction → comparison → risk dashboard. |

---

## Test Execution Tracker

Use this checklist to track progress. Update status as you complete each gate.

### Stage 0
- [ ] 0.1 Dev server starts
- [ ] 0.2 TypeScript compiles
- [ ] 0.3 Supabase connection works
- [ ] 0.4 All 8 tables exist
- [ ] 0.5 RLS active on all tables
- [ ] 0.6 Storage bucket exists
- [ ] 0.7 Environment variables set
- [ ] 0.8 shadcn/ui renders

### Stage 1
- [ ] 1.1 PDF parsing works
- [ ] 1.2 Chunking produces reasonable chunks
- [ ] 1.3 Contextual enrichment runs
- [ ] 1.4 Embeddings generated correctly
- [ ] 1.5 Full pipeline stores in Supabase
- [ ] 1.6 Error handling works

### Stage 2
- [ ] 2.1 Dense search returns relevant results
- [ ] 2.2 BM25 finds exact terms
- [ ] 2.3 Hybrid search quality
- [ ] 2.4 Re-ranking improves results
- [ ] 2.5 Chat streaming works
- [ ] 2.6 Chat refuses to hallucinate
- [ ] 2.7 No fund context handled

### Stage 3
- [ ] 3.1 Router classifies correctly
- [ ] 3.2 Grader filters irrelevant chunks
- [ ] 3.3 Query rewriting triggers
- [ ] 3.4 Hallucination checker works
- [ ] 3.5 Self-correction loop bounded
- [ ] 3.6 UI shows thinking states

### Stage 4
- [ ] 4.1 Extraction finds management fee
- [ ] 4.2 Confidence scores calibrated
- [ ] 4.3 Missing terms handled
- [ ] 4.4 Comparison shows deviations
- [ ] 4.5 Source citations verifiable

### Stage 5
- [ ] 5.1 Obligations extracted correctly
- [ ] 5.2 Recurring obligations identified
- [ ] 5.3 Risk flags generated
- [ ] 5.4 Dashboard aggregates correctly
- [ ] 5.5 Obligation status updatable

### Stage 6
- [ ] 6.1 PDF renders correctly
- [ ] 6.2 Risk highlights on correct text
- [ ] 6.3 Click-to-scroll works
- [ ] 6.4 Highlight popovers show analysis

### Stage 7
- [ ] 7.1 Sign up / log in / log out
- [ ] 7.2 User isolation (RLS)
- [ ] 7.3 Deployed and accessible
- [ ] 7.4 No console errors
- [ ] 7.5 Core flow under 30 seconds

### Stage 8
- [ ] 8.1 Golden test set 50+ questions
- [ ] 8.2 Eval script runs end-to-end
- [ ] 8.3 Faithfulness > 0.85
- [ ] 8.4 Hallucination rate < 10%
- [ ] 8.5 Langfuse shows traces
- [ ] 8.6 README has architecture diagram
- [ ] 8.7 DECISIONS.md has 8+ entries

### End-to-End
- [ ] E2E-1 Full user flow
- [ ] E2E-2 Cross-document comparison
- [ ] E2E-3 Hallucination resistance
- [ ] E2E-4 Large document ingestion
- [ ] E2E-5 Multi-hop reasoning
- [ ] E2E-6 PDF viewer + citations
- [ ] E2E-7 RLS isolation
- [ ] E2E-8 Evaluation metrics
- [ ] E2E-9 Production deployment
- [ ] E2E-10 Demo video

---

## Document Processing Benchmarks

Use these to verify ingestion is working at the right scale:

| Document | Expected Pages | Expected Chunks (~800 tokens) | Processing Time (est.) |
|----------|---------------|-------------------------------|----------------------|
| ILPA Model LPA (WOF) | ~130–180 | 200–350 | 3–5 minutes |
| ILPA Model LPA (DBD) | ~120–160 | 180–300 | 3–5 minutes |
| SEC EDGAR LPA (ISP Fund) | ~30–50 | 50–100 | 1–2 minutes |
| Synthetic Side Letter | ~8–10 | 15–25 | 30–60 seconds |
| Synthetic Term Sheet | ~4–5 | 8–15 | 20–40 seconds |
| NDA | ~2–3 | 5–10 | 15–30 seconds |

If chunk counts are wildly outside these ranges, the chunking strategy needs investigation.

---

## Known Gaps & Deferred Items

These are items identified during planning that are NOT yet testable:

| Item | Why Deferred | When to Revisit |
|------|-------------|-----------------|
| 8.3 Faithfulness > 0.85 | Requires populated `expected_answer` fields in golden test set | After ingesting real documents and populating answers |
| 8.4 Hallucination rate < 10% | Same as above | Same as above |
| 8.6 README architecture diagram | README not yet written with Mermaid | Documentation phase |
| 8.7 DECISIONS.md | Not yet created | Documentation phase |
| E2E-9 Production deployment | Not yet deployed to Vercel | After all other E2E tests pass |
| E2E-10 Demo video | Final deliverable | After production deployment |
