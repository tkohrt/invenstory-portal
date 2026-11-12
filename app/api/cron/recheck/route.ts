// The weekly reopen recheck (patch 30). The save-for-later bucket promised
// "surfaced when those applications are open again"; patch 28 kept that
// promise whenever a search ran, and this cron keeps it on the calendar too,
// so a client who never searches still gets the news. Vercel calls this with
// "Authorization: Bearer <CRON_SECRET>"; without that secret set, or with the
// wrong one, nothing runs.
//
// Deliberately targeted, not a full search: for each tenant with saved
// grants, it asks the ledger a few questions by title and stamps what comes
// back open. Targeted questions cannot prove a grant closed, so this path
// never unstamps (only full runs do; see lib/server/reopen.ts). It spends no
// model tokens: no screening pass, no rationales, just lookups.
import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { findGrants, ledgerConfigured } from "@/lib/server/ledger";
import { applyReopenCheck, type OpenCandidate } from "@/lib/server/reopen";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_TENANTS = 40;   // plenty for the current book; log if ever exceeded
const MAX_ITEMS = 12;     // per tenant, newest saves first

function ceilingNumber(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v.replace(/[^0-9.]/g, "")); if (isFinite(n) && n > 0) return n; }
  return null;
}

function isOpen(closeDate: unknown): boolean {
  if (!closeDate || typeof closeDate !== "string") return true; // rolling
  const d = new Date(closeDate);
  return isNaN(d.getTime()) || d.getTime() >= Date.now();
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  if (!ledgerConfigured()) return NextResponse.json({ skipped: "ledger not configured" });

  // Which tenants have anything saved. The recheck cares only about saved
  // grants that were closed when bucketed and are not already stamped.
  const { data: rows, error } = await db.from("saved_item")  // tenant-safe: cron sweep across tenants; each tenant's check below is scoped per id
    .select("tenant_id, target_id, title, detail, reopened_at, saved_at")
    .eq("kind", "grant").is("reopened_at", null)
    .order("saved_at", { ascending: false }).limit(1000);
  if (error) return NextResponse.json({ error: "could not read saved items" }, { status: 500 });

  const byTenant = new Map<string, { title: string | null; detail: { close_date?: string | null } }[]>();
  for (const r of rows ?? []) {
    const d = (r.detail ?? {}) as { close_date?: string | null };
    // Only saved-while-closed items can reopen; skip the rest here.
    if (!d.close_date || new Date(d.close_date).getTime() >= Date.now()) continue;
    const list = byTenant.get(r.tenant_id as string) ?? [];
    if (list.length < MAX_ITEMS) list.push({ title: r.title as string | null, detail: d });
    byTenant.set(r.tenant_id as string, list);
  }

  const ranAt = new Date().toISOString();
  let tenants = 0; let asked = 0; let stamped = 0;
  for (const [tenantId, items] of byTenant) {
    if (tenants >= MAX_TENANTS) { console.error("[recheck] tenant cap reached; raise MAX_TENANTS"); break; }
    tenants++;
    const candidates: OpenCandidate[] = [];
    for (const it of items) {
      if (!it.title) continue;
      asked++;
      try {
        const r = await findGrants({ need: it.title, limit: 5 });
        for (const g of r.results ?? []) {
          if (!isOpen(g.close_date)) continue;
          candidates.push({
            grant_id: (g.website || g.title || "").slice(0, 200), title: g.title ?? g.name ?? null,
            close_date: typeof g.close_date === "string" ? g.close_date : null,
            website: g.website ?? null, award_ceiling: ceilingNumber(g.award_ceiling ?? g.max_award),
          });
        }
      } catch (e) { console.error("[recheck] lookup failed", e); }
    }
    // Title-match only here: the cron's candidate ids are not the portal's
    // qualified ids, so id hits would be luck. Stamp, never unstamp.
    const r = await applyReopenCheck(tenantId, candidates, ranAt, { unstampMissing: false });
    stamped += r.stamped;
  }
  return NextResponse.json({ tenants, asked, stamped });
}
