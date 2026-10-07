import "server-only";
// The Monday digest (client activity, patch 3): gathers last week across every
// client and sends it to info@forgranted.com and the team Slack channel. For
// Granted only. Sent by the weekly schedule (app/api/cron/digest) or by an
// admin from Admin, All Clients, Monday digest.
import { db } from "./db";
import { lastEdits } from "./activity-read";
import { getAllMilestones } from "./milestones";
import { lastWeek, stallState } from "@/lib/activity";
import { renderDigest, DUE_SOON_DAYS, type DigestData, type DigestDraft } from "@/lib/digest";

const RESEND_KEY = process.env.RESEND_API_KEY;
const SLACK_WEBHOOK = process.env.SLACK_ADMIN_WEBHOOK_URL;
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.forgranted.com";
const micros = (rows: { cost_micros: number }[]) => rows.reduce((n, r) => n + Number(r.cost_micros), 0) / 1_000_000;

export async function gatherDigest(now = new Date()): Promise<DigestData> {
  const { start, end } = lastWeek(now);
  const s = start.toISOString(), e = end.toISOString();
  const [{ data: tenants }, { data: users }, { data: msgs }, { data: docs }, { data: visits }, { data: usage },
    { data: drafts }, { data: sections }, { data: events }, { data: usageReqs }, milestones] = await Promise.all([
    db.from("tenant").select("id, name").order("name"),
    db.from("app_user").select("id, tenant_id, role, full_name"),  // tenant-safe: admin digest across every client
    db.from("chat_message").select("tenant_id, author_user_id").eq("role", "user").gte("created_at", s).lt("created_at", e),  // tenant-safe: admin digest across every client
    db.from("document").select("tenant_id, source").gte("created_at", s).lt("created_at", e),  // tenant-safe: admin digest across every client
    db.from("activity_event").select("tenant_id, user_id, session_start").gte("created_at", s).lt("created_at", e).limit(20000),  // tenant-safe: admin digest across every client
    db.from("ai_usage").select("tenant_id, actor, cost_micros").gte("created_at", s).lt("created_at", e),  // tenant-safe: admin digest across every client
    db.from("grant_draft").select("id, tenant_id, title, funder, status, deadline, updated_at, purpose"),  // tenant-safe: admin digest across every client
    db.from("draft_section").select("draft_id, updated_at"),  // tenant-safe: admin digest across every client
    db.from("card_event").select("draft_id, created_at").order("created_at", { ascending: false }).limit(5000),  // tenant-safe: admin digest across every client
    db.from("usage_request").select("tenant_id, user_id, kind, created_at").eq("status", "pending"),  // tenant-safe: admin digest across every client
    getAllMilestones().catch(() => new Map()),
  ]);

  type U = { id: string; tenant_id: string | null; role: string; full_name: string };
  const userList = (users ?? []) as U[];
  const clientIds = new Set(userList.filter(u => u.role === "client").map(u => u.id));
  const nameOf = new Map(userList.map(u => [u.id, u.full_name]));
  const tenantList = (tenants ?? []) as { id: string; name: string }[];
  const tenantName = new Map(tenantList.map(t => [t.id, t.name]));
  const ms = ((msgs ?? []) as { tenant_id: string; author_user_id: string | null }[]).filter(m => m.author_user_id && clientIds.has(m.author_user_id));
  const ds = (docs ?? []) as { tenant_id: string; source: string | null }[];
  const vs = (visits ?? []) as { tenant_id: string; user_id: string; session_start: boolean }[];
  const us = (usage ?? []) as { tenant_id: string | null; actor: string; cost_micros: number }[];

  type D = { id: string; tenant_id: string; title: string; funder: string | null; status: string; deadline: string | null; updated_at: string; purpose: string | null };
  const dr = ((drafts ?? []) as D[]).filter(d => d.purpose !== "standard_answers");
  const edits = lastEdits(dr, (sections ?? []) as { draft_id: string; updated_at: string }[], (events ?? []) as { draft_id: string | null; created_at: string }[]);
  const stalled: DigestDraft[] = [];
  const dueSoon: DigestDraft[] = [];
  for (const d of dr) {
    if (!d.deadline || (d.status !== "drafting" && d.status !== "client_review")) continue;
    const base = { tenantId: d.tenant_id, client: tenantName.get(d.tenant_id) ?? "A client", draftId: d.id, title: d.title, funder: d.funder, deadline: d.deadline, status: d.status };
    const st = stallState({ status: d.status, deadline: d.deadline, lastEdit: edits.get(d.id) ?? d.updated_at }, now);
    if (st.stalled) { stalled.push({ ...base, daysToDeadline: st.daysToDeadline, idleDays: st.idleDays, pastDue: st.pastDue }); continue; }
    const days = Math.ceil((new Date(`${d.deadline.slice(0, 10)}T23:59:59Z`).getTime() - now.getTime()) / 86400_000);
    if (days >= 0 && days <= DUE_SOON_DAYS) dueSoon.push({ ...base, daysToDeadline: days });
  }
  stalled.sort((a, b) => a.daysToDeadline - b.daysToDeadline);
  dueSoon.sort((a, b) => a.daysToDeadline - b.daysToDeadline);

  const requests = [
    ...((usageReqs ?? []) as { tenant_id: string; user_id: string | null; kind: string; created_at: string }[]).map(r => ({
      tenantId: r.tenant_id, client: tenantName.get(r.tenant_id) ?? "A client",
      what: r.kind === "ai_month" ? "more AI allowance this month" : r.kind === "chat_month" ? "more chat questions this month" : "more chat questions",
      by: (r.user_id && nameOf.get(r.user_id)) || "A client user", at: r.created_at })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return {
    weekStart: s, weekEnd: e,
    clients: tenantList.map(t => {
      const myVisits = vs.filter(v => v.tenant_id === t.id);
      const myMsgs = ms.filter(m => m.tenant_id === t.id);
      const myUsage = us.filter(u => u.tenant_id === t.id);
      return {
        tenantId: t.id, name: t.name,
        people: userList.filter(u => u.tenant_id === t.id && u.role === "client").length,
        activePeople: new Set([...myVisits.map(v => v.user_id), ...myMsgs.map(m => m.author_user_id)]).size,
        visits: myVisits.filter(v => v.session_start).length,
        questions: myMsgs.length,
        docsClient: ds.filter(d => d.tenant_id === t.id && d.source === "client").length,
        docsFG: ds.filter(d => d.tenant_id === t.id && d.source !== "client").length,
        spendClient: micros(myUsage.filter(u => u.actor === "client")), spendTotal: micros(myUsage),
        milestones: ((milestones.get(t.id) ?? []) as { label: string; at: string | null }[])
          .filter(m => m.at && m.at >= s && m.at < e).map(m => m.label),
      };
    }),
    stalled, dueSoon, requests,
    spend: {
      client: micros(us.filter(u => u.actor === "client")), admin: micros(us.filter(u => u.actor === "admin")),
      system: micros(us.filter(u => u.actor === "system")), total: micros(us),
    },
  };
}

export interface DigestSent { week: string; email: boolean; slack: boolean; skipped?: string }

/**
 * Send the digest. From the schedule (`once: true`) a week is sent only once,
 * so a repeated run cannot send it twice; an admin pressing Send now always sends.
 */
export async function sendDigest(d: DigestData, opts: { once?: boolean; actorUserId?: string | null } = {}): Promise<DigestSent> {
  if (opts.once) {
    const { data: prior } = await db.from("audit_log").select("detail").eq("action", "weekly_digest").like("detail", `week=${d.weekStart} scheduled%`).limit(10);  // tenant-safe: For Granted's own digest record, not client data
    // A run where both email and Slack failed does not count, so the next run tries again.
    if (((prior ?? []) as { detail: string }[]).some(p => !p.detail.includes("email=false slack=false"))) return { week: d.weekStart, email: false, slack: false, skipped: "already sent for this week" };
  }
  const { subject, html, slack } = renderDigest(d, APP_URL);
  let email = false, sl = false;
  if (RESEND_KEY) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "For Granted Portal <noreply@forgranted.com>", to: ["info@forgranted.com"], subject, html }),
      });
      email = r.ok;
    } catch { /* reported below */ }
  }
  if (SLACK_WEBHOOK) {
    try {
      const r = await fetch(SLACK_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: slack }) });
      sl = r.ok;
    } catch { /* reported below */ }
  }
  await db.from("audit_log").insert({  // tenant-safe: For Granted's own digest record, not client data
    actor_user_id: opts.actorUserId ?? null, tenant_id: null, action: "weekly_digest",
    detail: `week=${d.weekStart} ${opts.once ? "scheduled" : "manual"} email=${email} slack=${sl}`,
  });
  return { week: d.weekStart, email, slack: sl };
}
