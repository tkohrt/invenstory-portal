// Finish the explanations a cut-short run did not reach.
//
// A match run is not resumable: it is one snapshot, and half a snapshot is
// worse than none. Its long tail is, though. Rationales are a model call per
// batch, they write to rows that already exist, and repeating one costs nothing
// but a little money. So the part most likely to be killed by the function
// limit is the part made restartable, and the rest is left alone.
//
// Safe to call repeatedly. Each call fills what it can and reports what is
// left, so the page keeps calling until nothing is pending.
import { NextResponse } from "next/server";
import { after } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { fillPendingRationales, pendingRationaleCount } from "@/lib/server/matching";
import { createJob, updateJob, finishJob, failJob, recordEvent } from "@/lib/server/jobs";

export const maxDuration = 60;

export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }
  const tenantId = session.tenantId;
  const pending = await pendingRationaleCount(tenantId);
  if (!pending) return NextResponse.json({ jobId: null, pending: 0 });

  const tenant = await getTenant(tenantId);
  const orgName = tenant?.name ?? "the organization";
  const jobId = await createJob(
    tenantId, "rationales", `Finishing ${pending} explanation(s)`, session.user.id);

  after(async () => {
    try {
      // Consecutive identical steps are one line in the log, not two.
      let lastSaid: string | null = null;
      const r = await fillPendingRationales(tenantId, orgName, {
        // The detail strings were already written to be read by a person, so
        // the log reuses them rather than inventing a second vocabulary. The
        // guard is for repeats: a step that reports the same words twice is one
        // line, not two.
        onProgress: p => {
          void updateJob(tenantId, jobId, p);
          if (p.detail && p.detail !== lastSaid) {
            lastSaid = p.detail;
            void recordEvent(tenantId, jobId, {
              kind: "progress", text: p.detail, done: p.done, total: p.total,
            });
          }
        },
      });
      await finishJob(tenantId, jobId, { filled: r.filled, remaining: r.remaining },
        r.remaining
          ? `${r.filled} explained, ${r.remaining} still to go.`
          : `${r.filled} explained. All matches now have a grounded explanation.`);
    } catch (e) {
      await failJob(tenantId, jobId,
        e instanceof Error ? e.message : "Could not finish the explanations.");
    }
  });

  return NextResponse.json({ jobId, pending });
}
