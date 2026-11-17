import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { runRfp } from "@/lib/server/rfp-run";

// The candidate pull reads descriptions (about 13 seconds cold), then up to 15
// fit calls five at a time.
export const maxDuration = 300;

/** Run one client's RFP scan now. For Granted only. POST: it spends and writes. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });
  const tenantId = new URL(req.url).searchParams.get("tenant") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return NextResponse.json({ ok: false, error: "No client given." }, { status: 400 });
  return NextResponse.json(await runRfp(tenantId, "admin", session.user.id));
}
