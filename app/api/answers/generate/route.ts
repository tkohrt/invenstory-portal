// Trigger Answer Library generation for the active tenant (admin, or the
// tenant's own client). Mirrors /api/si/generate.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { generateAnswers } from "@/lib/server/answers";

export const maxDuration = 120;

export async function POST(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { data: t } = await db.from("tenant").select("org_type").eq("id", session.tenantId).single();
    const r = await generateAnswers(session.tenantId, (t?.org_type as "nonprofit" | "startup" | null) ?? null);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
