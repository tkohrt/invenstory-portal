// Document Reader, Phase 0: store the text of every client's documents read
// before Phase 0 (lib/server/doc-text-backfill.ts). For Granted only. Starts one
// server-carried run per client with documents still to store, answers at
// once, and the runs carry on whether or not the page stays open. Free: no
// model is called. Safe to press again: a run only takes documents with no
// stored text, so pressing twice never stores anything twice.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { startDocTextBackfill } from "@/lib/server/doc-text-backfill";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Only For Granted can do this." }, { status: 403 });
  try {
    const r = await startDocTextBackfill(new URL(req.url).origin, session.user.id);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not start." }, { status: 500 });
  }
}
