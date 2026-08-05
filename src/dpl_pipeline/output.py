"""Deterministic output writers.

Two artifacts per run:
- impacts.csv     -- one row per Impact/Bill (the coding dataset)
- evidence.jsonl  -- full match detail per record, for review/audit

Rows are ordered by input order of bills, then fixed category order, so a
rerun over the same cache produces byte-identical files.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from .models import ImpactRecord

CSV_COLUMNS = [
    "bill_number",
    "state",
    "category",
    "policy_areas",
    "rule_ids",
    "n_provisions",
    "needs_review",
    "status",
    "source_used",
    "text_sha256",
]


def write_outputs(records: list[ImpactRecord], out_dir: str | Path) -> tuple[Path, Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "impacts.csv"
    jsonl_path = out_dir / "evidence.jsonl"

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(CSV_COLUMNS)
        for r in records:
            writer.writerow(
                [
                    r.bill_number,
                    r.state,
                    r.category,
                    "; ".join(r.policy_areas),
                    "; ".join(r.rule_ids),
                    r.n_provisions,
                    "yes" if r.needs_review else "no",
                    r.status,
                    r.source_used,
                    r.text_sha256,
                ]
            )

    with jsonl_path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(
                json.dumps(
                    {
                        "bill_number": r.bill_number,
                        "state": r.state,
                        "category": r.category,
                        "policy_areas": list(r.policy_areas),
                        "rule_ids": list(r.rule_ids),
                        "n_provisions": r.n_provisions,
                        "needs_review": r.needs_review,
                        "status": r.status,
                        "source_used": r.source_used,
                        "text_sha256": r.text_sha256,
                        "evidence": [
                            dict(zip(("provision_id", "rule_id", "excerpt"), e.split("|", 2)))
                            for e in r.evidence
                        ],
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                + "\n"
            )

    return csv_path, jsonl_path
