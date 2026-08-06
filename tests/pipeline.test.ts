/** End-to-end behavior on fixtures (no network: fetch cache is pre-seeded). */

import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { aggregate } from "@/lib/aggregate";
import { extractDocText, normalize } from "@/lib/extract";
import { _seedCache } from "@/lib/fetchDoc";
import { makeCsv, makeJsonl } from "@/lib/output";
import { processBill, sourceCandidates } from "@/lib/pipeline";
import { loadRules } from "@/lib/rules";
import { segment } from "@/lib/segment";
import { parseSheet } from "@/lib/sheet";
import type { BillResult } from "@/lib/types";

const FIXTURES = path.join(__dirname, "fixtures");
const rules = loadRules();
const fixtureBytes = new Uint8Array(readFileSync(path.join(FIXTURES, "mixed_bill.html")));
const FIXTURE_URL = "https://fixture.test/mixed_bill.html";

beforeAll(() => {
  _seedCache(FIXTURE_URL, fixtureBytes, "text/html");
});

async function fixtureResult(): Promise<BillResult> {
  return processBill(
    { bill_number: "VA HB 100", url: FIXTURE_URL, state_link: FIXTURE_URL },
    rules,
  );
}

describe("extract", () => {
  it("drops stricken language and page chrome", async () => {
    const text = await extractDocText(fixtureBytes, "text/html", FIXTURE_URL);
    expect(text).not.toContain("may sign a statement"); // <s> content removed
    expect(text).not.toContain("var x");                // script removed
    expect(text).toContain("photographic identification");
  });

  it("normalizes whitespace but keeps line structure", () => {
    expect(normalize("a  b\r\n\r\n\r\n\r\nc\t d")).toBe("a b\n\nc d");
  });
});

describe("segment", () => {
  it("splits on statutory section markers", async () => {
    const text = await extractDocText(fixtureBytes, "text/html", FIXTURE_URL);
    const provisions = segment(text);
    expect(provisions.length).toBeGreaterThanOrEqual(3);
    expect(provisions[0].provisionId).toBe("P001");
  });
});

describe("pipeline + aggregate", () => {
  it("mixed bill yields restrictive + expansive records in fixed order", async () => {
    const records = aggregate(await fixtureResult());
    expect(records.map((r) => r.category)).toEqual(["restrictive", "expansive"]);
    const [restrictive, expansive] = records;
    expect(restrictive.policy_areas).toContain("voter_id");
    expect(expansive.policy_areas).toContain("absentee_mail_voting");
    for (const r of records) expect(r.evidence.length).toBeGreaterThan(0);
    // ID section and absentee section are different provisions -> no mixing
    expect(restrictive.needs_review).toBe(false);
    expect(expansive.needs_review).toBe(false);
  });

  it("fetch failure yields unprocessed, never neutral", async () => {
    const result = await processBill(
      { bill_number: "XX HB 1", url: "https://127.0.0.1:1/unreachable", state_link: "" },
      rules,
    );
    expect(result.status).toBe("fetch_error");
    const records = aggregate(result);
    expect(records).toHaveLength(1);
    expect(records[0].category).toBe("unprocessed");
    expect(records[0].needs_review).toBe(true);
  }, 30_000);

  it("no matches yields a single neutral record", () => {
    const records = aggregate({
      bill: { bill_number: "XX HB 2", url: "https://x.test", state_link: "" },
      status: "ok",
      sourceUsed: "https://x.test",
      textSha256: "0".repeat(64),
      provisions: [],
      matches: [],
      error: "",
    });
    expect(records.map((r) => r.category)).toEqual(["neutral"]);
  });

  it("is deterministic: identical results and serialization across runs", async () => {
    const a = aggregate(await fixtureResult());
    const b = aggregate(await fixtureResult());
    expect(a).toEqual(b);
    expect(makeCsv(a)).toBe(makeCsv(b));
    expect(makeJsonl(a)).toBe(makeJsonl(b));
    expect(a[0].text_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sourceCandidates", () => {
  const vaBill = {
    bill_number: "VA HB 967",
    url: "https://legiscan.com/VA/text/HB967/id/3423959",
    state_link: "https://lis.virginia.gov/bill-details/20261/HB967/text/CHAP0717",
  };

  it("derives VA law-portal and legacy mirrors after the SPA link", () => {
    const candidates = sourceCandidates(vaBill);
    expect(candidates[0]).toBe(vaBill.state_link);
    expect(candidates[1]).toBe("https://law.lis.virginia.gov/uncodifiedacts/2026/session1/chapter717/");
    expect(candidates[2]).toBe("https://legacylis.virginia.gov/cgi-bin/legp604.exe?261+ful+CHAP0717");
    expect(candidates).toContain(vaBill.url);
  });

  it("prefers the LegiScan API over the viewer page when a key is set via env", () => {
    process.env.LEGISCAN_API_KEY = "test-key";
    try {
      const candidates = sourceCandidates(vaBill);
      const api = candidates.indexOf("legiscan-api://3423959");
      expect(api).toBeGreaterThan(-1);
      expect(api).toBeLessThan(candidates.indexOf(vaBill.url));
    } finally {
      delete process.env.LEGISCAN_API_KEY;
    }
  });

  it("accepts a per-request LegiScan key without any env var", () => {
    const candidates = sourceCandidates(vaBill, { legiscanApiKey: "user-key" });
    expect(candidates).toContain("legiscan-api://3423959");
  });

  it("skips the law-portal mirror for non-chaptered documents", () => {
    const candidates = sourceCandidates({
      ...vaBill,
      state_link: "https://lis.virginia.gov/bill-details/20261/HB967/text/HB967ER",
    });
    expect(candidates.some((c) => c.includes("law.lis.virginia.gov"))).toBe(false);
    expect(candidates).toContain(
      "https://legacylis.virginia.gov/cgi-bin/legp604.exe?261+ful+HB967ER",
    );
  });

  it("skips empty inputs and dedupes", () => {
    const candidates = sourceCandidates({
      bill_number: "XX HB 1",
      url: "https://x.test/a",
      state_link: "https://x.test/a",
    });
    expect(candidates).toEqual(["https://x.test/a"]);
  });
});

describe("sheet parsing", () => {
  it("parses TSV", () => {
    const bills = parseSheet(
      "bill_number\turl\tstate_link\nVA HB 967\thttps://a.test/1\thttps://b.test/1\n",
    );
    expect(bills).toHaveLength(1);
    expect(bills[0].bill_number).toBe("VA HB 967");
  });

  it("parses CSV with quoted cells", () => {
    const bills = parseSheet(
      'bill_number,url,state_link\n"VA HB 967",https://a.test/1,"https://b.test/?x=1,2"\n',
    );
    expect(bills[0].state_link).toBe("https://b.test/?x=1,2");
  });

  it("rejects wrong columns", () => {
    expect(() => parseSheet("wrong,columns\na,b\n")).toThrow(/missing/);
  });
});
