// The weekly RFP scan (patch 58). Mondays at 14:30 UTC, an hour after the
// reopen recheck. Vercel calls this with "Authorization: Bearer <CRON_SECRET>";
// without that secret, or with the wrong one, nothing runs. Runs every client
// with the RFP Engine on and a usable RFP profile, one after another, inside
// this function's five minutes.
import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { runRfp } from "@/lib/server/rfp-run";
import { RFP_ENGINE_KEY } from "@/lib/gov-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_TENANTS = 6;     // each run can take most of a minute; log if exceeded
const STOP_AFTER_MS = 240_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const started = Date.now();
  const { data, error } = await db.from("feature_visibility")  // tenant-safe: cron sweep across tenants; each run below is scoped to one tenant
    .select("tenant_id").eq("feature_key", RFP_ENGINE_KEY).eq("visible", true);
  if (error) return NextResponse.json({ error: "could not read the switch" }, { status: 500 });
  const tenants = ((data ?? []) as { tenant_id: string }[]).map(r => r.tenant_id);
  if (tenants.length > MAX_TENANTS) console.error(`[rfp-scan] ${tenants.length} clients on; running the first ${MAX_TENANTS}. Raise MAX_TENANTS or split the cron.`);

  const results: { tenantId: string; ok: boolean; error?: string; counts?: unknown }[] = [];
  for (const t of tenants.slice(0, MAX_TENANTS)) {
    if (Date.now() - started > STOP_AFTER_MS) { console.error("[rfp-scan] stopped early to stay inside the time limit"); break; }
    try {
      const r = await runRfp(t, "cron", null);
      results.push({ tenantId: t, ok: r.ok, error: r.error, counts: r.counts });
    } catch (e) {
      console.error("[rfp-scan] run failed", t, e);
      results.push({ tenantId: t, ok: false, error: "run threw" });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
