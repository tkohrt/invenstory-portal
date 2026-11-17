import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { runGolden } from "@/lib/server/rfp-golden-run";

// Twenty rows, five model calls at a time: well inside a minute.
export const maxDuration = 60;

/** Run the RFP Engine's golden set against the live model. For Granted only. POST: it spends and records. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });
  return NextResponse.json(await runGolden(session.user.id));
}
