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
  continueProfileBuild, clearProfileDocs, profileBuildProgress,
} from "@/lib/server/search-profile-extract";
import { createJob, updateJob, finishJob, failJob, claimJob, releaseJob, latestJob } from "@/lib/server/jobs";

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

  if (!await claimJob(tenantId, jobId)) {
    const p = await profileBuildProgress(tenantId);
    return NextResponse.json({ jobId, busy: true, complete: false, ...p });
  }

  // Clearing happens under the lease, so a concurrent invocation cannot be
  // assembling a profile from rows this is deleting.
  if (body?.restart) await clearProfileDocs(tenantId);

  try {
    const r = await continueProfileBuild(tenantId, session.user.id, {
      onProgress: p => { void updateJob(tenantId, jobId, p); },
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
    return NextResponse.json({ jobId, complete: r.complete, read: r.read, ...progress });
  } catch (e) {
    await releaseJob(tenantId, jobId);
    const message = e instanceof Error ? e.message : "Could not finish reading the Inven(s)tory.";
    await failJob(tenantId, jobId, message);
    return NextResponse.json({ jobId, error: message }, { status: 500 });
  }
}
