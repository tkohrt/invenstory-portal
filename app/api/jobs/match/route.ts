// Run a match, without holding the browser open for it.
//
// A route handler rather than a server action, for one reason that matters: it
// can declare how long it is allowed to take. A match makes up to seven calls
// to a service that naps and allows 150 seconds each, which is well past the
// default a server action gets. The old failure was a dead spinner and a
// half-written result with no way to tell which.
//
// The response returns as soon as the job row exists. The work continues in
// `after`, writing its progress to that row, and the page polls it. Someone can
// close the tab and find the answer waiting.
import { NextResponse } from "next/server";
import { after } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { runMatch } from "@/lib/server/matching";
import { createJob, updateJob, finishJob, failJob } from "@/lib/server/jobs";
import { db } from "@/lib/server/db";

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

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const multiQuery = body?.multiQuery !== false;

  const tenantId = session.tenantId;
  const tenant = await getTenant(tenantId);
  const orgName = tenant?.name ?? "the organization";
  const jobId = await createJob(tenantId, "match", `Searching for funding for ${orgName}`, session.user.id);

  after(async () => {
    try {
      const r = await runMatch(tenantId, orgName, {
        multiQuery, ranBy: session.user.id,
        onProgress: p => { void updateJob(tenantId, jobId, p); },
      });
      await finishJob(tenantId, jobId, {
        kept: r.grants.length, dropped: r.dropped, funders: r.funders.length,
        usedProfile: r.usedProfile, queries: r.queries.length,
      }, `${r.grants.length} opportunities kept, ${r.dropped} filtered out. `
        + `${r.funders.length} funders worth approaching. `
        + (r.usedProfile
            ? `Searched on the Inven(s)tory across ${r.queries.length} questions.`
            : "Searched on the eligibility form only, because there is no usable Search Profile yet."));
    } catch (e) {
      // No claim about what was or was not changed. A run can fail after the
      // grant tables are written and before the funder ones are, and telling
      // somebody their data is untouched when it is half-replaced is worse
      // than saying less.
      await failJob(tenantId, jobId,
        e instanceof Error ? e.message : "The search did not finish.");
      return;
    }

    // Outside the try on purpose. Audit is bookkeeping, and a failure to record
    // it must not overwrite a finished job with "that did not finish" when the
    // work actually succeeded and the tables were written.
    try {
      await db.from("audit_log").insert({
        actor_user_id: session.user.id, tenant_id: tenantId, action: "ledger_match",
        detail: `match run ${jobId}`,
      });
    } catch (e) { console.error("[match] audit write failed", e); }
  });

  return NextResponse.json({ jobId });
}
