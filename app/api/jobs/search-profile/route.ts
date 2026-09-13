// Build the Search Profile, one invocation's worth at a time.
//
// RE-Assist's Inven(s)tory is 15 documents and about 37 model windows, two to
// three minutes of reading. No function budget survives that, and the old
// all-or-nothing build threw away everything it had read each time it died.
//
// So each call reads what fits in its budget, keeps it, and REPORTS WHAT IS
// LEFT. The work happens inside the request rather than in `after`, because the
// caller has to be told the truth to decide whether to come back: a response
// that returns before the work is done can only guess. The budget is 42
// seconds against a 60-second limit, so this always answers.
//
// Safe to repeat and safe to interrupt. A document already read is not read
// again, and one whose text has changed since is.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import {
  continueProfileBuild, clearProfileDocs, profileBuildProgress, assembleProfile,
} from "@/lib/server/search-profile-extract";
import {
  createJob, updateJob, finishJob, failJob, claimJob, releaseJob, latestJob, recordEvent,
} from "@/lib/server/jobs";
import { PROFILE_INTRO } from "@/lib/search-profile";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const tenantId = session.tenantId;

  // Continue the chain rather than starting a second one beside it. Even on a
  // restart: reusing the row keeps the lease meaningful, which is what stops
  // two tabs reading the same documents for the same money.
  const existing = await latestJob(tenantId, "search_profile");
  const tenant = await getTenant(tenantId);
  const jobId = existing?.id ?? await createJob(
    tenantId, "search_profile",
    `Reading ${tenant?.name ?? "this client"}'s Inven(s)tory`, session.user.id);

  /**
   * Re-merge what is already read, without reading anything again.
   *
   * The reading is the expensive half and the merging is free, and they change
   * for different reasons. When the merge RULE changes (as it did when facets
   * turned out to be filled entirely from one layer), every document's facts
   * are still on disk and still correct; only the selection from them is wrong.
   * Rebuilding would spend minutes and real money re-reading unchanged
   * documents to reach the same stored facts.
   */
  if (body?.reassemble) {
    try {
      const r = await assembleProfile(tenantId, session.user.id);
      await recordEvent(tenantId, jobId, {
        kind: "done",
        text: `Rebuilt the profile from documents already read: ${r.profile.facts.length} fact(s). ${r.note}`.trim(),
      });
      const p = await profileBuildProgress(tenantId);
      return NextResponse.json({ jobId, complete: true, read: 0, reassembled: true, ...p });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not rebuild the profile.";
      return NextResponse.json({ jobId, error: message }, { status: 500 });
    }
  }

  // The chain giving up is a real end state, and it has to reach the row.
  // Otherwise the browser stops while the row still says "running", and the
  // progress panel spins over work that ended minutes ago.
  if (body?.stop) {
    await releaseJob(tenantId, jobId);
    if (!existing || existing.status === "running") {
      await failJob(tenantId, jobId, typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : "Reading stopped before it finished. What was read is saved.");
    }
    return NextResponse.json({ jobId, stopped: true, complete: false, ...await profileBuildProgress(tenantId) });
  }

  if (!await claimJob(tenantId, jobId)) {
    const p = await profileBuildProgress(tenantId);
    return NextResponse.json({ jobId, busy: true, complete: false, ...p });
  }

  // Clearing happens under the lease, so a concurrent invocation cannot be
  // assembling a profile from rows this is deleting.
  if (body?.restart) await clearProfileDocs(tenantId);

  // The opening of the log, written once per run rather than once per stage.
  // A build is several invocations and only the first one is a beginning.
  if (!existing || body?.restart) {
    await recordEvent(tenantId, jobId, {
      kind: "phase",
      text: `Starting the Funder Matching Profile build for ${tenant?.name ?? "this client"}.`,
    });
    await recordEvent(tenantId, jobId, { kind: "phase", text: PROFILE_INTRO });
  }

  try {
    const r = await continueProfileBuild(
      tenantId, session.user.id, tenant?.name ?? "this client", {
      onProgress: p => { void updateJob(tenantId, jobId, p); },
      onEvent: e => { void recordEvent(tenantId, jobId, e); },
    });
    const progress = await profileBuildProgress(tenantId);

    if (r.complete) {
      await releaseJob(tenantId, jobId);
      await finishJob(tenantId, jobId,
        { facts: r.profile?.facts.length ?? 0, documents: r.profile?.documentCount ?? 0, usable: r.usable },
        `${r.profile?.facts.length ?? 0} facts from ${r.profile?.documentCount ?? 0} document(s). ${r.note ?? ""}`.trim());
    } else {
      // Not a failure. Out of budget with work left, which is the design.
      await updateJob(tenantId, jobId, { detail: `${progress.done} of ${progress.total} documents read` });
      await releaseJob(tenantId, jobId);
    }
    // `read` is the honest signal for the caller's decision to come back:
    // `done` counts what exists, `read` counts what THIS invocation achieved.
    return NextResponse.json({ jobId, complete: r.complete, read: r.read, remaining: r.remaining, ...progress });
  } catch (e) {
    await releaseJob(tenantId, jobId);
    const message = e instanceof Error ? e.message : "Could not finish reading the Inven(s)tory.";
    await failJob(tenantId, jobId, message);
    return NextResponse.json({ jobId, error: message }, { status: 500 });
  }
}
