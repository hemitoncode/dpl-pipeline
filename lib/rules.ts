/**
 * Rule loading and matching.
 *
 * Rules live in a YAML lexicon (rules/impact_rules.yml). Each rule:
 *
 *   - id: R-ID-001
 *     category: restrictive
 *     policy_area: voter_id
 *     description: ...
 *     any:  [regexes — at least one must match]        (required)
 *     all:  [regexes — every one must also match]      (optional)
 *     none: [regexes — rule suppressed if any matches] (optional)
 *
 * Patterns are compiled case-insensitively with dotAll so `.{0,80}` style
 * proximity windows can cross line breaks. Rules are always evaluated in
 * sorted-id order so results are deterministic regardless of YAML order.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";

import { CATEGORIES, type Category } from "./types";

export interface Rule {
  id: string;
  category: Category;
  policyArea: string;
  description: string;
  any: RegExp[];
  all: RegExp[];
  none: RegExp[];
}

export class RulesError extends Error {}

interface RawRule {
  id?: string;
  category?: string;
  policy_area?: string;
  description?: string;
  any?: string[];
  all?: string[];
  none?: string[];
}

function compile(patterns: string[], ruleId: string, key: string): RegExp[] {
  return patterns.map((p) => {
    try {
      return new RegExp(p, "is");
    } catch (e) {
      throw new RulesError(`rule ${ruleId}: bad regex in \`${key}\`: ${p} (${e})`);
    }
  });
}

export function parseRules(yamlText: string, source = "rules"): Rule[] {
  const raw = load(yamlText);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new RulesError(`${source}: expected a non-empty list of rules`);
  }
  const seen = new Set<string>();
  const rules = (raw as RawRule[]).map((item, i) => {
    const id = item.id;
    if (!id) throw new RulesError(`${source}: rule #${i} has no id`);
    if (seen.has(id)) throw new RulesError(`${source}: duplicate rule id ${id}`);
    seen.add(id);
    if (!CATEGORIES.includes(item.category as Category)) {
      throw new RulesError(`rule ${id}: category must be one of ${CATEGORIES.join(", ")}, got ${item.category}`);
    }
    if (!item.policy_area) throw new RulesError(`rule ${id}: policy_area is required`);
    if (!item.any?.length) throw new RulesError(`rule ${id}: \`any\` must contain at least one pattern`);
    return {
      id,
      category: item.category as Category,
      policyArea: item.policy_area,
      description: item.description ?? "",
      any: compile(item.any, id, "any"),
      all: compile(item.all ?? [], id, "all"),
      none: compile(item.none ?? [], id, "none"),
    };
  });
  rules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rules;
}

export function defaultRulesPath(): string {
  return path.join(process.cwd(), "rules", "impact_rules.yml");
}

let cached: Rule[] | null = null;

/** Load the default lexicon once per server process. */
export function loadRules(filePath?: string): Rule[] {
  if (filePath) return parseRules(readFileSync(filePath, "utf-8"), filePath);
  if (!cached) cached = parseRules(readFileSync(defaultRulesPath(), "utf-8"), defaultRulesPath());
  return cached;
}

/**
 * If the rule fires on `text`, return the earliest `any` match; else null.
 */
export function matchRule(rule: Rule, text: string): RegExpExecArray | null {
  for (const p of rule.none) if (p.test(text)) return null;
  for (const p of rule.all) if (!p.test(text)) return null;
  let first: RegExpExecArray | null = null;
  for (const p of rule.any) {
    const m = p.exec(text);
    if (m && (first === null || m.index < first.index)) first = m;
  }
  return first;
}
