// The finder behind the global search bar (patch 32): name matches, grouped,
// returned fast enough to render while the person types. Plain database
// lookups only; no model calls, no audit row per keystroke (full searches are
// audited by /api/search as before).
//
// Everything honors the same visibility rules as the pages it links to: a
// client without Funder Compass gets no funder suggestions; grants For
// Granted ruled out, or the client set aside, never appear; drafts appear
// only where the Drafts feature is visible. Admin sessions suggest within the
// tenant being viewed.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { getWorkspaceVisibility } from "@/lib/server/data";
import { getCachedMatches, getCachedFunders } from "@/lib/server/matching";
import { getJudgments, type Judgment } from "@/lib/server/triage";
import { getClientViews } from "@/lib/server/client-view";
import { getSavedItems } from "@/lib/server/saved";
import { suppresses } from "@/lib/triage";
import { escapeLike } from "@/lib/search-clean";

export const dynamic = "force-dynamic";

export interface SuggestResponse {
  documents: { id: string; title: string; layer: string }[];
  grants: { id: string; title: string; funder: string | null; where: "open" | "watch" | "saved" }[];
  funders: { id: string; name: string }[];
  drafts: { id: string; title: string }[];
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const empty: SuggestResponse = { documents: [], grants: [], funders: [], drafts: [] };
  if (q.length < 2) return NextResponse.json(empty);

  const needle = q.toLowerCase();
  const has = (t: string | null | undefined) => !!t && t.toLowerCase().includes(needle);
  const admin = session.role === "admin";
  const vis = await getWorkspaceVisibility(session.tenantId).catch(() => ({} as Record<string, boolean>));
  const grantsOn = admin || vis.funder_matches === true;
  const fundersOn = admin || vis.funder_compass === true;
  const draftsOn = admin || vis.drafts === true;

  const [docsRes, matches, funders, judgments, clientViews, saved, draftsRes] = await Promise.all([
    db.from("document").select("id, title, layer")
      .eq("tenant_id", session.tenantId)
      .ilike("title", `%${escapeLike(q)}%`)
      .order("created_at", { ascending: false }).limit(5),
    grantsOn ? getCachedMatches(session.tenantId) : Promise.resolve([]),
    fundersOn ? getCachedFunders(session.tenantId) : Promise.resolve([]),
    (grantsOn || fundersOn) ? getJudgments(session.tenantId).catch(() => new Map<string, Judgment>()) : Promise.resolve(new Map<string, Judgment>()),
    (grantsOn || fundersOn) && !admin ? getClientViews(session.tenantId) : Promise.resolve(new Map()),
    grantsOn ? getSavedItems(session.tenantId) : Promise.resolve([]),
    draftsOn
      ? db.from("grant_draft").select("id, title")
          .eq("tenant_id", session.tenantId)
          .ilike("title", `%${escapeLike(q)}%`)
          .order("updated_at", { ascending: false }).limit(3)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);

  // The same removals the Funding page makes before a client sees anything:
  // For Granted's ruled-out rows for everyone's suggestions, the client's own
  // "Not for us" for client sessions.
  const ruledOut = new Set<string>();
  for (const [key, j] of judgments) if (suppresses(j.state)) ruledOut.add(key);
  const setAside = new Set<string>();
  if (!admin) for (const [key, v] of clientViews as Map<string, { state: string }>) {
    if (v.state === "not_for_us") setAside.add(key);
  }
  const hidden = (kind: "grant" | "funder", id: string) =>
    (!admin && ruledOut.has(`${kind}:${id}`)) || setAside.has(`${kind}:${id}`);

  const grants: SuggestResponse["grants"] = [];
  const seenGrant = new Set<string>();
  for (const m of matches) {
    if (grants.length >= 6) break;
    if (!has(m.title) || hidden("grant", m.grant_id)) continue;
    seenGrant.add(m.grant_id);
    grants.push({ id: m.grant_id, title: m.title ?? m.grant_id, funder: m.funder ?? null, where: m.verdict === "watch" ? "watch" : "open" });
  }
  // Saved grants whose source rows were swept still deserve to be found.
  for (const s2 of saved) {
    if (grants.length >= 8) break;
    if (s2.kind !== "grant" || seenGrant.has(s2.target_id) || !has(s2.title)) continue;
    grants.push({ id: s2.target_id, title: s2.title ?? s2.target_id, funder: s2.detail.funder ?? null, where: "saved" });
  }

  const out: SuggestResponse = {
    documents: ((docsRes.data ?? []) as { id: string; title: string; layer: string }[]),
    grants,
    funders: funders.filter(f => has(f.name) && !hidden("funder", f.funder_id)).slice(0, 5)
      .map(f => ({ id: f.funder_id, name: f.name })),
    drafts: ((draftsRes.data ?? []) as { id: string; title: string }[]),
  };
  return NextResponse.json(out);
}
