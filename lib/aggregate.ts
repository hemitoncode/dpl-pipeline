/**
 * Aggregate provision-level matches into Impact/Bill records.
 *
 * One record per (bill, impact category) with at least one qualifying
 * provision; a bill with no qualifying provisions gets a single `neutral`
 * record. A record is flagged `needs_review` when any contributing provision
 * matched rules in more than one category — that usually means the section is
 * genuinely mixed or a rule needs tightening, and a human should look.
 *
 * A bill that could not be fetched/extracted yields one `unprocessed` record
 * (never silently `neutral`).
 */

import { CATEGORIES, NEUTRAL, billState, type BillResult, type ImpactRecord, type RuleMatch } from "./types";

const MAX_EVIDENCE = 8;

export function aggregate(result: BillResult): ImpactRecord[] {
  const bill = result.bill;
  const base = {
    bill_number: bill.bill_number,
    state: billState(bill),
    source_used: result.sourceUsed,
    text_sha256: result.textSha256,
    status: result.status,
  };

  if (result.status !== "ok") {
    return [
      {
        ...base,
        category: "unprocessed",
        policy_areas: [],
        rule_ids: [],
        n_provisions: 0,
        evidence: [],
        needs_review: true,
      },
    ];
  }

  const catsByProvision = new Map<string, Set<string>>();
  for (const m of result.matches) {
    if (!catsByProvision.has(m.provisionId)) catsByProvision.set(m.provisionId, new Set());
    catsByProvision.get(m.provisionId)!.add(m.category);
  }
  const mixedProvisions = new Set(
    [...catsByProvision.entries()].filter(([, cats]) => cats.size > 1).map(([p]) => p),
  );

  const byCategory = new Map<string, RuleMatch[]>();
  for (const m of result.matches) {
    if (!byCategory.has(m.category)) byCategory.set(m.category, []);
    byCategory.get(m.category)!.push(m);
  }

  const records: ImpactRecord[] = [];
  for (const category of CATEGORIES) {
    const catMatches = byCategory.get(category);
    if (!catMatches?.length) continue;
    catMatches.sort((a, b) =>
      a.provisionId === b.provisionId
        ? a.ruleId.localeCompare(b.ruleId)
        : a.provisionId.localeCompare(b.provisionId),
    );
    records.push({
      ...base,
      category,
      policy_areas: [...new Set(catMatches.map((m) => m.policyArea))].sort(),
      rule_ids: [...new Set(catMatches.map((m) => m.ruleId))].sort(),
      n_provisions: new Set(catMatches.map((m) => m.provisionId)).size,
      evidence: catMatches.slice(0, MAX_EVIDENCE).map((m) => ({
        provision_id: m.provisionId,
        rule_id: m.ruleId,
        excerpt: m.excerpt,
      })),
      needs_review: catMatches.some((m) => mixedProvisions.has(m.provisionId)),
    });
  }

  if (records.length === 0) {
    records.push({
      ...base,
      category: NEUTRAL,
      policy_areas: [],
      rule_ids: [],
      n_provisions: 0,
      evidence: [],
      needs_review: false,
    });
  }
  return records;
}
