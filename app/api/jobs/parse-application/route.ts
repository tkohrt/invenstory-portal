// Read a funder's application into questions, one invocation's worth at a time.
//
// The same chained shape as the Card Library build: each call does what fits in
// about 42 seconds, keeps it, and says whether anything is left; the page calls
// again until nothing is. One job per draft, remembered on the draft itself, so
// two applications being read for the same client never share a progress bar.
//
// Admin-only. The drafter is For Granted's working tool and is never shown to a
// client account (Decision 1 of the Story Card Drafter spec).
//
// Requests:
//   begin    create or rejoin this draft's job and answer at once, reading nothing
//   restart  throw away the parse and read again (refused once confirmed)
//   stop     mark the job ended, keeping what was read
//   (none)   carry on
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { continueParse, parseJobId, setParseJob, resetParse } from "@/lib/server/application-parse";
import {
  createJob, updateJob, finishJob, failJob, claimJob, releaseJob, getJob, recordEvent,
} from "@/lib/server/jobs";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({})) as { draftId?: string; begin?: boolean; restart?: boolean; stop?: boolean };
  const draftId = typeof body.draftId === "string" ? body.draftId : "";
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return NextResponse.json({ error: "draftId required" }, { status: 400 });
  const tenantId = session.tenantId;

  try {
    const tenant = await getTenant(tenantId);
    const orgName = tenant?.name ?? "this client";

    // One job per draft. A finished or dead job is not rejoined: a new request
    // to read starts a new one, so the log shows this run and only this run.
    const knownId = await parseJobId(tenantId, draftId);
    const known = knownId ? await getJob(tenantId, knownId) : null;
    let jobId = known && known.status === "running" ? known.id : null;
    const fresh = !jobId || !!body.restart;
    if (fresh) {
      if (jobId) await failJob(tenantId, jobId, "Replaced by a fresh read of the application.");
      jobId = await createJob(tenantId, "parse_application", "Reading the funder's application", session.user.id);
      if (body.restart) await resetParse(tenantId, draftId, jobId);
      else await setParseJob(tenantId, draftId, jobId);
    }
    const id = jobId!;

    if (body.stop) {
      await releaseJob(tenantId, id);
      await failJob(tenantId, id, "Stopped before it finished. What was read is saved.");
      return NextResponse.json({ jobId: id, stopped: true, complete: false });
    }
    if (body.begin) return NextResponse.json({ jobId: id, begun: true });

    if (!await claimJob(tenantId, id)) return NextResponse.json({ jobId: id, busy: true, complete: false });

    const r = await continueParse(tenantId, draftId, orgName, {
      onProgress: p => { void updateJob(tenantId, id, p); },
      onEvent: (kind, text, done, total) => { void recordEvent(tenantId, id, { kind, text, done, total }); },
    });
    await releaseJob(tenantId, id);
    if (r.complete) {
      await finishJob(tenantId, id, { questions: r.total }, `${r.total} question(s) ready to confirm.`);
    }
    return NextResponse.json({ jobId: id, ...r });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not read the application.";
    const knownId = await parseJobId(tenantId, draftId).catch(() => null);
    if (knownId) { await releaseJob(tenantId, knownId); await failJob(tenantId, knownId, message); }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
