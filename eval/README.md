# FundScope Evaluation Suite

RAGAS-based evaluation for the FundScope RAG pipeline.

## Setup

```bash
cd eval
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

## Configuration

Set these environment variables (or pass as CLI flags):

- `EVAL_USER_EMAIL` — Supabase auth email
- `EVAL_USER_PASSWORD` — Supabase auth password

The script also reads from `fundscope/.env.local` for Supabase connection details.

## Usage

```bash
# Run all 50 questions
python run_eval.py --fund-id <uuid> --email user@example.com --password pass123

# Run only simple_lookup questions
python run_eval.py --fund-id <uuid> --category simple_lookup

# Run first 5 questions (quick smoke test)
python run_eval.py --fund-id <uuid> --limit 5

# Custom base URL
python run_eval.py --fund-id <uuid> --base-url https://fundscope.vercel.app
```

## Golden Test Set

`golden_test_set.json` contains 50 PE fund domain questions across 5 categories:

| Category | Count | Description |
|----------|-------|-------------|
| simple_lookup | 15 | Single-fact retrieval (fees, terms, provisions) |
| comparison | 10 | Cross-document analysis |
| multi_hop | 10 | Multi-step reasoning across sections |
| edge_case | 10 | Missing terms, ambiguous clauses |
| general | 5 | Meta-questions, domain knowledge |

**Note:** `expected_answer` fields are placeholders. Populate them after ingesting real PE fund documents for accurate RAGAS scoring.

## Output

Results are saved to `eval/results/eval_<timestamp>.json` with:

- Per-question answers, latency, and status
- RAGAS metrics (faithfulness, answer_relevancy, context_precision)
- Summary statistics

## RAGAS Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| faithfulness | > 0.85 | Are claims supported by retrieved context? |
| answer_relevancy | > 0.80 | Is the answer relevant to the question? |
| context_precision | > 0.75 | Are retrieved chunks relevant? |
