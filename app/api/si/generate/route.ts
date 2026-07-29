// Trigger Story Intelligence generation for the active tenant (admin, or the
// tenant's own client). Also the harness that proves engine genericness.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { generateArtifact } from "@/lib/server/artifacts";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  try {
    const r = await generateArtifact(session.tenantId, slug);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
