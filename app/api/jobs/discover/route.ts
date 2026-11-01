// Search the web for this client, one question per call (patch 5 of the 1 Nov
// 2026 build). Without a runId it plans a new run and asks its first
// question; with one it asks the next. The page calls again while questions
// remain, the way Finish the explanations does, so each call fits in the
// 60-second function limit. What is kept and proposed: lib/web-discovery.ts.
import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { createJob, updateJob, finishJob, failJob, recordEvent } from "@/lib/server/jobs";
import { startDiscovery, getDiscoveryRun, runDiscoveryPass, webSearchAvailable } from "@/lib/server/discovery";
import { withAiUsage } from "@/lib/server/ai-usage";
import { db } from "@/lib/server/db";
import { BRAIN_REFUSAL, isBrain } from "@/lib/brain";
import { mayStartSearch, mayContinueSearch } from "@/lib/server/client-view";
import { webSourceOn } from "@/lib/server/sources";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!webSearchAvailable()) {
    return NextResponse.json({ error: "Web search is not available here: it needs Claude on Vertex (LLM_PROVIDER=vertex)." }, { status: 400 });
  }
  const tenantId = session.tenantId;
  const tenant = await getTenant(tenantId);
  if (isBrain(tenant)) return NextResponse.json({ error: BRAIN_REFUSAL }, { status: 400 });
  const orgName = tenant?.name ?? "the organization";
  const body = await req.json().catch(() => ({})) as { runId?: string };

  let runId = typeof body.runId === "string" && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : null;
  // For Granted, or a client For Granted has let search for itself (patch 7):
  // a new run counts against the client's day, the next question of a run does not.
  const may = runId ? await mayContinueSearch(session) : await mayStartSearch(session, "discover");
  if (!may.ok) return NextResponse.json({ error: may.error }, { status: 403 });
  const actor = may.actor;
  // Sources (patch 11): the web search can be switched off for a client.
  if (!runId && !(await webSourceOn(tenantId))) {
    return NextResponse.json({ error: "The web search is turned off for this account. Sources on Funder Matches says why." }, { status: 403 });
  }
  try {
    if (runId) {
      const run = await getDiscoveryRun(tenantId, runId);
      if (!run) return NextResponse.json({ error: "That web search was not found." }, { status: 404 });
      if (run.finished_at) return NextResponse.json({ jobId: null, runId, remaining: 0 });
    } else {
      runId = (await startDiscovery(tenantId, session.user.id)).id;
      // Written now, not at the end, so the day's count holds while a run is under way.
      await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: tenantId, action: "web_discovery_run", detail: `run ${runId}` });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not start the web search." }, { status: 400 });
  }

  const jobId = await createJob(tenantId, "discover", `Searching the web for ${orgName}`, session.user.id);
  const id = runId;
  after(async () => {
    try {
      const r = await withAiUsage({ tenantId, userId: session.user.id, actor, feature: "web_discovery" },
        () => runDiscoveryPass(tenantId, id, orgName, session.user.id, detail => {
          void updateJob(tenantId, jobId, { done: 0, total: 1, detail });
          void recordEvent(tenantId, jobId, { kind: "progress", text: detail });
        }));
      await finishJob(tenantId, jobId, { runId: id, remaining: r.remaining, found: r.found, proposed: r.proposed },
        `${r.found} kept, ${r.proposed} new for Ground Truth review.`
        + (r.note ? ` ${r.note}` : "")
        + (r.remaining ? ` ${r.remaining} question${r.remaining === 1 ? "" : "s"} still to ask.` : " The web search is finished."));
    } catch (e) {
      await failJob(tenantId, jobId, e instanceof Error ? e.message : "The web search did not finish.");
      return;
    }
    try {
      await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: tenantId, action: "web_discovery", detail: `run ${id}` });
    } catch (e) { console.error("[discover] audit write failed", e); }
  });

  return NextResponse.json({ jobId, runId });
}
