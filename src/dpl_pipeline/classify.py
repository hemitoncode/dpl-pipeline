"""Provision-level classification: run every rule over every provision.

Deterministic by construction: rules are pre-sorted by id, provisions are
processed in document order, and regex matching has no state. The same
text + the same rule file always produces byte-identical matches.
"""

from __future__ import annotations

import re

from .models import Provision, RuleMatch
from .rules import Rule

_EXCERPT_RADIUS = 140


def classify_provisions(provisions: list[Provision], rules: list[Rule]) -> list[RuleMatch]:
    matches: list[RuleMatch] = []
    for prov in provisions:
        for rule in rules:  # already sorted by rule_id
            m = rule.match(prov.text)
            if m:
                matches.append(
                    RuleMatch(
                        rule_id=rule.rule_id,
                        category=rule.category,
                        policy_area=rule.policy_area,
                        provision_id=prov.provision_id,
                        excerpt=_excerpt(prov.text, m),
                    )
                )
    return matches


def _excerpt(text: str, m: re.Match) -> str:
    start = max(0, m.start() - _EXCERPT_RADIUS)
    end = min(len(text), m.end() + _EXCERPT_RADIUS)
    snippet = re.sub(r"\s+", " ", text[start:end]).strip()
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{snippet}{suffix}"
