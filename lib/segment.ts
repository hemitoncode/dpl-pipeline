/**
 * Split extracted bill text into provisions.
 *
 * A "provision" is a section-level unit: rules are evaluated per provision so
 * that (a) evidence excerpts point at the specific section that triggered a
 * category and (b) proximity windows in rule regexes cannot span unrelated
 * sections.
 *
 * Strategy: split on statutory section markers ("SECTION 1.", "Sec. 3.",
 * "§ 24.2-643", "Be it enacted"); if fewer than two markers are found (common
 * for flat PDF extractions), fall back to fixed-size paragraph chunks.
 */

import type { Provision } from "./types";

const SECTION_RE =
  /^(?:(?:SECTION|Section|Sec\.)\s+\d+[A-Za-z]?\s*[.:]|§+\s*[\d.][-\d.A-Za-z:]*|Be it enacted\b)/gm;

const FALLBACK_CHUNK_CHARS = 2500;
const MIN_PROVISION_CHARS = 40;

export function segment(text: string): Provision[] {
  const starts = [...text.matchAll(SECTION_RE)].map((m) => m.index);
  let chunks: string[];
  if (starts.length >= 2) {
    chunks = [];
    if (starts[0] > 0) chunks.push(text.slice(0, starts[0])); // preamble / title
    const bounds = [...starts, text.length];
    for (let i = 0; i < starts.length; i++) chunks.push(text.slice(bounds[i], bounds[i + 1]));
  } else {
    chunks = fallbackChunks(text);
  }

  const provisions: Provision[] = [];
  for (const rawChunk of chunks) {
    const chunk = rawChunk.trim();
    if (chunk.length < MIN_PROVISION_CHARS) continue;
    provisions.push({
      provisionId: `P${String(provisions.length + 1).padStart(3, "0")}`,
      heading: chunk.split("\n", 1)[0].slice(0, 120),
      text: chunk,
    });
  }
  if (provisions.length === 0 && text.trim()) {
    const t = text.trim();
    provisions.push({ provisionId: "P001", heading: t.split("\n", 1)[0].slice(0, 120), text: t });
  }
  return provisions;
}

function fallbackChunks(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    if (current && current.length + para.length > FALLBACK_CHUNK_CHARS) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
