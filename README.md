# dpl-pipeline — Voting Legislation Impact Coder

A Next.js app that deterministically codes voting legislation at the
**Impact / Bill** level.

Each bill is fetched, split into provisions, and scored against a transparent
rule lexicon. The output is one record per impact category per bill — so a bill
with a stricter voter-ID provision *and* a mail-voting expansion produces both
a `restrictive` and an `expansive` record.

## Categories

| Category | Threshold |
|---|---|
| `restrictive` | ≥1 provision making it harder for eligible Americans to register, stay on the rolls, or vote, compared to existing state law |
| `expansive` | ≥1 provision making it easier to register, stay on the rolls, or vote, compared to existing state law |
| `election_interference` | ≥1 provision threatening the people/processes that make elections work, or increasing opportunities for partisan interference in results or administration |
| `neutral` | no provision reaches any threshold above |
| `unprocessed` | the bill could not be fetched/extracted — deliberately **not** coded neutral |

## Quickstart

```bash
npm install
npm run dev        # http://localhost:3000
# production:
npm run build && npm start
# tests:
npm test           # 31 Vitest tests: lexicon regression, pipeline, parsing
```

Open the app, paste or upload the bill sheet, watch per-bill progress, review
evidence excerpts, and download `impacts.csv` / `evidence.jsonl`.

### Input format

TSV or CSV (delimiter auto-detected) with exactly these columns:

```
bill_number	url	state_link
VA HB 967	https://legiscan.com/VA/text/HB967/id/3423959	https://lis.virginia.gov/bill-details/20261/HB967/text/CHAP0717
```

`state_link` (the state legislature's own text, usually the enrolled/chaptered
version) is fetched first; the LegiScan `url` is the fallback — including when
the state link turns out to be a JS viewer shell or a scanned PDF that yields
no text. A sample sheet is at `examples/input.tsv`.

Source candidates are tried in order until one yields real text:

1. `state_link`
2. known plain-text equivalents of viewer-shell hosts — e.g. Virginia's new
   LIS is a JS app with no server-rendered text, so for chaptered acts the
   pipeline also tries the Virginia Law Portal
   (`law.lis.virginia.gov/uncodifiedacts/{year}/session{n}/chapter{n}/`) and
   the legacy LIS CGI
3. the LegiScan **API** (`op=getBillText`) when a key is available — strongly
   recommended: a free key from legiscan.com makes every bill fetchable even
   when its state site is a JS shell, a scanned PDF, or blocks server
   traffic. Provide it either in the **UI field** (stored in your browser's
   localStorage, sent per request) or as the `LEGISCAN_API_KEY` environment
   variable on the server
4. the LegiScan `url` page itself

When every candidate fails, the bill is coded `unprocessed` and the exact
per-source failure detail is shown on the bill card and written to the
`error` column of `impacts.csv`.

### Output

- **`impacts.csv`** — the coding dataset: one row per Impact/Bill
  (`bill_number, state, category, policy_areas, rule_ids, n_provisions,
  needs_review, status, source_used, text_sha256, error`)
- **`evidence.jsonl`** — the same records with full evidence detail: for every
  match, the provision id, rule id, and the text excerpt that triggered it.

Both are assembled client-side from the API responses, so nothing is stored on
the server.

## Architecture

```
app/
  page.tsx              UI: sheet input, progress, bill cards, downloads
  api/classify/route.ts POST one bill → Impact/Bill records (server-side)
  api/rules/route.ts    GET rule lexicon summary (transparency view)
lib/
  fetchDoc.ts   fetch with retries + per-process cache (state_link ▸ legiscan)
  extract.ts    HTML (stricken <s>/<del> language removed) / PDF via unpdf
  segment.ts    statutory section markers → provisions (chunk fallback)
  rules.ts      YAML lexicon loading/validation/compilation
  classify.ts   rule engine: every rule × every provision, evidence excerpts
  aggregate.ts  provision matches → one record per impact per bill
  output.ts     deterministic impacts.csv / evidence.jsonl builders
  sheet.ts      TSV/CSV input parsing
rules/impact_rules.yml  the rule lexicon (the substantive heart of the system)
tests/                  Vitest: lexicon regression snippets, pipeline, parsing
```

The client submits bills to `/api/classify` one at a time — progress is
visible, and one slow state website can't stall the whole batch.

## Determinism

- No models, no sampling: classification is pure regex over normalized text,
  rules evaluated in sorted-id order, provisions in document order.
- Same text + same lexicon → identical records and byte-identical CSV/JSONL
  (covered by tests).
- Every record carries `text_sha256` (hash of the exact text that was
  classified) and the triggering `rule_ids`, so any row can be re-derived and
  audited later.
- Fetches are cached in-memory per server process; for a frozen archival run,
  keep the fetched documents alongside the output — `text_sha256` verifies a
  re-fetch still matches the original coding.

## The rule lexicon

`rules/impact_rules.yml` holds ~38 seed rules, each mapping patterns to one
category and one policy area (`voter_id`, `voter_registration`,
`list_maintenance`, `absentee_mail_voting`, `early_voting`, `ballot_return`,
`polling_places`, `voter_assistance`, `felony_disenfranchisement`,
`election_administration`, `certification`, `audits`, `poll_watchers`,
`language_access`, `youth_voting`, …).

Rule semantics: `any` (≥1 must match) + optional `all` (all must match) +
optional `none` (suppressors). Directionality is encoded in the patterns —
e.g. *establishing* drop boxes is expansive (`E-RET-001`) while *capping or
removing* them is restrictive (`R-RET-002`); penalties *on election officials
for routine administration* are interference (`I-ADMIN-001`) while penalties
for *threatening* officials are suppressed by a `none` guard.

To extend: add a rule with a fresh stable id, then add a canonical-language
snippet test in `tests/rules.test.ts`. The test suite is the lexicon's
regression harness.

## Review workflow (read this before trusting the numbers)

This is a **screening instrument, not a final coder**. Design choices that
keep the human in the loop:

- `needs_review` is set whenever one provision fires rules in more than one
  category — genuinely mixed sections and over-broad rules both surface here.
- Every impact row ships with its evidence excerpts in the UI and in
  `evidence.jsonl`, so confirming or rejecting a row takes seconds.
- Bills that failed to fetch/extract are `unprocessed`, never silently
  `neutral`.

Known limitations:

- **"Compared to existing state law"** requires baseline context a text-only
  system doesn't have. Stricken-text removal in HTML captures amendments'
  direction partially; flat PDFs don't mark deletions at all. Rules key on
  directional language (*repeal, establish, no more than, at least*), but
  genuinely ambiguous provisions need a human.
- Scanned/image PDFs yield no text and come out `unprocessed` (an OCR stage
  could be added in `lib/extract.ts`).
- Bill fetching happens server-side, so the deployment environment needs
  outbound access to LegiScan and state legislature sites.
