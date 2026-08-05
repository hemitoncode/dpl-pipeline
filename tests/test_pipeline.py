"""End-to-end pipeline behavior on fixtures (no network)."""

import hashlib

from conftest import FIXTURES

from dpl_pipeline.aggregate import aggregate
from dpl_pipeline.classify import classify_provisions
from dpl_pipeline.extract import extract_text
from dpl_pipeline.fetch import FetchedDoc
from dpl_pipeline.models import BillInput, BillResult
from dpl_pipeline.output import write_outputs
from dpl_pipeline.pipeline import read_input
from dpl_pipeline.segment import segment


def _doc_from_fixture(name: str) -> FetchedDoc:
    content = (FIXTURES / name).read_bytes()
    return FetchedDoc(url=f"fixture://{name}", content=content,
                      content_type="text/html", from_cache=True)


def _result_for_fixture(rules, name="mixed_bill.html") -> BillResult:
    doc = _doc_from_fixture(name)
    text = extract_text(doc)
    provisions = segment(text)
    return BillResult(
        bill=BillInput("VA HB 100", "https://example.test/a", "https://example.test/b"),
        status="ok",
        source_used=doc.url,
        text_sha256=hashlib.sha256(text.encode()).hexdigest(),
        provisions=provisions,
        matches=classify_provisions(provisions, rules),
    )


def test_extract_drops_stricken_and_chrome(rules):
    text = extract_text(_doc_from_fixture("mixed_bill.html"))
    assert "may sign a statement" not in text      # <s> content removed
    assert "var x" not in text                     # script removed
    assert "photographic identification" in text


def test_segmentation_finds_sections(rules):
    text = extract_text(_doc_from_fixture("mixed_bill.html"))
    provisions = segment(text)
    assert len(provisions) >= 3
    assert provisions[0].provision_id == "P001"


def test_mixed_bill_yields_two_impact_records(rules):
    records = aggregate(_result_for_fixture(rules))
    cats = [r.category for r in records]
    assert cats == ["restrictive", "expansive"]  # fixed category order
    restrictive = records[0]
    expansive = records[1]
    assert "voter_id" in restrictive.policy_areas
    assert "absentee_mail_voting" in expansive.policy_areas
    assert all(r.evidence for r in records)
    # ID section and absentee section are different provisions -> no mixing
    assert not restrictive.needs_review
    assert not expansive.needs_review


def test_fetch_error_yields_unprocessed_not_neutral(rules):
    result = BillResult(
        bill=BillInput("XX HB 1", "https://example.test/x", ""),
        status="fetch_error",
        error="boom",
    )
    records = aggregate(result)
    assert len(records) == 1
    assert records[0].category == "unprocessed"
    assert records[0].needs_review


def test_no_matches_yields_neutral(rules):
    result = BillResult(
        bill=BillInput("XX HB 2", "https://example.test/x", ""),
        status="ok",
        source_used="https://example.test/x",
        text_sha256="0" * 64,
        provisions=[],
        matches=[],
    )
    records = aggregate(result)
    assert [r.category for r in records] == ["neutral"]


def test_read_input_tsv(tmp_path):
    p = tmp_path / "in.tsv"
    p.write_text(
        "bill_number\turl\tstate_link\n"
        "VA HB 967\thttps://a.test/1\thttps://b.test/1\n",
        encoding="utf-8",
    )
    bills = read_input(p)
    assert bills[0].bill_number == "VA HB 967"
    assert bills[0].state == "VA"


def test_output_is_byte_identical_across_runs(rules, tmp_path):
    records = aggregate(_result_for_fixture(rules))
    csv1, jsonl1 = write_outputs(records, tmp_path / "run1")
    csv2, jsonl2 = write_outputs(records, tmp_path / "run2")
    assert csv1.read_bytes() == csv2.read_bytes()
    assert jsonl1.read_bytes() == jsonl2.read_bytes()


def test_classification_is_deterministic(rules):
    a = _result_for_fixture(rules)
    b = _result_for_fixture(rules)
    assert a.matches == b.matches
    assert a.text_sha256 == b.text_sha256
