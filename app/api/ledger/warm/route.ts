// Wake the funding service before anybody needs it.
//
// The free tier sleeps when idle, and the first call after a nap spends most of
// a minute starting up. Inside a run that wait is the difference between
// finishing and being killed at the function limit. Here it costs nothing: the
// page fires this on load, and by the time somebody has read the screen and
// pressed Run, the service is usually already awake.
//
// Deliberately says nothing useful back beyond whether it worked. It is a
// nudge, not a health check.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { warmLedger, ledgerConfigured } from "@/lib/server/ledger";
import { selfSearchOn } from "@/lib/server/client-view";

export const maxDuration = 60;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  // A client who may run its own searches wakes the service too (patch 7).
  if (session.role !== "admin" && !(await selfSearchOn(session.tenantId))) {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }
  if (!ledgerConfigured()) return NextResponse.json({ awake: false, configured: false });
  const r = await warmLedger();
  return NextResponse.json({ ...r, configured: true });
}
