/**
 * POST /api/classify — code one bill.
 *
 * Body:   { bill_number, url, state_link }
 * Result: { records: ImpactRecord[] }  (one per impact category, or a single
 *          neutral/unprocessed record)
 *
 * The client submits bills one at a time so progress is visible and a slow
 * state website can't stall a whole batch behind one request.
 */

import { NextResponse } from "next/server";

import { aggregate } from "@/lib/aggregate";
import { processBill } from "@/lib/pipeline";
import { loadRules } from "@/lib/rules";
import type { BillInput } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: Partial<BillInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const billNumber = (body.bill_number ?? "").trim();
  if (!billNumber) {
    return NextResponse.json({ error: "bill_number is required" }, { status: 400 });
  }
  const bill: BillInput = {
    bill_number: billNumber,
    url: (body.url ?? "").trim(),
    state_link: (body.state_link ?? "").trim(),
  };
  if (!bill.url && !bill.state_link) {
    return NextResponse.json({ error: "at least one of url / state_link is required" }, { status: 400 });
  }

  const result = await processBill(bill, loadRules());
  return NextResponse.json({ records: aggregate(result), error: result.error });
}
