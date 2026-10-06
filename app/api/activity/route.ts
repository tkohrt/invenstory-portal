// Record that a client login used a part of the portal (client activity,
// patch 2). Called by the page as it changes; records at most one row per
// person per part of the portal every 30 minutes, with the path only (ids
// removed). For Granted's own use is never recorded. Always answers 204: this
// must never get in anyone's way.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { cleanPath, featureForPath, VISIT_GAP_MINUTES } from "@/lib/activity";

const done = () => new NextResponse(null, { status: 204 });

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.role !== "client") return done();
    const body = await req.json().catch(() => ({}));
    if (typeof body?.path !== "string" || body.path.length > 500 || !body.path.startsWith("/")) return done();
    const path = cleanPath(body.path);
    const feature = featureForPath(path);
    if (!feature) return done();

    const since = new Date(Date.now() - VISIT_GAP_MINUTES * 60_000).toISOString();
    const { data: recent } = await db.from("activity_event").select("feature")
      .eq("tenant_id", session.tenantId).eq("user_id", session.user.id).gte("created_at", since).limit(50);
    const rows = (recent ?? []) as { feature: string }[];
    if (rows.some(r => r.feature === feature)) return done();
    await db.from("activity_event").insert({
      tenant_id: session.tenantId, user_id: session.user.id, feature, path,
      // Nothing from this person in the last 30 minutes: a new visit begins.
      session_start: rows.length === 0,
    });
  } catch { /* never in anyone's way */ }
  return done();
}
