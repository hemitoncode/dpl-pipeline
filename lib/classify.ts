/**
 * Provision-level classification: run every rule over every provision.
 *
 * Deterministic by construction: rules are pre-sorted by id, provisions are
 * processed in document order, and regex matching has no state. The same
 * text + the same rule file always produce identical matches.
 */

import { matchRule, type Rule } from "./rules";
import type { Provision, RuleMatch } from "./types";

const EXCERPT_RADIUS = 140;

export function classifyProvisions(provisions: Provision[], rules: Rule[]): RuleMatch[] {
  const matches: RuleMatch[] = [];
  for (const prov of provisions) {
    for (const rule of rules) {
      const m = matchRule(rule, prov.text);
      if (m) {
        matches.push({
          ruleId: rule.id,
          category: rule.category,
          policyArea: rule.policyArea,
          provisionId: prov.provisionId,
          excerpt: excerpt(prov.text, m.index, m.index + m[0].length),
        });
      }
    }
  }
  return matches;
}

function excerpt(text: string, matchStart: number, matchEnd: number): string {
  const start = Math.max(0, matchStart - EXCERPT_RADIUS);
  const end = Math.min(text.length, matchEnd + EXCERPT_RADIUS);
  const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${snippet}${end < text.length ? "…" : ""}`;
}
