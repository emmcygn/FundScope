## Workflow Orchestration
### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity
### 2. Subagent Strategy
- Use
subagents liberally to keep main contect window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problens, throw more compute at it via subagents
- One tack per subagent for focused execution
### 3. Self-Improvement Loop
- After ANY correction from the user: update 'tasks/lessons md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness
### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, chvious fixes - don't over-engineer
- Challenge your own work before presenting it
### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management
6. **Capture Lessons**:
Update 'tasks/lessons.md after corrections
## Core Principles
- **Simplicity First**: Make every change as simple as possible. Inpact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

1. **Plan First**; Write plan to 'tasks/todo.md' with checkable items
2. 
**Verify Plan**: Check in before starting implementation
3. 
**Trade-off and Risk**: Always include a trade-off and risk audit in your check in for users to give guidance
4. 
**Track Progress**: Mark items complete as you go
5. 
**Explain Changes**: High-level summary at each step
6. 
**Document Results**: Add review section to 'tasks/todo.md

# FundScope — Project Context

## Project Overview

FundScope is a production-grade legaltech RAG platform for private equity fund documentation analysis. It ingests LPAs, side letters, and term sheets, then provides AI-powered contract review, structured term extraction, cross-document comparison, obligation tracking, and risk analysis — all with verifiable citations back to exact document locations.

This is a portfolio project targeting Perry AI (useperry.com) for a job application. Every feature and design decision should demonstrate both technical depth and deep understanding of the PE fund legal domain.

## Human Context

The developer building this project is relatively new to TypeScript and the Node.js ecosystem. When implementing features:
- Explain non-obvious TypeScript patterns with brief inline comments
- Prefer explicit types over inferred types so the code serves as documentation
- When a library has multiple ways to accomplish something, use the most readable approach
- If a pattern is idiomatic in TS/Node but might confuse a newcomer (e.g., currying, complex generics), add a comment explaining what it does and why

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 14+ (App Router) | All routes in `src/app/`. Use Server Components by default, `'use client'` only when needed. |
| AI SDK | Vercel AI SDK (`ai` package) | Use `streamText()` for chat, `generateText()` for non-streaming, `generateObject()` for structured extraction. |
| Primary LLM | Claude Sonnet via `@ai-sdk/anthropic` | Use for all answer generation, risk analysis, and complex extraction. Model string: `claude-sonnet-4-20250514`. |
| Secondary LLM | GPT-4o-mini via `@ai-sdk/openai` | Use for query routing, relevance grading, and lightweight classification. Cheaper and faster. |
| Embeddings | OpenAI `text-embedding-3-large` | 1024 dimensions. Use via `embed()` and `embedMany()` from `ai` package. |
| Database | Supabase (Postgres + pgvector) | Use `@supabase/ssr` for server-side client. Use secret key for background processing only. |
| Auth | Supabase Auth | Email/password only. RLS on all tables. Middleware redirects unauthenticated users. |
| Storage | Supabase Storage | Bucket: `documents`. Path format: `{userId}/{fundId}/{uuid}.pdf`. |
| Re-ranking | Cohere Rerank API | `rerank-english-v3.0` model. Graceful fallback if API key not set. |
| Observability | Langfuse | Trace all LLM calls, search operations, and pipeline steps. |
| UI | shadcn/ui + Tailwind CSS | Use shadcn components for all UI. No custom CSS unless absolutely necessary. |
| PDF Viewing | react-pdf-highlighter-extended | For annotated PDF display with clickable highlights. |
| Validation | Zod | All API inputs, LLM structured outputs, and extraction schemas use Zod. |
| Eval | RAGAS metrics (Python script in `eval/`) | Golden test set (50+ Q&A pairs) in `eval/golden_test_set.json`. |
| Deployment | Vercel | Free tier for demo, Pro if needed for longer API routes. |

## Project Structure

```
src/
├── app/                    # Next.js pages and API routes
│   ├── (auth)/             # Login/signup pages (unprotected)
│   ├── (dashboard)/        # Main app pages (protected by middleware)
│   └── api/                # API endpoints
├── lib/                    # Business logic (NO React, NO client-side code)
│   ├── supabase/           # Database clients
│   ├── rag/                # RAG pipeline (chunking, embedding, search, reranking)
│   ├── extraction/         # Structured extraction (terms, obligations, risks)
│   ├── agents/             # Agentic components (router, grader, generator, checker)
│   ├── pdf/                # PDF parsing and annotation mapping
│   └── utils/              # Errors, constants, logger
├── components/             # React components (ONLY client-side code)
│   ├── ui/                 # shadcn/ui base components
│   ├── chat/               # Chat interface components
│   ├── documents/          # Upload and PDF viewer components
│   ├── dashboard/          # Risk dashboard, comparison matrix, obligation tracker
│   └── layout/             # Sidebar, header, providers
└── types/                  # TypeScript type definitions
```

## Key Rules

### Code Quality
- TypeScript strict mode is ON. Never use `any` without a comment explaining why.
- Every function that calls an external service (LLM, database, file I/O, external API) MUST have try/catch with a meaningful error message.
- No `console.log` in production code. Use `console.warn` for non-fatal issues and `console.error` for errors. Use Langfuse tracing for observability.
- All API routes must validate input with Zod before processing.
- All API routes must check authentication before doing anything else.

### Architecture
- `src/lib/` contains ONLY server-side logic. No React imports. No `'use client'`.
- `src/components/` contains ONLY React components. No direct database access. Components call API routes or receive data as props from Server Components.
- API routes in `src/app/api/` are the bridge between frontend and backend logic.
- Use Server Components (the default) to fetch data. Use Client Components (`'use client'`) only for interactivity (forms, state, effects).

### RAG Pipeline
- ALWAYS use hybrid search (dense + BM25) for retrieval. Never dense-only.
- ALWAYS re-rank results before passing to the generator (graceful degradation if Cohere is unavailable).
- The generator MUST only use information from retrieved context. The system prompt must explicitly instruct the model to say "I don't have enough information" rather than hallucinate.
- Every claim in a generated response must have a `[Source N]` citation that maps to a specific chunk, page number, and section.
- The agentic loop (grade → rewrite → retry) must have a maximum of 2 retries to prevent infinite loops.

### PE Fund Domain
- Use correct terminology: LPA (Limited Partnership Agreement), GP (General Partner), LP (Limited Partner), carry (carried interest), hurdle rate (preferred return), MFN (Most Favored Nation).
- Market standard ranges are defined in `src/lib/utils/constants.ts` — use these for deviation flagging.
- Document types are: `lpa`, `side_letter`, `term_sheet`, `sub_agreement`, `ppm`, `nda`, `other`.
- Obligation categories are: `reporting`, `capital_call`, `distribution`, `consent`, `mfn_election`, `key_person`, `annual_meeting`, `tax`, `regulatory`, `notification`.

### Testing
- No mocking LLM responses to make tests pass. Tests should call real APIs (or be clearly marked as integration tests that need API keys).
- Evaluation metrics (RAGAS) are the primary quality measure. Maintain faithfulness > 0.85 and hallucination rate < 10%.
- The golden test set in `eval/golden_test_set.json` is the source of truth for quality. Every code change that touches the RAG pipeline should be validated against it.

### Database
- NEVER bypass RLS. Use the secret key ONLY for background processing (document ingestion, extraction) where the user context isn't available in the request.
- All user-facing queries go through the publishable key with RLS enforcing access control.
- Embeddings are stored as `vector(1024)` in the `chunks` table.
- The `match_chunks` RPC function handles vector similarity search. If you need to modify it, update the SQL in `supabase/migrations/` and re-run in the SQL editor.

### UI
- Use shadcn/ui components for everything. Don't rebuild what shadcn provides.
- The color palette should feel professional and legal: neutral/slate tones with subtle accent colors. Not playful. Not startup-y.
- All async operations need loading states (use Skeleton components from shadcn).
- All error states need user-friendly messages (not raw error strings).
- Empty states should guide the user to the next action ("Upload your first document to get started").

## Data Model

Core entities: `funds` → `documents` → `chunks` (with embeddings) → `extracted_terms`, `obligations`, `risk_flags`

Document types: LPA, SideLetter, TermSheet, SubAgreement

## Implementation Stages

This project is built in 8 sequential stages. Each stage has explicit gate criteria that must ALL pass before moving to the next stage. See `IMPLEMENTATION_GUIDE.md` for the complete stage-by-stage guide.

**Stage 0:** Project scaffolding, Supabase setup, database schema
**Stage 1:** PDF ingestion pipeline (parse → chunk → enrich → embed → store)
**Stage 2:** Hybrid search + basic streaming chat
**Stage 3:** Agentic RAG (routing, grading, rewriting, hallucination checking)
**Stage 4:** Structured extraction + cross-document comparison
**Stage 5:** Obligation tracking + risk dashboard
**Stage 6:** PDF annotation viewer with bidirectional citation linking
**Stage 7:** Auth, UI polish, deployment
**Stage 8:** Evaluation suite, Langfuse tracing, documentation

DO NOT skip stages. DO NOT start Stage N+1 until ALL gate criteria for Stage N pass.

## Common Patterns

### Making an LLM call for structured output
```typescript
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const schema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
})

const { object } = await generateObject({
  model: anthropic('claude-sonnet-4-20250514'),
  schema,
  prompt: 'Your prompt here',
})
// object is fully typed: { answer: string, confidence: number }
```

### Making a streaming chat response
```typescript
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'

const result = streamText({
  model: anthropic('claude-sonnet-4-20250514'),
  system: 'System prompt here',
  messages, // from request body
})

return result.toDataStreamResponse()
```

### Querying Supabase with RLS (server component or API route)
```typescript
import { createServerSupabaseClient } from '@/lib/supabase/server'

const supabase = await createServerSupabaseClient()
const { data, error } = await supabase
  .from('funds')
  .select('*')
  .order('created_at', { ascending: false })
// RLS automatically filters to current user's funds
```

### Background processing with admin client (bypasses RLS)
```typescript
import { createAdminClient } from '@/lib/supabase/server'

const admin = createAdminClient()
// Use ONLY for ingestion pipeline, extraction, and other background tasks
// NEVER for user-facing queries
```

## Environment Variables

Required:
- `ANTHROPIC_API_KEY` — Claude API access
- `OPENAI_API_KEY` — Embeddings + GPT-4o-mini for lightweight tasks
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key (client-side safe, replaces legacy anon key)
- `SUPABASE_SECRET_KEY` — Supabase secret key (server-side only, NEVER expose to client, replaces legacy service_role key)

Optional (graceful degradation if missing):
- `COHERE_API_KEY` — Re-ranking (falls back to original ranking if missing)
- `LANGFUSE_PUBLIC_KEY` — Observability (tracing disabled if missing)
- `LANGFUSE_SECRET_KEY` — Observability
- `NEXT_PUBLIC_LANGFUSE_HOST` — Langfuse endpoint

## Deployment

Target: Vercel (free tier for demo, Pro if needed for longer API routes).

Key Vercel settings:
- Set `maxDuration` on long-running API routes (upload: 300s, chat: 60s, extract: 120s)
- All environment variables must be set in Vercel project settings
- The Supabase project must allow connections from Vercel's IP ranges (default: all IPs allowed)

## Files to Never Modify Without Understanding

- `src/middleware.ts` — Auth routing. Changes here break the entire auth flow.
- `supabase/migrations/*.sql` — Schema changes require careful migration. Never edit an existing migration; create a new one.
- `src/lib/utils/constants.ts` — Market standard ranges. Only modify with PE domain knowledge.
- `.env.local` — Contains secrets. Never commit to git.

## Git Conventions

- Commit after each working stage gate
- Branch naming: `stage-N/brief-description` (e.g., `stage-1/ingestion-pipeline`)
- Commit messages: `stage N: description` (e.g., `stage 1: implement PDF parsing and chunking`)
- Tag each completed stage: `v0.N` (e.g., `v0.1` after Stage 1)
