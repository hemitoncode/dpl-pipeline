/**
 * Deterministic output builders (pure functions, usable client- or server-side).
 *
 * - impacts.csv     — one row per Impact/Bill (the coding dataset)
 * - evidence.jsonl  — full match detail per record, for review/audit
 *
 * Rows follow input bill order, then fixed category order, so the same
 * records always serialize byte-identically.
 */

import type { ImpactRecord } from "./types";

export const CSV_COLUMNS = [
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
  "error",
] as const;

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function makeCsv(records: ImpactRecord[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of records) {
    lines.push(
      [
        r.bill_number,
        r.state,
        r.category,
        r.policy_areas.join("; "),
        r.rule_ids.join("; "),
        r.n_provisions,
        r.needs_review ? "yes" : "no",
        r.status,
        r.source_used,
        r.text_sha256,
        r.error,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export function makeJsonl(records: ImpactRecord[]): string {
  return (
    records
      .map((r) =>
        JSON.stringify({
          bill_number: r.bill_number,
          category: r.category,
          error: r.error,
          evidence: r.evidence,
          n_provisions: r.n_provisions,
          needs_review: r.needs_review,
          policy_areas: r.policy_areas,
          rule_ids: r.rule_ids,
          source_used: r.source_used,
          state: r.state,
          status: r.status,
          text_sha256: r.text_sha256,
        }),
      )
      .join("\n") + "\n"
  );
}
