# UI Polish + RAGAS Eval + Langfuse Tracing

## Phase 1: Langfuse Tracing
- [x] Create `src/lib/observability/langfuse.ts` — singleton client with graceful no-op
- [x] Add `experimental_telemetry` to all 13 AI SDK call sites:
  - [x] `agents/router.ts` → `route-query`
  - [x] `agents/grader.ts` → `grade-chunk`
  - [x] `agents/rewriter.ts` → `rewrite-query`
  - [x] `agents/generator.ts` → `generate-streaming-answer`
  - [x] `agents/generator.ts` → `generate-full-answer`
  - [x] `agents/checker.ts` → `check-hallucinations`
  - [x] `extraction/terms.ts` → `extract-terms`
  - [x] `extraction/obligations.ts` → `extract-obligations`
  - [x] `extraction/risks.ts` → `scan-risks`
  - [x] `rag/embeddings.ts` → `embed-chunks`
  - [x] `rag/embeddings.ts` → `embed-query`
  - [x] `rag/contextual.ts` → `context-summary`
- [x] Add manual Langfuse span for Cohere reranker
- [x] Add trace creation + flush to `api/chat/route.ts`

## Phase 2: RAGAS Evaluation Suite
- [x] Create `eval/requirements.txt`
- [x] Create `eval/golden_test_set.json` — 50 questions across 5 categories
- [x] Create `eval/run_eval.py` — CLI tool with auth, question runner, RAGAS metrics
- [x] Create `eval/README.md`
- [x] Verify `python run_eval.py --help` works

## Phase 3: Perry-Inspired UI Polish
- [x] Replace fonts: DM Sans (body) + DM Serif Display (headings) + Geist Mono (code)
- [x] Warm OKLCH color palette (light + dark themes)
- [x] Severity CSS variables (critical/high/medium/low/success)
- [x] `heading-serif` utility class + `animate-fade-in-up` animation
- [x] Collapsible icon sidebar (64px collapsed ↔ 240px expanded)
- [x] Auth layout: decorative Shield watermark, serif headings
- [x] Dashboard: serif headings, staggered card animations, hover effects
- [x] Fund detail: serif heading, severity-token processing badges
- [x] RiskDashboard: CSS variable severity colors throughout
- [x] ComparisonMatrix: warm deviation colors, warmer table headers
- [x] ChatInterface: serif empty state, teal focus ring

## Verification
- [x] `npx tsc --noEmit` — passes
- [x] `npm run build` — compiles + generates all 13 routes
- [x] `python run_eval.py --help` — shows usage

## Review
All three phases implemented and verified. The build passes cleanly with:
- 13 LLM call sites instrumented with Langfuse telemetry
- 1 manual span for Cohere reranker
- Top-level trace per chat request with user ID and flush
- 50-question golden test set with RAGAS evaluation runner
- Warm Perry-inspired UI with DM Serif/Sans fonts, OKLCH palette, collapsible sidebar
