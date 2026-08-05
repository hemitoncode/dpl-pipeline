# dpl-pipeline — Voting Legislation Impact Coder

A deterministic pipeline that codes voting legislation at the **Impact / Bill**
level, with a web frontend for end users.

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
pip install -e .

# Web frontend (the primary interface for end users)
dpl-pipeline serve --port 8000
# open http://127.0.0.1:8000 — paste or upload the bill sheet, watch progress,
# review evidence, download impacts.csv / evidence.jsonl

# Headless / automation
dpl-pipeline run examples/input.tsv --out output/ --cache .cache/
dpl-pipeline check-rules
```

### Input format

TSV or CSV (delimiter auto-detected) with exactly these columns:

```
bill_number	url	state_link
VA HB 967	https://legiscan.com/VA/text/HB967/id/3423959	https://lis.virginia.gov/bill-details/20261/HB967/text/CHAP0717
```

`state_link` (the state legislature's own text, usually the enrolled/chaptered
version) is fetched first; the LegiScan `url` is the fallback, including when
the state link turns out to be a JS viewer shell or a scanned PDF that yields
no text.

### Output

- **`impacts.csv`** — the coding dataset: one row per Impact/Bill
  (`bill_number, state, category, policy_areas, rule_ids, n_provisions,
  needs_review, status, source_used, text_sha256`)
- **`evidence.jsonl`** — the same records with full evidence detail: for every
  match, the provision id, rule id, and the text excerpt that triggered it.

## Pipeline architecture

```
input sheet ─▶ fetch (state_link ▸ legiscan, disk-cached)
           ─▶ extract text  (HTML: stricken <s>/<del> language removed; PDF via pypdf)
           ─▶ segment into provisions (statutory section markers, chunk fallback)
           ─▶ rule engine   (rules/impact_rules.yml, regex lexicon per provision)
           ─▶ aggregate     (provision matches → Impact/Bill records)
           ─▶ impacts.csv + evidence.jsonl / web UI
```

Modules map 1:1 to stages: `fetch.py`, `extract.py`, `segment.py`,
`rules.py` + `classify.py`, `aggregate.py`, `output.py`; `pipeline.py`
orchestrates, `webapp.py` is the Flask frontend, `cli.py` the console entry.

## Determinism

- No models, no sampling: classification is pure regex over normalized text,
  rules evaluated in sorted-id order, provisions in document order.
- Same text + same lexicon → byte-identical `impacts.csv` and
  `evidence.jsonl` (covered by tests).
- Every record carries `text_sha256` (hash of the exact text that was
  classified) and the triggering `rule_ids`, so any row can be re-derived and
  audited later.
- Fetches are cached on disk by URL hash; `--offline` reruns classify from the
  cache only, so a coding run can be frozen and reproduced exactly even if a
  state website changes.

## The rule lexicon

`rules/impact_rules.yml` is the substantive heart of the system: ~35 seed
rules, each mapping patterns to one category and one policy area
(`voter_id`, `voter_registration`, `list_maintenance`, `absentee_mail_voting`,
`early_voting`, `ballot_return`, `polling_places`, `voter_assistance`,
`felony_disenfranchisement`, `election_administration`, `certification`,
`audits`, `poll_watchers`, `language_access`, `youth_voting`, …).

Rule semantics: `any` (≥1 must match) + optional `all` (all must match) +
optional `none` (suppressors). Directionality is encoded in the patterns —
e.g. *establishing* drop boxes is expansive (`E-RET-001`) while *capping or
removing* them is restrictive (`R-RET-002`); penalties *on election officials
for routine administration* are interference (`I-ADMIN-001`) while penalties
for *threatening* officials are suppressed by a `none` guard.

To extend: add a rule with a fresh stable id, then add a canonical-language
snippet test in `tests/test_rules.py`. The test suite is the lexicon's
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
  direction partially; flat PDFs don't mark deletions at all. Rules are
  written to key on directional language (*repeal, establish, no more than,
  at least*), but genuinely ambiguous provisions need a human.
- Scanned/image PDFs yield no text and come out `unprocessed` (an OCR stage
  could be added in `extract.py`).
- Resolutions, studies, and appropriations mostly (correctly) code neutral.

## Development

```bash
pip install -e ".[dev]"
python -m pytest        # 33 tests: lexicon regression, pipeline, web API
```
