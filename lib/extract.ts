/**
 * Text extraction from fetched documents (HTML or PDF).
 *
 * HTML notes:
 * - Stricken language (`<s>`, `<strike>`, `<del>`) is REMOVED before
 *   extraction: in enrolled bill texts, struck-through language is the law
 *   being deleted; classifying it as enacted would invert the meaning of
 *   amendments (striking a restriction is expansive, not restrictive).
 * - Script/style/nav chrome is dropped, and block elements produce line
 *   breaks so section-marker segmentation still works.
 *
 * PDF text is extracted per page via unpdf (pdf.js) and joined.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { extractText as unpdfExtract, getDocumentProxy } from "unpdf";

export class ExtractError extends Error {}

const MIN_TEXT_CHARS = 200;

const STRIP = new Set(["script", "style", "nav", "header", "footer", "s", "strike", "del"]);
const BLOCK = new Set([
  "p", "div", "section", "article", "li", "ul", "ol", "tr", "table",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "form",
]);

export function isPdf(bytes: Uint8Array, contentType: string): boolean {
  const magic = new TextDecoder().decode(bytes.slice(0, 5));
  return magic === "%PDF-" || contentType.toLowerCase().includes("pdf");
}

export async function extractDocText(
  bytes: Uint8Array,
  contentType: string,
  url: string,
): Promise<string> {
  const raw = isPdf(bytes, contentType) ? await extractPdf(bytes) : extractHtml(bytes);
  const text = normalize(raw);
  if (text.length < MIN_TEXT_CHARS) {
    throw new ExtractError(
      `extracted only ${text.length} chars from ${url}; ` +
        "page is likely a viewer shell, redirect, or scanned image PDF",
    );
  }
  return text;
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await unpdfExtract(pdf, { mergePages: false });
    return (text as string[]).join("\n");
  } catch (e) {
    throw new ExtractError(`PDF extraction failed: ${e}`);
  }
}

function extractHtml(bytes: Uint8Array): string {
  const $ = cheerio.load(new TextDecoder().decode(bytes));
  $(Array.from(STRIP).join(",")).remove();
  const root = $("body").get(0) ?? $.root().get(0);
  const parts: string[] = [];
  walk(root as AnyNode, parts);
  return parts.join("");
}

function walk(node: AnyNode, parts: string[]): void {
  if (node.type === "text") {
    parts.push((node as { data?: string }).data ?? "");
    return;
  }
  if (node.type === "tag" || node.type === "root") {
    const el = node as unknown as { name?: string; children?: AnyNode[] };
    const name = el.name?.toLowerCase() ?? "";
    if (name === "br") {
      parts.push("\n");
      return;
    }
    for (const child of el.children ?? []) walk(child, parts);
    if (BLOCK.has(name)) parts.push("\n");
    else if (name === "td" || name === "th") parts.push(" "); // keep table cells from merging into one word
  }
}

/** Collapse whitespace while keeping line structure for segmentation. */
export function normalize(text: string): string {
  let t = text.replace(/\r\n?/g, "\n");
  t = t.replace(/[ \t\u00a0]+/g, " ");
  t = t
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
