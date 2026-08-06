/**
 * Server-side orchestration for a single bill:
 * fetch (state link first, LegiScan fallback) → extract → segment → classify.
 */

import { createHash } from "node:crypto";

import { classifyProvisions } from "./classify";
import { ExtractError, extractDocText } from "./extract";
import { FetchError, fetchDoc } from "./fetchDoc";
import type { Rule } from "./rules";
import { segment } from "./segment";
import type { BillInput, BillResult } from "./types";

function emptyResult(bill: BillInput): BillResult {
  return {
    bill,
    status: "ok",
    sourceUsed: "",
    textSha256: "",
    provisions: [],
    matches: [],
    error: "",
  };
}

export async function processBill(bill: BillInput, rules: Rule[]): Promise<BillResult> {
  const sources = [bill.state_link, bill.url].filter(Boolean);
  const result = emptyResult(bill);

  let doc: Awaited<ReturnType<typeof fetchDoc>> | null = null;
  const fetchErrors: string[] = [];
  for (const url of sources) {
    try {
      doc = await fetchDoc(url);
      break;
    } catch (e) {
      if (e instanceof FetchError) fetchErrors.push(e.message);
      else throw e;
    }
  }
  if (!doc) {
    return { ...result, status: "fetch_error", error: fetchErrors.join("; ") };
  }

  let text: string;
  try {
    text = await extractDocText(doc.bytes, doc.contentType, doc.url);
  } catch (e) {
    if (!(e instanceof ExtractError)) throw e;
    // The preferred source may be a JS viewer shell or scanned PDF;
    // try the fallback URL before giving up.
    const fallback = doc.url === bill.state_link ? bill.url : "";
    if (!fallback) {
      return { ...result, status: "extract_error", sourceUsed: doc.url, error: e.message };
    }
    try {
      doc = await fetchDoc(fallback);
      text = await extractDocText(doc.bytes, doc.contentType, doc.url);
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : String(e2);
      return {
        ...result,
        status: "extract_error",
        sourceUsed: doc.url,
        error: `${e.message}; fallback: ${msg}`,
      };
    }
  }

  const provisions = segment(text);
  return {
    ...result,
    sourceUsed: doc.url,
    textSha256: createHash("sha256").update(text, "utf-8").digest("hex"),
    provisions,
    matches: classifyProvisions(provisions, rules),
  };
}
