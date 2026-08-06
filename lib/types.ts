/**
 * Core types. The unit of analysis for output is Impact / Bill: each bill
 * produces one record per impact category (restrictive, expansive,
 * election_interference) with at least one qualifying provision, or a single
 * `neutral` record when nothing reaches a threshold.
 */

export const CATEGORIES = ["restrictive", "expansive", "election_interference"] as const;
export type Category = (typeof CATEGORIES)[number];
export const NEUTRAL = "neutral";

export interface BillInput {
  bill_number: string; // e.g. "VA HB 967"
  url: string;         // LegiScan text page (fallback source)
  state_link: string;  // state legislature link (preferred source)
}

export function billState(bill: BillInput): string {
  return bill.bill_number.split(/\s+/)[0] ?? "";
}

export interface Provision {
  provisionId: string; // "P001"… stable within a bill
  heading: string;
  text: string;
}

export interface RuleMatch {
  ruleId: string;
  category: Category;
  policyArea: string;
  provisionId: string;
  excerpt: string;
}

export type BillStatus = "ok" | "fetch_error" | "extract_error";

export interface BillResult {
  bill: BillInput;
  status: BillStatus;
  sourceUsed: string;
  textSha256: string;
  provisions: Provision[];
  matches: RuleMatch[];
  error: string;
}

export interface EvidenceItem {
  provision_id: string;
  rule_id: string;
  excerpt: string;
}

/** One output row: a (bill, impact category) pair. */
export interface ImpactRecord {
  bill_number: string;
  state: string;
  category: Category | typeof NEUTRAL | "unprocessed";
  policy_areas: string[];
  rule_ids: string[];
  n_provisions: number;
  evidence: EvidenceItem[];
  source_used: string;
  text_sha256: string;
  status: BillStatus;
  needs_review: boolean;
  /** Human-readable failure detail when status != "ok" (else ""). */
  error: string;
}
