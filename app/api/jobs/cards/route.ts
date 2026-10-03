// Build the Card Library, in stages the server carries on by itself.
//
// Reading a whole Inven(s)tory is minutes of model time and no single request
// gets that long, so the build runs in stages of about 35 seconds. Until
// 1 October 2026 the page called each stage, so closing it paused the build.
// Now the page starts the build and watches; each stage hands on to the next
// itself (lib/server/job-chain.ts), and the portal shows the build's progress
// and an estimate wherever the admin, or the client, happens to be.
//
// Admin-only to start, stop or re-merge.
//
// Requests:
//   begin     create or rejoin the job and answer at once, reading nothing
//   kick      start the server-carried chain from where reading stopped
//             (with restart: forget what was read and read everything again, paid)
//   remerge   rebuild the library from what is already read (free)
//   stop      mark the build ended, keeping everything read
//   (none)    the same as kick, for a page from before this change
import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { db } from "@/lib/server/db";
import { clearCardDocs, cardBuildProgress, remergeLibrary } from "@/lib/server/card-extract";
import { createJob, supersedeRunning, finishJob, failJob, releaseJob, latestJob, recordEvent } from "@/lib/server/jobs";
import { describeMerge } from "@/lib/server/card-build";
import { scheduleCardPass } from "@/lib/server/job-chain";

export const maxDuration = 60;

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
  if (!existing) await supersedeRunning(tenantId, "cards", jobId);

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

  const opening = () => recordEvent(tenantId, jobId, {
    kind: "phase",
    text: `Starting the Card Library build for ${orgName}. Each document is read once for claims a `
      + "writer could put in front of a funder, each proven by a quote. The code then refuses any card "
      + "whose quote is not in its document, whose figures are not in its quote, or which describes a competitor.",
  });

  /**
   * Acknowledge at once, read nothing.
   *
   * A reading stage runs for up to 42 seconds before it can answer, and the page
   * learned the job existed only from that answer: on 30 September that was a
   * 25-second pause after pressing Build with nothing on screen, long enough to
   * wonder whether the click registered. The page now asks for this first, gets
   * the job id back in well under a second, and watches the job's own log while
   * the stages run, so the first document read appears as it happens.
   */
  if (body?.begin) {
    if (!existing || body?.restart) await opening();
    return NextResponse.json({ jobId, begun: true, ...await cardBuildProgress(tenantId) });
  }

  // Start, or restart, the chain. Answers at once; the stages run on the server.
  if (body?.restart) {
    await clearCardDocs(tenantId);
    if (!body?.begun) await opening();
  } else if (!body?.begun && !existing) {
    await opening();
  }
  await db.from("job").update({ chain_passes: 0, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", jobId).eq("status", "running");
  await recordEvent(tenantId, jobId, {
    kind: "phase",
    text: "Reading in stages on the server. This page can be closed: the build carries on, and the portal shows its progress wherever you are.",
  });
  const origin = new URL(req.url).origin;
  after(async () => { await scheduleCardPass(origin, tenantId, jobId); });
  return NextResponse.json({ jobId, chained: true, complete: false, ...await cardBuildProgress(tenantId) });
}
