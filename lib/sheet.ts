/**
 * Input sheet parsing (pure, usable client-side).
 *
 * TSV or CSV with required columns bill_number, url, state_link; the
 * delimiter is sniffed from the header line. CSV values may be quoted.
 */

import type { BillInput } from "./types";

export function parseSheet(text: string): BillInput[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!clean) throw new Error("input is empty");
  const lines = clean.split("\n");
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const header = splitRow(lines[0], delimiter).map((h) => h.trim().toLowerCase());
  const required = ["bill_number", "url", "state_link"];
  const idx = Object.fromEntries(required.map((c) => [c, header.indexOf(c)]));
  const missing = required.filter((c) => idx[c] === -1);
  if (missing.length) {
    throw new Error(`input must have columns ${required.join(", ")}; missing: ${missing.join(", ")}`);
  }
  const bills: BillInput[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitRow(line, delimiter);
    const billNumber = (cells[idx.bill_number] ?? "").trim();
    if (!billNumber) continue;
    bills.push({
      bill_number: billNumber,
      url: (cells[idx.url] ?? "").trim(),
      state_link: (cells[idx.state_link] ?? "").trim(),
    });
  }
  return bills;
}

function splitRow(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t");
  // Minimal quote-aware CSV split.
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}
