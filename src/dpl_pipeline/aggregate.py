"""Aggregate provision-level matches into Impact/Bill records.

One output record per (bill, impact category) with at least one qualifying
provision; a bill with no qualifying provisions gets a single `neutral`
record. A bill is flagged `needs_review` when any single provision matched
rules in more than one category (e.g. the same section fired both a
restrictive and an expansive rule) -- that usually means the section is
genuinely mixed or a rule needs tightening, and a human should look.
"""

from __future__ import annotations

from collections import defaultdict

from .models import CATEGORIES, NEUTRAL, BillResult, ImpactRecord

_MAX_EVIDENCE = 8


def aggregate(result: BillResult) -> list[ImpactRecord]:
    bill = result.bill

    if result.status != "ok":
        return [
            ImpactRecord(
                bill_number=bill.bill_number,
                state=bill.state,
                category="unprocessed",
                policy_areas=(),
                rule_ids=(),
                n_provisions=0,
                evidence=(),
                source_used=result.source_used,
                text_sha256=result.text_sha256,
                status=result.status,
                needs_review=True,
            )
        ]

    # Which provisions matched multiple categories?
    cats_by_provision: dict[str, set[str]] = defaultdict(set)
    for m in result.matches:
        cats_by_provision[m.provision_id].add(m.category)
    mixed_provisions = {p for p, cats in cats_by_provision.items() if len(cats) > 1}

    by_category: dict[str, list] = defaultdict(list)
    for m in result.matches:
        by_category[m.category].append(m)

    records: list[ImpactRecord] = []
    for category in CATEGORIES:
        cat_matches = by_category.get(category)
        if not cat_matches:
            continue
        cat_matches.sort(key=lambda m: (m.provision_id, m.rule_id))
        evidence = tuple(
            f"{m.provision_id}|{m.rule_id}|{m.excerpt}" for m in cat_matches[:_MAX_EVIDENCE]
        )
        records.append(
            ImpactRecord(
                bill_number=bill.bill_number,
                state=bill.state,
                category=category,
                policy_areas=tuple(sorted({m.policy_area for m in cat_matches})),
                rule_ids=tuple(sorted({m.rule_id for m in cat_matches})),
                n_provisions=len({m.provision_id for m in cat_matches}),
                evidence=evidence,
                source_used=result.source_used,
                text_sha256=result.text_sha256,
                status=result.status,
                needs_review=any(m.provision_id in mixed_provisions for m in cat_matches),
            )
        )

    if not records:
        records.append(
            ImpactRecord(
                bill_number=bill.bill_number,
                state=bill.state,
                category=NEUTRAL,
                policy_areas=(),
                rule_ids=(),
                n_provisions=0,
                evidence=(),
                source_used=result.source_used,
                text_sha256=result.text_sha256,
                status=result.status,
                needs_review=False,
            )
        )
    return records
