import "server-only";
// Reading a client's own view of its matches, and deciding whether a session
// may start a search (patch 7 of the 1 November 2026 build). Rules:
// lib/client-view.ts.
import { db } from "./db";
import { getFeatureVisible } from "./data";
import { checkAllowance } from "./allowance";
import { clientActionsLastDay } from "./ai-usage";
import { SELF_SEARCH_KEY, CLIENT_DAILY, selfSearchDecision, type ClientView } from "@/lib/client-view";
import type { PortalSession } from "./session";

/** Every view this client gave, keyed "kind:target_id". Empty before 0075. */
export async function getClientViews(tenantId: string): Promise<Map<string, ClientView>> {
  const { data, error } = await db.from("client_match_view")
    .select("kind, target_id, state, reason, note, updated_at").eq("tenant_id", tenantId);
  if (error) { console.error("[client-view] not read", error.message); return new Map(); }
  return new Map(((data ?? []) as { kind: string; target_id: string; state: ClientView["state"]; reason: string | null; note: string | null; updated_at: string }[])
    .map(r => [`${r.kind}:${r.target_id}`, { state: r.state, reason: r.reason, note: r.note, decidedAt: r.updated_at }]));
}

/**
 * May this session carry on work a search already started (the explanations,
 * the next web question, waking the funding service)? For Granted always; a
 * client while its switch and page are on, under the monthly ceiling.
 */
export async function mayContinueSearch(session: PortalSession): Promise<{ ok: true; actor: "admin" | "client" } | { ok: false; error: string }> {
  if (session.role === "admin") return { ok: true, actor: "admin" };
  const [switchOn, pageOn] = await Promise.all([
    selfSearchOn(session.tenantId),
    getFeatureVisible(session.tenantId, "funder_matches").catch(() => false),
  ]);
  if (!switchOn || !pageOn) return { ok: false, error: "Searching is run by your For Granted team for now." };
  const allowance = await checkAllowance("client", session.tenantId, { kind: "interactive" });
  return allowance.ok ? { ok: true, actor: "client" } : { ok: false, error: allowance.message };
}

/** Is the switch on for this client? Off unless For Granted turned it on. */
export async function selfSearchOn(tenantId: string): Promise<boolean> {
  return getFeatureVisible(tenantId, SELF_SEARCH_KEY).catch(() => false);
}

/**
 * May this session start a match or a web search for its client now?
 * For Granted always may. A client needs the switch, the page, today's count
 * and the monthly allowance (an interactive step: stopped at the ceiling).
 * The audit actions are the ones the routes already write per run.
 */
export async function mayStartSearch(session: PortalSession, what: "match" | "discover"):
  Promise<{ ok: true; actor: "admin" | "client" } | { ok: false; error: string }> {
  if (session.role === "admin") return { ok: true, actor: "admin" };
  const [switchOn, pageOn, used] = await Promise.all([
    selfSearchOn(session.tenantId),
    getFeatureVisible(session.tenantId, "funder_matches").catch(() => false),
    clientActionsLastDay(session.tenantId, what === "match" ? "ledger_match" : "web_discovery_run").catch(() => 0),
  ]);
  const gate = selfSearchDecision({ role: "client", switchOn, pageOn, usedToday: used, limit: CLIENT_DAILY[what] });
  if (!gate.ok) return gate;
  const allowance = await checkAllowance("client", session.tenantId, { kind: "interactive" });
  if (!allowance.ok) return { ok: false, error: allowance.message };
  return { ok: true, actor: "client" };
}
