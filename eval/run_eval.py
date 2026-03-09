#!/usr/bin/env python3
"""
FundScope RAGAS Evaluation Suite

Runs golden test set questions against the FundScope chat API and computes
RAGAS metrics (faithfulness, answer_relevancy, context_precision).

Usage:
    python run_eval.py --fund-id <uuid> --base-url http://localhost:3000
    python run_eval.py --help
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# Load env from parent fundscope/.env.local
env_path = Path(__file__).resolve().parent.parent / ".env.local"
load_dotenv(env_path)


def authenticate(base_url: str, email: str, password: str) -> str:
    """Authenticate with Supabase and return the access token."""
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")

    if not supabase_url or not supabase_key:
        print("Error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set")
        sys.exit(1)

    resp = requests.post(
        f"{supabase_url}/auth/v1/token?grant_type=password",
        headers={
            "apikey": supabase_key,
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
    )

    if resp.status_code != 200:
        print(f"Authentication failed: {resp.status_code} {resp.text}")
        sys.exit(1)

    return resp.json()["access_token"]


def ask_question(
    base_url: str, question: str, fund_id: str, access_token: str
) -> dict:
    """Send a question to the chat API and return the response with timing."""
    start = time.time()

    messages = [{"role": "user", "content": question}]

    try:
        resp = requests.post(
            f"{base_url}/api/chat",
            headers={
                "Content-Type": "application/json",
                "Cookie": f"sb-access-token={access_token}",
            },
            json={"messages": messages, "fundId": fund_id},
            timeout=60,
        )

        elapsed = time.time() - start
        answer = resp.text if resp.status_code == 200 else f"[ERROR {resp.status_code}]"

        return {
            "answer": answer,
            "status_code": resp.status_code,
            "latency_seconds": round(elapsed, 2),
            "query_type": resp.headers.get("x-query-type", "unknown"),
        }
    except requests.exceptions.Timeout:
        return {
            "answer": "[TIMEOUT]",
            "status_code": 0,
            "latency_seconds": 60.0,
            "query_type": "unknown",
        }
    except Exception as e:
        return {
            "answer": f"[ERROR: {str(e)}]",
            "status_code": 0,
            "latency_seconds": time.time() - start,
            "query_type": "unknown",
        }


def compute_ragas_metrics(results: list[dict]) -> dict:
    """Compute RAGAS metrics if the ragas package is available."""
    try:
        from ragas import evaluate
        from ragas.metrics import answer_relevancy, context_precision, faithfulness
        from datasets import Dataset

        # Filter to only questions with valid answers and expected answers
        valid = [
            r
            for r in results
            if r["status_code"] == 200
            and not r["expected_answer"].startswith("[Populate")
        ]

        if not valid:
            print("\nNo questions with populated expected answers — skipping RAGAS metrics.")
            print("Populate expected_answer fields in golden_test_set.json after ingesting documents.")
            return {}

        dataset = Dataset.from_dict(
            {
                "question": [r["question"] for r in valid],
                "answer": [r["answer"] for r in valid],
                "ground_truth": [r["expected_answer"] for r in valid],
                "contexts": [
                    [r["answer"]]  # Using answer as context placeholder
                    for r in valid
                ],
            }
        )

        scores = evaluate(
            dataset,
            metrics=[faithfulness, answer_relevancy, context_precision],
        )

        return {
            "faithfulness": round(float(scores["faithfulness"]), 4),
            "answer_relevancy": round(float(scores["answer_relevancy"]), 4),
            "context_precision": round(float(scores["context_precision"]), 4),
        }

    except ImportError:
        print("\nRAGAS not installed — skipping metric computation.")
        print("Install with: pip install ragas datasets")
        return {}


def print_results_table(results: list[dict]) -> None:
    """Print results as a formatted table."""
    try:
        from tabulate import tabulate

        table_data = []
        for r in results:
            answer_preview = r["answer"][:80] + "..." if len(r["answer"]) > 80 else r["answer"]
            table_data.append(
                [
                    r["id"],
                    r["category"],
                    r["status_code"],
                    r["latency_seconds"],
                    r["query_type"],
                    answer_preview,
                ]
            )

        print(
            tabulate(
                table_data,
                headers=["ID", "Category", "Status", "Latency(s)", "Query Type", "Answer Preview"],
                tablefmt="grid",
            )
        )
    except ImportError:
        # Fallback without tabulate
        print(f"\n{'ID':<8} {'Category':<15} {'Status':<8} {'Latency':<10} {'Query Type':<15}")
        print("-" * 70)
        for r in results:
            print(
                f"{r['id']:<8} {r['category']:<15} {r['status_code']:<8} "
                f"{r['latency_seconds']:<10} {r['query_type']:<15}"
            )


def main():
    parser = argparse.ArgumentParser(
        description="FundScope RAGAS Evaluation Suite",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python run_eval.py --fund-id abc-123 --base-url http://localhost:3000
  python run_eval.py --fund-id abc-123 --category simple_lookup
  python run_eval.py --fund-id abc-123 --limit 5
        """,
    )
    parser.add_argument("--fund-id", required=True, help="UUID of the fund to query")
    parser.add_argument(
        "--base-url",
        default="http://localhost:3000",
        help="Base URL of the FundScope app (default: http://localhost:3000)",
    )
    parser.add_argument(
        "--email",
        default=os.getenv("EVAL_USER_EMAIL"),
        help="User email for authentication (or set EVAL_USER_EMAIL env var)",
    )
    parser.add_argument(
        "--password",
        default=os.getenv("EVAL_USER_PASSWORD"),
        help="User password for authentication (or set EVAL_USER_PASSWORD env var)",
    )
    parser.add_argument(
        "--category",
        choices=["simple_lookup", "comparison", "multi_hop", "edge_case", "general"],
        help="Only run questions from this category",
    )
    parser.add_argument(
        "--limit", type=int, default=0, help="Limit number of questions (0 = all)"
    )
    parser.add_argument(
        "--test-set",
        default=str(Path(__file__).parent / "golden_test_set.json"),
        help="Path to golden test set JSON",
    )

    args = parser.parse_args()

    if not args.email or not args.password:
        print("Error: --email and --password required (or set EVAL_USER_EMAIL/EVAL_USER_PASSWORD)")
        sys.exit(1)

    # Load test set
    with open(args.test_set) as f:
        test_set = json.load(f)

    questions = test_set["questions"]

    # Filter by category if specified
    if args.category:
        questions = [q for q in questions if q["category"] == args.category]

    # Apply limit
    if args.limit > 0:
        questions = questions[: args.limit]

    print(f"FundScope Evaluation Suite")
    print(f"{'=' * 50}")
    print(f"Base URL:   {args.base_url}")
    print(f"Fund ID:    {args.fund_id}")
    print(f"Questions:  {len(questions)}")
    print(f"Category:   {args.category or 'all'}")
    print()

    # Authenticate
    print("Authenticating...")
    access_token = authenticate(args.base_url, args.email, args.password)
    print("Authenticated successfully.\n")

    # Run questions
    results = []
    for i, q in enumerate(questions, 1):
        print(f"[{i}/{len(questions)}] {q['id']}: {q['question'][:60]}...")
        response = ask_question(args.base_url, q["question"], args.fund_id, access_token)
        results.append(
            {
                "id": q["id"],
                "category": q["category"],
                "question": q["question"],
                "expected_answer": q["expected_answer"],
                **response,
            }
        )

    # Print results table
    print(f"\n{'=' * 50}")
    print("Results:")
    print_results_table(results)

    # Summary stats
    successful = sum(1 for r in results if r["status_code"] == 200)
    avg_latency = (
        sum(r["latency_seconds"] for r in results if r["status_code"] == 200) / max(successful, 1)
    )
    print(f"\nSuccess rate: {successful}/{len(results)} ({100 * successful / max(len(results), 1):.0f}%)")
    print(f"Avg latency:  {avg_latency:.2f}s")

    # Compute RAGAS metrics
    ragas_scores = compute_ragas_metrics(results)
    if ragas_scores:
        print(f"\nRAGAS Metrics:")
        for metric, score in ragas_scores.items():
            print(f"  {metric}: {score}")

    # Save results
    results_dir = Path(__file__).parent / "results"
    results_dir.mkdir(exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = results_dir / f"eval_{timestamp}.json"

    output = {
        "timestamp": datetime.now().isoformat(),
        "config": {
            "base_url": args.base_url,
            "fund_id": args.fund_id,
            "category": args.category,
            "question_count": len(results),
        },
        "summary": {
            "success_rate": successful / max(len(results), 1),
            "avg_latency_seconds": round(avg_latency, 2),
            "ragas_metrics": ragas_scores,
        },
        "results": results,
    }

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    main()
