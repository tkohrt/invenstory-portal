import "server-only";
// The Portal Guide, the server side (patch 16, onboarding build, 3 Nov 2026).
// Rules and the guide text are in lib/portal-guide.ts.
import { db } from "./db";
import { getEligibilityProfile } from "./eligibility";
import { getWorkspaceVisibility, getTenant } from "./data";
import { getSetupState } from "./setup";
import { selfSearchOn } from "./client-view";
import { stillToDo } from "@/lib/setup";
import type { GuideStatus, GuideButton } from "@/lib/portal-guide";
import type { PortalSession } from "./session";

/** Where the account stands. Counts and switches only; no document content. */
export async function guideStatus(s: PortalSession): Promise<GuideStatus> {
  const [tenant, profile, vis, setup, self, docs, matches, funders] = await Promise.all([
    getTenant(s.tenantId),
    getEligibilityProfile(s.tenantId),
    getWorkspaceVisibility(s.tenantId).catch(() => ({} as Record<string, boolean>)),
    getSetupState(s.tenantId).catch(() => null),
    selfSearchOn(s.tenantId).catch(() => false),
    db.from("document").select("layer, status").eq("tenant_id", s.tenantId).limit(2000),
    db.from("eligible_grant").select("grant_id", { count: "exact", head: true }).eq("tenant_id", s.tenantId),
    db.from("matched_funder").select("funder_id", { count: "exact", head: true }).eq("tenant_id", s.tenantId),
  ]);
  const rows = (docs.data ?? []) as { layer: string; status: string }[];
  const on = (k: string) => s.role === "admin" || vis[k] !== false;
  return {
    orgName: tenant?.name ?? "your organization",
    role: s.role,
    setupSkipped: setup ? stillToDo(setup) : [],
    eligibility: {
      orgType: !!profile.org_type, causeAreas: profile.cause_areas.length > 0,
      country: !!profile.country_code, kinds: (profile.funding_kinds ?? []).length > 0,
    },
    docs: {
      I: rows.filter(r => r.layer === "I").length, II: rows.filter(r => r.layer === "II").length,
      III: rows.filter(r => r.layer === "III").length, reading: rows.filter(r => r.status === "pending" || r.status === "processing").length,
    },
    hasMatches: (matches.count ?? 0) + (funders.count ?? 0) > 0,
    tools: { chat: on("chat"), funder_matches: on("funder_matches"), drafts: on("drafts"), card_review: on("card_review"), eligibility: on("eligibility") },
    selfSearch: s.role === "admin" || self,
  };
}

/** Questions this person asked the guide in the last hour and day. */
export async function guideCounts(tenantId: string, userId: string, now = new Date()): Promise<{ hour: number; day: number } | null> {
  const since = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const count = async (from: string) => {
    const { count, error } = await db.from("guide_question").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("user_id", userId).gte("created_at", from);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  try {
    const [hour, day] = await Promise.all([count(since(3600_000)), count(since(24 * 3600_000))]);
    return { hour, day };
  } catch { return null; }  // before 0078: the guide is unavailable
}

export interface GuideConvo { id: string; title: string; created_at: string }
export interface GuideTurn { question: string; answer: string; buttons: GuideButton[] }

/** This person's past Portal Guide conversations, newest first. */
export async function guideSessions(tenantId: string, userId: string): Promise<GuideConvo[]> {
  const { data, error } = await db.from("guide_question").select("session_id, question, created_at")
    .eq("tenant_id", tenantId).eq("user_id", userId).order("created_at", { ascending: true }).limit(500);
  if (error) return [];
  const first = new Map<string, GuideConvo>();
  for (const r of (data ?? []) as { session_id: string; question: string; created_at: string }[]) {
    if (!first.has(r.session_id)) first.set(r.session_id, { id: r.session_id, title: r.question.slice(0, 60), created_at: r.created_at });
  }
  return [...first.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60);
}

export async function guideTurns(tenantId: string, userId: string, sessionId: string): Promise<GuideTurn[]> {
  const { data } = await db.from("guide_question").select("question, answer, buttons")
    .eq("tenant_id", tenantId).eq("user_id", userId).eq("session_id", sessionId).order("created_at").limit(200);
  return ((data ?? []) as { question: string; answer: string; buttons: GuideButton[] | null }[])
    .map(r => ({ question: r.question, answer: r.answer, buttons: Array.isArray(r.buttons) ? r.buttons : [] }));
}

export interface ChatFeedbackItem { id: string; action: "chat_card_suggestion" | "chat_not_right"; at: string; by: string | null; q: string; a: string; sources: string[]; lane: string | null }

/**
 * For Granted's view: answers a client suggested as Story Cards, or said were
 * not right. Admin callers only. The text is what the client's browser sent,
 * so it is shown as their suggestion, never as a quote from a document.
 */
export async function chatFeedback(tenantId: string): Promise<ChatFeedbackItem[]> {
  const read = (action: string) => db.from("audit_log").select("id, action, detail, created_at, actor_user_id")
    .eq("tenant_id", tenantId).eq("action", action).order("created_at", { ascending: false }).limit(20);
  const [a, b] = await Promise.all([read("chat_card_suggestion"), read("chat_not_right")]);
  const rows = [...(a.data ?? []), ...(b.data ?? [])] as { id: string; action: ChatFeedbackItem["action"]; detail: string | null; created_at: string; actor_user_id: string | null }[];
  const ids = [...new Set(rows.map(r => r.actor_user_id).filter(Boolean))] as string[];
  const { data: users } = ids.length ? await db.from("app_user").select("id, full_name").in("id", ids) : { data: [] };  // tenant-safe: names of the people who wrote rows already scoped to this tenant
  const name = new Map(((users ?? []) as { id: string; full_name: string }[]).map(u => [u.id, u.full_name]));
  return rows.map(r => {
    let d: { q?: string; a?: string; src?: string[]; lane?: string } = {};
    try { d = JSON.parse(r.detail ?? "{}"); } catch { /* older or plain detail */ }
    return { id: String(r.id), action: r.action, at: r.created_at, by: r.actor_user_id ? name.get(r.actor_user_id) ?? null : null,
      q: d.q ?? "", a: d.a ?? "", sources: Array.isArray(d.src) ? d.src : [], lane: d.lane ?? null };
  });
}
