"use client";

/**
 * The Impact Coder UI. The client parses the bill sheet, submits bills to
 * /api/classify one at a time (visible progress, no long-running job state
 * on the server), groups the returned Impact/Bill records into cards, and
 * builds impacts.csv / evidence.jsonl downloads locally.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { makeCsv, makeJsonl } from "@/lib/output";
import { parseSheet } from "@/lib/sheet";
import type { ImpactRecord } from "@/lib/types";

const CAT_LABEL: Record<string, string> = {
  restrictive: "Restrictive",
  expansive: "Expansive",
  election_interference: "Election interference",
  neutral: "Neutral",
  unprocessed: "Unprocessed",
};

interface RuleInfo {
  id: string;
  category: string;
  policy_area: string;
  description: string;
}

interface Progress {
  done: number;
  total: number;
  current: string;
}

const PLACEHOLDER =
  "bill_number\turl\tstate_link\n" +
  "VA HB 967\thttps://legiscan.com/VA/text/HB967/id/3423959\thttps://lis.virginia.gov/bill-details/20261/HB967/text/CHAP0717";

export default function Page() {
  const [sheet, setSheet] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [records, setRecords] = useState<ImpactRecord[]>([]);
  const [rules, setRules] = useState<RuleInfo[] | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setApiKey(localStorage.getItem("legiscan_api_key") ?? "");
  }, []);

  const updateApiKey = useCallback((value: string) => {
    setApiKey(value);
    localStorage.setItem("legiscan_api_key", value);
  }, []);

  const run = useCallback(async () => {
    let text = sheet;
    const file = fileRef.current?.files?.[0];
    if (file) {
      text = await file.text();
      // One-shot: clear the picker so later runs use the textarea unless a
      // file is chosen again (otherwise a stale file silently wins).
      fileRef.current!.value = "";
      setSheet(text);
    }
    let bills;
    try {
      bills = parseSheet(text);
      if (!bills.length) throw new Error("no bills found in input");
    } catch (e) {
      alert(`Could not read the bill sheet: ${e instanceof Error ? e.message : e}`);
      return;
    }

    setRunning(true);
    setRecords([]);
    const collected: ImpactRecord[] = [];
    for (let i = 0; i < bills.length; i++) {
      const bill = bills[i];
      setProgress({ done: i, total: bills.length, current: bill.bill_number });
      try {
        const resp = await fetch("/api/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...bill, legiscan_api_key: apiKey.trim() || undefined }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`);
        collected.push(...data.records);
      } catch (e) {
        collected.push({
          bill_number: bill.bill_number,
          state: bill.bill_number.split(/\s+/)[0] ?? "",
          category: "unprocessed",
          policy_areas: [],
          rule_ids: [],
          n_provisions: 0,
          evidence: [],
          source_used: "",
          text_sha256: "",
          status: "fetch_error",
          needs_review: true,
          error: e instanceof Error ? e.message : String(e),
        });
        console.error(`classify failed for ${bill.bill_number}:`, e);
      }
      setRecords([...collected]);
    }
    setProgress({ done: bills.length, total: bills.length, current: "" });
    setRunning(false);
  }, [sheet]);

  const toggleRules = useCallback(async () => {
    setRulesOpen((open) => !open);
    if (!rules) {
      const resp = await fetch("/api/rules");
      setRules(await resp.json());
    }
  }, [rules]);

  const download = useCallback(
    (filename: string, content: string, mime: string) => {
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [],
  );

  const byBill = new Map<string, ImpactRecord[]>();
  for (const r of records) {
    if (!byBill.has(r.bill_number)) byBill.set(r.bill_number, []);
    byBill.get(r.bill_number)!.push(r);
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <header className="masthead">
        <div className="kicker">Deterministic Provision-Level Coding</div>
        <h1>Voting Legislation Impact&nbsp;Coder</h1>
        <p className="sub">
          Paste a bill sheet below. Each bill&rsquo;s enacted text is fetched, split into
          provisions, and coded against a transparent rule lexicon. Output is one record per
          impact per bill — a bill can be both restrictive and expansive at once.
        </p>
        <div className="catkey">
          <span className="k-restrictive">Restrictive — harder to register, stay registered, or vote</span>
          <span className="k-expansive">Expansive — easier to register, stay registered, or vote</span>
          <span className="k-interference">
            Election interference — threatens people/processes or invites partisan interference
          </span>
          <span className="k-neutral">Neutral — no provision reaches a threshold</span>
        </div>
      </header>

      <main className="grid">
        <section className="panel" aria-label="Input">
          <div className="panel-head">
            <h2>Bill sheet</h2>
            <span className="hint">TSV or CSV</span>
          </div>
          <div className="panel-body">
            <label className="small" htmlFor="sheet">
              bill_number &nbsp;·&nbsp; url &nbsp;·&nbsp; state_link
            </label>
            <textarea
              id="sheet"
              spellCheck={false}
              placeholder={PLACEHOLDER}
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
            />
            <div className="or-row">or upload a file</div>
            <input type="file" ref={fileRef} accept=".tsv,.csv,.txt" />
            <div className="key-row">
              <label className="small" htmlFor="apikey">
                LegiScan API key — optional, recommended
              </label>
              <input
                id="apikey"
                type="password"
                className="key-input"
                placeholder="free at legiscan.com/legiscan"
                value={apiKey}
                onChange={(e) => updateApiKey(e.target.value)}
                autoComplete="off"
              />
              <p className="key-note">
                With a key, bills are fetched through LegiScan&rsquo;s API — the reliable path
                when a state site is a JS app, a scanned PDF, or blocks automated traffic.
                Stored only in your browser.
              </p>
            </div>
            <button className="primary" onClick={run} disabled={running}>
              {running ? "Coding…" : "Classify bills"}
            </button>

            {progress && (
              <div className="progress">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="progress-label">
                  {progress.done === progress.total
                    ? `done — ${progress.total} bill${progress.total === 1 ? "" : "s"} coded`
                    : `${progress.done}/${progress.total} · fetching & coding ${progress.current}`}
                </div>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <button className="rules-toggle" onClick={toggleRules}>
                {rulesOpen ? "Hide the rule lexicon ▾" : "View the rule lexicon ▸"}
              </button>
              {rulesOpen && (
                <div className="rules-list">
                  {(rules ?? []).map((r) => (
                    <div className="rule" key={r.id}>
                      <b>{r.id}</b> — <span className={`chip ${r.category}`}>{CAT_LABEL[r.category]}</span>{" "}
                      {r.description} <i>({r.policy_area})</i>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section aria-label="Results">
          {records.length > 0 && !running && (
            <div className="downloads">
              <button onClick={() => download("impacts.csv", makeCsv(records), "text/csv")}>
                Download impacts.csv
              </button>
              <button
                onClick={() => download("evidence.jsonl", makeJsonl(records), "application/jsonl")}
              >
                Download evidence.jsonl
              </button>
            </div>
          )}
          {records.length === 0 && (
            <div className="results-empty">Coded results will appear here, one card per bill.</div>
          )}
          {[...byBill.entries()].map(([billNumber, billRecords], i) => (
            <BillCard key={billNumber} billNumber={billNumber} records={billRecords} index={i} />
          ))}
        </section>
      </main>

      <footer className="colophon">
        Deterministic by construction: the same bill text and the same rule lexicon always produce
        the same coding. Every record carries the rule IDs and text excerpts that triggered it,
        plus a SHA-256 of the classified text, so results are auditable and reproducible. Records
        flagged <b>needs review</b> — and any policy-significant coding — should be confirmed by a
        human coder; the lexicon is a screening instrument, not a final judgment.
      </footer>
    </>
  );
}

function BillCard({
  billNumber,
  records,
  index,
}: {
  billNumber: string;
  records: ImpactRecord[];
  index: number;
}) {
  const cats = records.map((r) => r.category);
  const edge = cats.includes("election_interference")
    ? "var(--interference)"
    : cats.includes("restrictive")
      ? "var(--restrictive)"
      : cats.includes("expansive")
        ? "var(--expansive)"
        : cats.includes("unprocessed")
          ? "var(--error)"
          : "var(--neutral)";
  const src = records[0]?.source_used;

  return (
    <article
      className="bill-card"
      style={{ borderLeftColor: edge, animationDelay: `${Math.min(index * 60, 600)}ms` }}
    >
      <div className="bill-head">
        <h3>{billNumber}</h3>
        {src ? <span className="src">{src}</span> : null}
      </div>
      {records.map((r, i) =>
        r.status !== "ok" ? (
          <div className="bill-error" key={i}>
            Could not process this bill ({r.status}). Check the source links, or retry — it is{" "}
            <i>not</i> coded neutral.
            {r.error && <div className="error-detail">{r.error}</div>}
          </div>
        ) : (
          <div className="impact-row" key={i}>
            <div className="impact-top">
              <span className={`chip ${r.category}`}>{CAT_LABEL[r.category] ?? r.category}</span>
              {r.needs_review && <span className="review-flag">needs review</span>}
              {r.policy_areas.length > 0 && (
                <span className="areas">
                  <b>Policy areas:</b> {r.policy_areas.join(", ")}
                </span>
              )}
            </div>
            {r.evidence.length > 0 && (
              <details className="evidence">
                <summary>
                  {r.evidence.length} matched provision excerpt{r.evidence.length === 1 ? "" : "s"} ·
                  rules: {r.rule_ids.join(", ")}
                </summary>
                {r.evidence.map((e, j) => (
                  <div className="ev-item" key={j}>
                    <div className="meta">
                      {e.provision_id} · {e.rule_id}
                    </div>
                    <blockquote>{e.excerpt}</blockquote>
                  </div>
                ))}
              </details>
            )}
          </div>
        ),
      )}
    </article>
  );
}
