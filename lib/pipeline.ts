/**
 * Server-side orchestration for a single bill:
 * build source candidates → fetch → extract → segment → classify,
 * moving to the next candidate on any failure.
 */

import { createHash } from "node:crypto";

import { classifyProvisions } from "./classify";
import { ExtractError, extractDocText } from "./extract";
import { FetchError, fetchDoc } from "./fetchDoc";
import type { Rule } from "./rules";
import { segment } from "./segment";
import type { BillInput, BillResult } from "./types";

/**
 * Ordered list of URLs to try for a bill: the state link first (usually the
 * enrolled/chaptered text), then LegiScan, then derived alternates for hosts
 * we know serve viewer shells instead of text:
 *
 * - lis.virginia.gov's bill-details pages are a JS single-page app with no
 *   server-rendered text; the legacy CGI serves the same document as plain
 *   HTML (best-effort — tried only after the originals fail).
 * - legiscan.com text pages are document-viewer shells; when
 *   LEGISCAN_API_KEY is set we pull the document itself via LegiScan's API
 *   (the sanctioned, reliable route).
 */
export function sourceCandidates(bill: BillInput): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };

  // 1. State legislature text, then its plain-HTML mirror where we know one.
  push(bill.state_link);
  const va = bill.state_link.match(
    /^https?:\/\/lis\.virginia\.gov\/bill-details\/(\d{5})\/\w+\/text\/(\w+)/i,
  );
  if (va) {
    // Session "20261" → legacy session code "261".
    push(`https://legacylis.virginia.gov/cgi-bin/legp604.exe?${va[1].slice(2)}+ful+${va[2]}`);
  }

  // 2. LegiScan: prefer the API (reliable, sanctioned) over scraping the
  //    viewer page, whenever a key is configured.
  const ls = bill.url.match(/^https?:\/\/legiscan\.com\/\w+\/text\/[\w.]+\/id\/(\d+)/i);
  if (ls && process.env.LEGISCAN_API_KEY) push(`legiscan-api://${ls[1]}`);
  push(bill.url);

  return out;
}

export async function processBill(bill: BillInput, rules: Rule[]): Promise<BillResult> {
  const errors: string[] = [];
  let anyFetched = false;
  let lastFetchedUrl = "";

  for (const url of sourceCandidates(bill)) {
    let doc;
    try {
      doc = await fetchDoc(url);
    } catch (e) {
      if (!(e instanceof FetchError)) throw e;
      errors.push(e.message);
      continue;
    }
    anyFetched = true;
    lastFetchedUrl = doc.url;

    let text: string;
    try {
      text = await extractDocText(doc.bytes, doc.contentType, doc.url);
    } catch (e) {
      if (!(e instanceof ExtractError)) throw e;
      errors.push(e.message);
      continue;
    }

    const provisions = segment(text);
    return {
      bill,
      status: "ok",
      sourceUsed: doc.url,
      textSha256: createHash("sha256").update(text, "utf-8").digest("hex"),
      provisions,
      matches: classifyProvisions(provisions, rules),
      error: "",
    };
  }

  return {
    bill,
    status: anyFetched ? "extract_error" : "fetch_error",
    sourceUsed: lastFetchedUrl,
    textSha256: "",
    provisions: [],
    matches: [],
    error: errors.join(" | "),
  };
}
