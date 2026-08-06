import { NextResponse } from "next/server";

import { loadRules } from "@/lib/rules";

export const dynamic = "force-dynamic";

export async function GET() {
  const rules = loadRules().map((r) => ({
    id: r.id,
    category: r.category,
    policy_area: r.policyArea,
    description: r.description,
  }));
  return NextResponse.json(rules);
}
