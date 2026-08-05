"""Rule loading and matching.

Rules live in a YAML lexicon (see rules/impact_rules.yml). Each rule is a
small, auditable pattern set:

    - id: R-ID-001
      category: restrictive
      policy_area: voter_id
      description: New or stricter photo ID requirement for in-person voting
      any:   [list of regexes -- at least one must match]
      all:   [optional list -- every one must also match]
      none:  [optional list -- rule is suppressed if any of these match]

Matching is pure and order-independent per rule; rules are always evaluated
in sorted-id order so results are deterministic regardless of YAML ordering.
All patterns are compiled case-insensitively with DOTALL so `.{0,80}` style
proximity windows can cross line breaks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from .models import CATEGORIES

_FLAGS = re.IGNORECASE | re.DOTALL


@dataclass(frozen=True)
class Rule:
    rule_id: str
    category: str
    policy_area: str
    description: str
    any_patterns: tuple[re.Pattern, ...]
    all_patterns: tuple[re.Pattern, ...]
    none_patterns: tuple[re.Pattern, ...]

    def match(self, text: str) -> re.Match | None:
        """Return the first `any` match if the rule fires on `text`, else None."""
        for p in self.none_patterns:
            if p.search(text):
                return None
        for p in self.all_patterns:
            if not p.search(text):
                return None
        first: re.Match | None = None
        for p in self.any_patterns:
            m = p.search(text)
            if m and (first is None or m.start() < first.start()):
                first = m
        return first


class RulesError(ValueError):
    pass


def _compile(patterns: list[str], rule_id: str, key: str) -> tuple[re.Pattern, ...]:
    out = []
    for pat in patterns:
        try:
            out.append(re.compile(pat, _FLAGS))
        except re.error as e:
            raise RulesError(f"rule {rule_id}: bad regex in `{key}`: {pat!r} ({e})") from e
    return tuple(out)


def load_rules(path: str | Path) -> list[Rule]:
    """Load, validate, and compile the rule lexicon. Returns rules sorted by id."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise RulesError(f"{path}: expected a non-empty list of rules")

    rules: list[Rule] = []
    seen: set[str] = set()
    for i, item in enumerate(raw):
        rid = item.get("id")
        if not rid:
            raise RulesError(f"{path}: rule #{i} has no id")
        if rid in seen:
            raise RulesError(f"{path}: duplicate rule id {rid}")
        seen.add(rid)
        cat = item.get("category")
        if cat not in CATEGORIES:
            raise RulesError(f"rule {rid}: category must be one of {CATEGORIES}, got {cat!r}")
        if not item.get("policy_area"):
            raise RulesError(f"rule {rid}: policy_area is required")
        any_pats = item.get("any") or []
        if not any_pats:
            raise RulesError(f"rule {rid}: `any` must contain at least one pattern")
        rules.append(
            Rule(
                rule_id=rid,
                category=cat,
                policy_area=item["policy_area"],
                description=item.get("description", ""),
                any_patterns=_compile(any_pats, rid, "any"),
                all_patterns=_compile(item.get("all") or [], rid, "all"),
                none_patterns=_compile(item.get("none") or [], rid, "none"),
            )
        )
    rules.sort(key=lambda r: r.rule_id)
    return rules


def default_rules_path() -> Path:
    """rules/impact_rules.yml at the repository root (two levels up from this file)."""
    return Path(__file__).resolve().parents[2] / "rules" / "impact_rules.yml"
