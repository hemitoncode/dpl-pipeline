"""Core data structures for the pipeline.

The unit of analysis for output is Impact / Bill: each bill produces one
record for every impact category (restrictive, expansive,
election_interference) for which at least one provision qualifies, or a
single `neutral` record when no provision reaches any threshold.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Fixed, ordered category vocabulary. Order is also the output sort order.
CATEGORIES = ("restrictive", "expansive", "election_interference")
NEUTRAL = "neutral"


@dataclass(frozen=True)
class BillInput:
    """One row of the input sheet."""

    bill_number: str  # e.g. "VA HB 967"
    url: str          # LegiScan text page
    state_link: str   # state legislature link (preferred source)

    @property
    def state(self) -> str:
        return self.bill_number.split()[0] if self.bill_number else ""


@dataclass(frozen=True)
class Provision:
    """A segment of bill text treated as a unit for classification."""

    provision_id: str  # e.g. "P003", stable within a bill
    heading: str       # section header line, if detected
    text: str


@dataclass(frozen=True)
class RuleMatch:
    """A single rule firing on a single provision."""

    rule_id: str
    category: str
    policy_area: str
    provision_id: str
    excerpt: str  # short evidence window around the match


@dataclass
class BillResult:
    """Everything we know about one bill after classification."""

    bill: BillInput
    status: str                      # "ok" | "fetch_error" | "extract_error"
    source_used: str = ""            # URL actually fetched
    text_sha256: str = ""            # hash of extracted text (reproducibility)
    provisions: list[Provision] = field(default_factory=list)
    matches: list[RuleMatch] = field(default_factory=list)
    error: str = ""

    @property
    def categories(self) -> list[str]:
        present = {m.category for m in self.matches}
        return [c for c in CATEGORIES if c in present]


@dataclass(frozen=True)
class ImpactRecord:
    """One output row: a (bill, impact category) pair."""

    bill_number: str
    state: str
    category: str
    policy_areas: tuple[str, ...]
    rule_ids: tuple[str, ...]
    n_provisions: int          # provisions contributing to this impact
    evidence: tuple[str, ...]  # "provision_id|rule_id|excerpt" strings
    source_used: str
    text_sha256: str
    status: str
    needs_review: bool
