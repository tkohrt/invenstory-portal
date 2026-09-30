// Build the Card Library, one invocation's worth at a time.
//
// The same shape as the Search Profile build, and for the same reason: reading a
// whole Inven(s)tory is minutes of model time and no single request gets that
// long. Each call reads what fits in 42 seconds, keeps it, and reports what is
// left; the page calls again until nothing is.
//
// Admin-only, always. The Card Library is For Granted's working view of a
// client's story and is never shown to a client account (Decision 1 of the
// Story Card Drafter spec).
//
// Three requests besides "carry on":
//   restart   forget what was read and read every document again (paid)
//   remerge   rebuild the library from what is already read (free)
//   stop      mark the chain ended, keeping everything read
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { db } from "@/lib/server/db";
import {
  continueCardBuild, clearCardDocs, cardBuildProgress, remergeLibrary, type MergeSummary,
} from "@/lib/server/card-extract";
import {
  createJob, updateJob, finishJob, failJob, claimJob, releaseJob, latestJob, recordEvent,
} from "@/lib/server/jobs";

export const maxDuration = 60;

const describeMerge = (m: MergeSummary) =>
  `${m.cards} live card(s): ${m.created} new, ${m.revived} restored, ${m.retired} retired `
  + `for lack of evidence, ${m.duplicates} possible duplicate(s) flagged for review.`;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const tenantId = session.tenantId;
  const tenant = await getTenant(tenantId);
  const orgName = tenant?.name ?? "this client";

  const existing = await latestJob(tenantId, "cards");
  const jobId = existing?.id ?? await createJob(
    tenantId, "cards", `Building ${orgName}'s Card Library`, session.user.id);

  // Free: re-merge from stored candidates without reading anything.
  if (body?.remerge) {
    try {
      const m = await remergeLibrary(tenantId);
      await recordEvent(tenantId, jobId, { kind: "done", text: `Re-merged from documents already read. ${describeMerge(m)}` });
      if (!existing) await finishJob(tenantId, jobId, { ...m }, describeMerge(m));
      return NextResponse.json({ jobId, complete: true, read: 0, remerged: true, merge: m, ...await cardBuildProgress(tenantId) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not re-merge the Card Library.";
      return NextResponse.json({ jobId, error: message }, { status: 500 });
    }
  }

  if (body?.stop) {
    await releaseJob(tenantId, jobId);
    if (!existing || existing.status === "running") {
      await failJob(tenantId, jobId, typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : "Reading stopped before it finished. What was read is saved.");
    }
    return NextResponse.json({ jobId, stopped: true, complete: false, ...await cardBuildProgress(tenantId) });
  }

  if (!await claimJob(tenantId, jobId)) {
    return NextResponse.json({ jobId, busy: true, complete: false, ...await cardBuildProgress(tenantId) });
  }

  if (body?.restart) await clearCardDocs(tenantId);

  if (!existing || body?.restart) {
    await recordEvent(tenantId, jobId, {
      kind: "phase",
      text: `Starting the Card Library build for ${orgName}. Each document is read once for claims a `
        + "writer could put in front of a funder, each proven by a quote. The code then refuses any card "
        + "whose quote is not in its document, whose figures are not in its quote, or which describes a competitor.",
    });
  }

  try {
    const { data: prof } = await db.from("eligibility_profile")
      .select("org_type").eq("tenant_id", tenantId).maybeSingle();
    const orgType = (prof?.org_type as string | null) ?? null;

    const r = await continueCardBuild(tenantId, orgName, orgType, {
      onProgress: p => { void updateJob(tenantId, jobId, p); },
      onEvent: e => { void recordEvent(tenantId, jobId, e); },
    });
    const progress = await cardBuildProgress(tenantId);

    if (r.complete) {
      await releaseJob(tenantId, jobId);
      await finishJob(tenantId, jobId, { ...(r.merge ?? {}) }, r.merge ? describeMerge(r.merge) : "Finished.");
    } else {
      await updateJob(tenantId, jobId, { detail: `${progress.done} of ${progress.total} documents read` });
      await releaseJob(tenantId, jobId);
    }
    return NextResponse.json({ jobId, complete: r.complete, read: r.read, remaining: r.remaining, ...progress });
  } catch (e) {
    await releaseJob(tenantId, jobId);
    const message = e instanceof Error ? e.message : "Could not finish reading the Inven(s)tory.";
    await failJob(tenantId, jobId, message);
    return NextResponse.json({ jobId, error: message }, { status: 500 });
  }
}
