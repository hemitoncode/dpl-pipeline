"""End-to-end orchestration: input sheet -> Impact/Bill records."""

from __future__ import annotations

import csv
import hashlib
import io
from pathlib import Path

from .aggregate import aggregate
from .classify import classify_provisions
from .extract import ExtractError, extract_text
from .fetch import FetchError, fetch
from .models import BillInput, BillResult, ImpactRecord
from .rules import Rule
from .segment import segment


def read_input(path: str | Path) -> list[BillInput]:
    """Read the input sheet (TSV or CSV; delimiter sniffed from the header)."""
    text = Path(path).read_text(encoding="utf-8-sig")
    header = text.splitlines()[0] if text else ""
    delimiter = "\t" if "\t" in header else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    required = {"bill_number", "url", "state_link"}
    if reader.fieldnames is None or not required.issubset(set(reader.fieldnames)):
        raise ValueError(f"input must have columns {sorted(required)}; got {reader.fieldnames}")
    bills = []
    for row in reader:
        if not (row.get("bill_number") or "").strip():
            continue
        bills.append(
            BillInput(
                bill_number=row["bill_number"].strip(),
                url=(row.get("url") or "").strip(),
                state_link=(row.get("state_link") or "").strip(),
            )
        )
    return bills


def process_bill(
    bill: BillInput,
    rules: list[Rule],
    cache_dir: str | Path,
    offline: bool = False,
) -> BillResult:
    """Fetch (state link first, LegiScan as fallback), extract, segment, classify."""
    doc = None
    errors: list[str] = []
    for url in [u for u in (bill.state_link, bill.url) if u]:
        try:
            doc = fetch(url, cache_dir, offline=offline)
            break
        except FetchError as e:
            errors.append(str(e))
    if doc is None:
        return BillResult(bill=bill, status="fetch_error", error="; ".join(errors))

    try:
        text = extract_text(doc)
    except ExtractError as e:
        # The preferred source may be a JS viewer shell or scanned PDF;
        # try the fallback URL before giving up.
        fallback = bill.url if doc.url == bill.state_link else ""
        if fallback:
            try:
                doc = fetch(fallback, cache_dir, offline=offline)
                text = extract_text(doc)
            except (FetchError, ExtractError) as e2:
                return BillResult(
                    bill=bill, status="extract_error",
                    source_used=doc.url, error=f"{e}; fallback: {e2}",
                )
        else:
            return BillResult(bill=bill, status="extract_error", source_used=doc.url, error=str(e))

    provisions = segment(text)
    matches = classify_provisions(provisions, rules)
    return BillResult(
        bill=bill,
        status="ok",
        source_used=doc.url,
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        provisions=provisions,
        matches=matches,
    )


def run(
    bills: list[BillInput],
    rules: list[Rule],
    cache_dir: str | Path,
    offline: bool = False,
) -> list[ImpactRecord]:
    records: list[ImpactRecord] = []
    for bill in bills:
        result = process_bill(bill, rules, cache_dir, offline=offline)
        records.extend(aggregate(result))
    return records
