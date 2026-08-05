"""Command-line interface.

    dpl-pipeline run examples/input.tsv --out output/ --cache .cache/
    dpl-pipeline check-rules
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .models import CATEGORIES
from .output import write_outputs
from .pipeline import read_input, run
from .rules import default_rules_path, load_rules


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="dpl-pipeline",
        description="Classify voting legislation impact at the Impact/Bill level.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="fetch, classify, and write outputs")
    p_run.add_argument("input", help="TSV/CSV with columns: bill_number, url, state_link")
    p_run.add_argument("--out", default="output", help="output directory (default: output/)")
    p_run.add_argument("--cache", default=".cache", help="fetch cache directory (default: .cache/)")
    p_run.add_argument("--rules", default=None, help="rule lexicon YAML (default: rules/impact_rules.yml)")
    p_run.add_argument("--offline", action="store_true",
                       help="never hit the network; fail bills with no cache entry")

    p_check = sub.add_parser("check-rules", help="validate and summarize the rule lexicon")
    p_check.add_argument("--rules", default=None)

    p_serve = sub.add_parser("serve", help="start the web frontend")
    p_serve.add_argument("--host", default="127.0.0.1")
    p_serve.add_argument("--port", type=int, default=8000)
    p_serve.add_argument("--rules", default=None)
    p_serve.add_argument("--data-dir", default="webdata",
                         help="directory for fetch cache and job outputs (default: webdata/)")
    p_serve.add_argument("--offline", action="store_true")

    args = parser.parse_args(argv)

    if args.command == "serve":
        from .webapp import serve

        serve(host=args.host, port=args.port, rules_path=args.rules,
              data_dir=args.data_dir, offline=args.offline)
        return 0
    rules_path = Path(args.rules) if args.rules else default_rules_path()
    rules = load_rules(rules_path)

    if args.command == "check-rules":
        by_cat = {c: [r for r in rules if r.category == c] for c in CATEGORIES}
        print(f"{len(rules)} rules loaded from {rules_path}")
        for cat, cat_rules in by_cat.items():
            areas = sorted({r.policy_area for r in cat_rules})
            print(f"  {cat}: {len(cat_rules)} rules across {len(areas)} policy areas")
        return 0

    bills = read_input(args.input)
    print(f"{len(bills)} bills read from {args.input}", file=sys.stderr)
    records = run(bills, rules, cache_dir=args.cache, offline=args.offline)
    csv_path, jsonl_path = write_outputs(records, args.out)

    n_review = sum(1 for r in records if r.needs_review)
    n_err = sum(1 for r in records if r.status != "ok")
    print(f"wrote {len(records)} Impact/Bill records -> {csv_path}", file=sys.stderr)
    print(f"evidence detail -> {jsonl_path}", file=sys.stderr)
    if n_review:
        print(f"NOTE: {n_review} records flagged needs_review", file=sys.stderr)
    if n_err:
        print(f"WARNING: {n_err} bills could not be processed (status != ok)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
