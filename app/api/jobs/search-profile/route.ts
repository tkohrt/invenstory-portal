// Rebuild the Search Profile, without holding the browser open for it.
//
// A model call per document window, four documents at a time. On a client with
// a lot of Layer III transcripts that is minutes, which no request should be
// asked to survive.
import { NextResponse } from "next/server";
import { after } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { rebuildSearchProfile } from "@/lib/server/search-profile-extract";
import { createJob, updateJob, finishJob, failJob } from "@/lib/server/jobs";

// The plan's ceiling, not a wish. This Vercel team is on Hobby, which caps a
// function at 60 seconds, so a larger number here is silently ignored rather
// than granted, and pretending otherwise is how a run gets killed mid-write
// with the code believing it had five minutes.
//
// 60 seconds is genuinely tight for this work: the Ledger sleeps when idle and
// one cold call can eat most of the budget. That is why the job row exists.
// Work that runs out of time leaves a row that stops heartbeating and reads as
// stalled, which is recoverable and legible, rather than a dead spinner over
// half-written data. Raising this to 300 is a one-line change the day the plan
// allows it.
export const maxDuration = 60;

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }
  const tenantId = session.tenantId;
  const tenant = await getTenant(tenantId);
  const jobId = await createJob(
    tenantId, "search_profile",
    `Reading ${tenant?.name ?? "this client"}'s Inven(s)tory`, session.user.id);

  after(async () => {
    try {
      const r = await rebuildSearchProfile(tenantId, session.user.id, {
        onProgress: p => { void updateJob(tenantId, jobId, p); },
      });
      await finishJob(tenantId, jobId, {
        facts: r.profile.facts.length, scanned: r.scanned, skipped: r.skipped,
        silent: r.silent, usable: r.usable,
      }, `${r.profile.facts.length} facts from ${r.scanned} document(s)`
        + (r.skipped ? `, ${r.skipped} skipped` : "")
        + (r.silent ? `, ${r.silent} said nothing useful` : "")
        + `. ${r.note}`);
    } catch (e) {
      await failJob(tenantId, jobId,
        e instanceof Error ? e.message : "Could not finish reading the Inven(s)tory.");
    }
  });

  return NextResponse.json({ jobId });
}
