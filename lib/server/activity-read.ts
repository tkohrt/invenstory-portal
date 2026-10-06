import "server-only";
// Admin, Client activity: how each client uses the portal, month by month
// (planned and decided 6 October 2026). For Granted only; read-only.
//
// Everything here comes from what the portal already records: the chat log,
// documents, drafts, Story Cards, the AI usage meter and the audit log. Months
// are Eastern time. Chat is reported as counts and broad topics: questions are
// sorted into topics on the server and their text never leaves it.
import { db } from "./db";
import { getContentCoverage, readiness } from "./gap-agent";
import { getEligibilityProfile } from "./eligibility";
import { LIMITS } from "@/lib/usage-limits";
import { pagesOf } from "@/lib/analysis-cap";
import { monthRange, recentMonths, dayKey, topicCounts, stallState, FEATURES, FEATURE_LABEL, type StallState, type Milestone } from "@/lib/activity";
import { getAllMilestones } from "./milestones";

const ALLOWANCE_DOLLARS = 20;  // Phase D's monthly AI allowance per client (decision 24); shown, not yet enforced

type Users = { id: string; tenant_id: string | null; role: string; full_name: string; email: string; created_at: string; auth_id?: string | null }[];

/** Each login's last sign-in, from Supabase Auth. Best-effort: a failure leaves it unknown. */
async function lastSignIns(authIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  await Promise.all(authIds.map(async id => {
    try {
      const { data } = await db.auth.admin.getUserById(id);
      out.set(id, data?.user?.last_sign_in_at ?? null);
    } catch { /* unknown */ }
  }));
  return out;
}

const micros = (rows: { cost_micros: number }[]) => rows.reduce((n, r) => n + Number(r.cost_micros), 0) / 1_000_000;

/** The latest moment anything in a draft changed: the draft, its questions, or a card placed or moved. */
export function lastEdits(
  drafts: { id: string; updated_at: string }[],
  sections: { draft_id: string; updated_at: string }[],
  events: { draft_id: string | null; created_at: string }[],
): Map<string, string> {
  const out = new Map(drafts.map(d => [d.id, d.updated_at]));
  const bump = (id: string | null, at: string) => {
    if (!id) return;
    const cur = out.get(id);
    if (cur !== undefined && at > cur) out.set(id, at);
  };
  sections.forEach(s => bump(s.draft_id, s.updated_at));
  events.forEach(e => bump(e.draft_id, e.created_at));
  return out;
}

// ---------------------------------------------------------------------------
// All Clients: one row per client for the chosen month.
// ---------------------------------------------------------------------------

export interface PortfolioRow {
  tenantId: string; name: string;
  people: number; activePeople: number; lastClientActivity: string | null;
  chat: number; chatLimit: number;
  spendClient: number; spendTotal: number; allowance: number;
  docsClient: number; docsFG: number;
  draftsOpen: number; stalled: number; pendingRequests: number;
  /** Getting-started milestones reached, of MILESTONES.length (patch 3). */
  milestonesDone: number;
}
export interface PortfolioActivity { month: string; months: string[]; rows: PortfolioRow[]; spendTotal: number; meterSince: string | null }

export async function getPortfolioActivity(month: string): Promise<PortfolioActivity> {
  const { start, end } = monthRange(month);
  const s = start.toISOString(), e = end.toISOString();
  const [{ data: tenants }, { data: users }, { data: msgs }, { data: usage }, { data: docs }, { data: drafts }, { data: sections }, { data: events },
    { data: grants }, { data: reqs }, { data: lastDocs }, { data: lastMsgs }, { data: first }] = await Promise.all([
    db.from("tenant").select("id, name").order("name"),
    db.from("app_user").select("id, tenant_id, role, full_name, email, created_at"),  // tenant-safe: admin portfolio across every client
    db.from("chat_message").select("tenant_id, author_user_id").eq("role", "user").gte("created_at", s).lt("created_at", e),  // tenant-safe: admin portfolio across every client
    db.from("ai_usage").select("tenant_id, actor, cost_micros").gte("created_at", s).lt("created_at", e),  // tenant-safe: admin portfolio across every client
    db.from("document").select("tenant_id, source").gte("created_at", s).lt("created_at", e),  // tenant-safe: admin portfolio across every client
    db.from("grant_draft").select("id, tenant_id, status, deadline, updated_at, purpose"),  // tenant-safe: admin portfolio across every client
    db.from("draft_section").select("draft_id, updated_at"),  // tenant-safe: admin portfolio across every client
    db.from("card_event").select("draft_id, created_at").order("created_at", { ascending: false }).limit(5000),  // tenant-safe: admin portfolio across every client
    db.from("usage_grant").select("tenant_id, extra, period").eq("kind", "chat_month").eq("period", month),  // tenant-safe: admin portfolio across every client
    db.from("usage_request").select("tenant_id").eq("status", "pending"),  // tenant-safe: admin portfolio across every client
    db.from("document").select("tenant_id, created_at").eq("source", "client").order("created_at", { ascending: false }).limit(2000),  // tenant-safe: admin portfolio across every client
    db.from("chat_message").select("tenant_id, author_user_id, created_at").eq("role", "user").order("created_at", { ascending: false }).limit(5000),  // tenant-safe: admin portfolio across every client
    db.from("ai_usage").select("created_at").order("created_at").limit(1),  // tenant-safe: admin portfolio, earliest meter row
  ]);
  // Visits (patch 2). Before migration 0052 the table is missing and these are empty.
  const [{ data: visitsMonth }, { data: lastVisits }] = await Promise.all([
    db.from("activity_event").select("tenant_id, user_id").gte("created_at", s).lt("created_at", e).limit(20000),  // tenant-safe: admin portfolio across every client
    db.from("activity_event").select("tenant_id, created_at").order("created_at", { ascending: false }).limit(5000),  // tenant-safe: admin portfolio across every client
  ]);
  const milestones = await getAllMilestones().catch(() => new Map<string, Milestone[]>());
  const vm = (visitsMonth ?? []) as { tenant_id: string; user_id: string }[];
  const lv = (lastVisits ?? []) as { tenant_id: string; created_at: string }[];
  const userList = (users ?? []) as Users;
  const clientIds = new Set(userList.filter(u => u.role === "client").map(u => u.id));
  const ms = (msgs ?? []) as { tenant_id: string; author_user_id: string | null }[];
  const us = (usage ?? []) as { tenant_id: string | null; actor: string; cost_micros: number }[];
  const ds = (docs ?? []) as { tenant_id: string; source: string | null }[];
  type D = { id: string; tenant_id: string; status: string; deadline: string | null; updated_at: string; purpose: string | null };
  const dr = ((drafts ?? []) as D[]).filter(d => d.purpose !== "standard_answers");
  const edits = lastEdits(dr, (sections ?? []) as { draft_id: string; updated_at: string }[], (events ?? []) as { draft_id: string | null; created_at: string }[]);
  const now = new Date();

  const rows: PortfolioRow[] = ((tenants ?? []) as { id: string; name: string }[]).map(t => {
    const people = userList.filter(u => u.tenant_id === t.id && u.role === "client");
    const myMsgs = ms.filter(m => m.tenant_id === t.id && m.author_user_id && clientIds.has(m.author_user_id));
    const myUsage = us.filter(u => u.tenant_id === t.id);
    const myDrafts = dr.filter(d => d.tenant_id === t.id);
    const extra = ((grants ?? []) as { tenant_id: string; extra: number }[]).filter(g => g.tenant_id === t.id).reduce((n, g) => n + g.extra, 0);
    const lastDoc = ((lastDocs ?? []) as { tenant_id: string; created_at: string }[]).find(d => d.tenant_id === t.id)?.created_at ?? null;
    const lastMsg = ((lastMsgs ?? []) as { tenant_id: string; author_user_id: string | null; created_at: string }[])
      .find(m => m.tenant_id === t.id && m.author_user_id && clientIds.has(m.author_user_id))?.created_at ?? null;
    const lastVisit = lv.find(v => v.tenant_id === t.id)?.created_at ?? null;
    const last = [lastDoc, lastMsg, lastVisit].filter(Boolean).sort().pop() ?? null;
    return {
      tenantId: t.id, name: t.name,
      people: people.length,
      // Used the portal this month: a recorded visit, or a question asked.
      activePeople: new Set([...myMsgs.map(m => m.author_user_id), ...vm.filter(v => v.tenant_id === t.id).map(v => v.user_id)]).size,
      lastClientActivity: last,
      chat: myMsgs.length, chatLimit: LIMITS.chatPerMonthPerClient + extra,
      spendClient: micros(myUsage.filter(u => u.actor === "client")), spendTotal: micros(myUsage), allowance: ALLOWANCE_DOLLARS,
      docsClient: ds.filter(d => d.tenant_id === t.id && d.source === "client").length,
      docsFG: ds.filter(d => d.tenant_id === t.id && d.source !== "client").length,
      draftsOpen: myDrafts.filter(d => d.status === "drafting" || d.status === "client_review").length,
      stalled: myDrafts.filter(d => stallState({ status: d.status, deadline: d.deadline, lastEdit: edits.get(d.id) ?? d.updated_at }, now).stalled).length,
      pendingRequests: ((reqs ?? []) as { tenant_id: string }[]).filter(r => r.tenant_id === t.id).length,
      milestonesDone: (milestones.get(t.id) ?? []).filter(x => x.at).length,
    };
  });
  return {
    month, months: recentMonths(12, now).reverse(), rows,
    spendTotal: micros(us),
    meterSince: ((first ?? []) as { created_at: string }[])[0]?.created_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// One client, one month.
// ---------------------------------------------------------------------------

export interface DraftRow {
  id: string; title: string; funder: string | null; deadline: string | null; amountCents: number | null;
  status: string; stage: string | null; purpose: string | null; mode: string | null;
  createdBy: string | null; createdAt: string; lastEdit: string;
  sections: number; answered: number; done: number;
  sourceKind: string | null; sourceUrl: string | null; sourceFilename: string | null; hasSourceText: boolean; hasOriginal: boolean;
  submittedAt: string | null; stall: StallState; touchedThisMonth: boolean;
}

export interface ClientActivity {
  tenant: { id: string; name: string; orgType: string | null; createdAt: string };
  month: string; months: string[];
  people: { id: string; name: string; email: string; since: string; questions: number; busiestDay: { day: string; count: number } | null;
    lastSeen: string | null; visits: number; daysActive: number; features: string[];
    /** From the sign-in service itself, so it covers the time before visits were recorded. Null: never signed in. */
    lastSignIn: string | null }[];
  /** Which parts of the portal were used this month, by how many people (patch 2). */
  features: { key: string; label: string; people: number; visits: number }[];
  visitsRecorded: boolean;
  chat: {
    month: number; limit: number; extra: number; perDayLimit: number;
    topics: { key: string; label: string; count: number }[];
    nothingFound: number;
  };
  requests: { id: string; at: string; by: string; status: string }[];
  grants: { at: string; extra: number; note: string | null }[];
  spend: { client: number; admin: number; system: number; total: number; allowance: number;
    byFeature: { feature: string; calls: number; cost: number }[] };
  analysis: { runs: number; pages: number; pagesLimit: number };
  documents: {
    list: { id: string; title: string; layer: string; kind: string | null; source: string | null; by: string | null; at: string; status: string; problem: string | null }[];
    byMonth: { month: string; client: number; fg: number }[];
    total: number; failedNow: number; unreadableNow: number;
  };
  other: { reprocesses: number; readsHeld: number };
  drafts: DraftRow[];
  outcomes: { byMonth: { month: string; submitted: number }[]; won: number; lost: number; wonCents: number; submittedAll: number;
    upcoming: { d30: number; d60: number; d90: number } };
  growth: { docsTotal: number; words: number; cardsVerified: number; cardsVerifiedThisMonth: number; cardsTotal: number; readinessPct: number };
  /** Getting started: days from joining to each first (patch 3). */
  milestones: Milestone[];
}

export async function getClientActivity(tenantId: string, month: string): Promise<ClientActivity | null> {
  const { start, end } = monthRange(month);
  const s = start.toISOString(), e = end.toISOString();
  const now = new Date();
  const months = recentMonths(12, now);
  const yearStart = monthRange(months[0]).start.toISOString();

  const { data: tenant } = await db.from("tenant").select("id, name, org_type, created_at").eq("id", tenantId).maybeSingle();
  if (!tenant) return null;

  const [{ data: users }, { data: msgs }, { data: chatAudit }, { data: usage }, { data: aUsage }, { data: docs }, { data: docsYear },
    { data: docsBad }, { data: emptyReads }, { data: audits }, { data: drafts }, { data: sections }, { data: events },
    { data: grantRows }, { data: reqRows }, { data: cards }, wc, coverage, profile] = await Promise.all([
    db.from("app_user").select("id, tenant_id, role, full_name, email, created_at, auth_id").eq("tenant_id", tenantId),
    db.from("chat_message").select("author_user_id, content, created_at").eq("tenant_id", tenantId).eq("role", "user").gte("created_at", s).lt("created_at", e),
    db.from("audit_log").select("actor_user_id, detail").eq("tenant_id", tenantId).eq("action", "chat").gte("created_at", s).lt("created_at", e),
    db.from("ai_usage").select("actor, feature, cost_micros").eq("tenant_id", tenantId).gte("created_at", s).lt("created_at", e),
    db.from("analysis_usage").select("pending_chars, via_request").eq("tenant_id", tenantId).gte("created_at", s).lt("created_at", e),
    db.from("document").select("id, title, layer, doc_kind, source, uploaded_by, created_at, status, error_detail").eq("tenant_id", tenantId).gte("created_at", s).lt("created_at", e).order("created_at", { ascending: false }),
    db.from("document").select("source, created_at").eq("tenant_id", tenantId).gte("created_at", yearStart),
    db.from("document").select("id, status").eq("tenant_id", tenantId),
    db.from("analysis_doc").select("document_id").eq("tenant_id", tenantId).eq("content_hash", "empty"),
    db.from("audit_log").select("action, actor_user_id").eq("tenant_id", tenantId).in("action", ["reprocess_doc", "upload_ai_read_deferred"]).gte("created_at", s).lt("created_at", e),
    // Every column, so the stored-file columns of migration 0052 appear once it has run.
    db.from("grant_draft").select("*").eq("tenant_id", tenantId).order("updated_at", { ascending: false }),
    db.from("draft_section").select("id, draft_id, status, updated_at").eq("tenant_id", tenantId),
    db.from("card_event").select("draft_id, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(2000),
    db.from("usage_grant").select("extra, note, granted_at, period").eq("tenant_id", tenantId).eq("kind", "chat_month").eq("period", month),
    db.from("usage_request").select("id, user_id, status, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(20),
    db.from("story_card").select("status, verified_at").eq("tenant_id", tenantId),
    db.rpc("tenant_word_count", { p_tenant: tenantId }),
    getContentCoverage(tenantId).catch(() => null),
    getEligibilityProfile(tenantId).catch(() => null),
  ]);
  const milestones = (await getAllMilestones().catch(() => null))?.get(tenantId) ?? [];

  const [{ data: visitRows, error: visitErr }, { data: lastSeenRows }] = await Promise.all([
    db.from("activity_event").select("user_id, feature, session_start, created_at").eq("tenant_id", tenantId).gte("created_at", s).lt("created_at", e).limit(20000),
    db.from("activity_event").select("user_id, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(2000),
  ]);
  type V = { user_id: string; feature: string; session_start: boolean; created_at: string };
  const visits = (visitRows ?? []) as V[];
  const lastSeenOf = new Map<string, string>();
  ((lastSeenRows ?? []) as { user_id: string; created_at: string }[]).forEach(r => { if (!lastSeenOf.has(r.user_id)) lastSeenOf.set(r.user_id, r.created_at); });

  const userList = (users ?? []) as Users;
  const clients = userList.filter(u => u.role === "client");
  const signIns = await lastSignIns(clients.map(u => u.auth_id).filter((x): x is string => !!x));
  const clientIds = new Set(clients.map(u => u.id));
  const nameOf = new Map<string, string>(userList.map(u => [u.id, u.full_name]));
  // Anyone not among this client's logins is For Granted (admins have no client).
  const who = (id: string | null) => (id ? nameOf.get(id) ?? "For Granted" : null);

  // Chat: client questions only, counted and sorted into topics. The text stops here.
  type M = { author_user_id: string | null; content: string; created_at: string };
  const clientMsgs = ((msgs ?? []) as M[]).filter(m => m.author_user_id && clientIds.has(m.author_user_id));
  const people = clients.map(u => {
    const mine = clientMsgs.filter(m => m.author_user_id === u.id);
    const byDay = new Map<string, number>();
    mine.forEach(m => { const d = dayKey(new Date(m.created_at)); byDay.set(d, (byDay.get(d) ?? 0) + 1); });
    const busiest = [...byDay].sort((a, b) => b[1] - a[1])[0];
    const myVisits = visits.filter(v => v.user_id === u.id);
    const days = new Set([...mine.map(m => dayKey(new Date(m.created_at))), ...myVisits.map(v => dayKey(new Date(v.created_at)))]);
    return { id: u.id, name: u.full_name, email: u.email, since: u.created_at, questions: mine.length,
      busiestDay: busiest ? { day: busiest[0], count: busiest[1] } : null,
      lastSeen: lastSeenOf.get(u.id) ?? null,
      visits: myVisits.filter(v => v.session_start).length,
      daysActive: days.size,
      features: [...new Set(myVisits.map(v => v.feature))].map(k => FEATURE_LABEL[k] ?? k),
      lastSignIn: u.auth_id ? signIns.get(u.auth_id) ?? null : null };
  });
  const nothingFound = ((chatAudit ?? []) as { actor_user_id: string | null; detail: string }[])
    .filter(a => a.actor_user_id && clientIds.has(a.actor_user_id) && /mode=none\b/.test(a.detail)).length;
  const extra = ((grantRows ?? []) as { extra: number }[]).reduce((n, g) => n + g.extra, 0);

  type U = { actor: string; feature: string; cost_micros: number };
  const us = (usage ?? []) as U[];
  const byFeature = new Map<string, { feature: string; calls: number; cost: number }>();
  us.forEach(u => { const f = byFeature.get(u.feature) ?? { feature: u.feature, calls: 0, cost: 0 }; f.calls++; f.cost += Number(u.cost_micros) / 1_000_000; byFeature.set(u.feature, f); });

  const au = ((aUsage ?? []) as { pending_chars: number; via_request: string | null }[]);

  // Documents.
  const empty = new Set(((emptyReads ?? []) as { document_id: string }[]).map(r => r.document_id));
  type Doc = { id: string; title: string; layer: string; doc_kind: string | null; source: string | null; uploaded_by: string | null; created_at: string; status: string; error_detail: string | null };
  const docList = ((docs ?? []) as Doc[]).map(d => ({
    id: d.id, title: d.title, layer: d.layer, kind: d.doc_kind, source: d.source, by: who(d.uploaded_by), at: d.created_at, status: d.status,
    problem: d.status === "failed" ? (d.error_detail ?? "Could not be read")
      : empty.has(d.id) ? "No readable text (likely a scanned PDF)"
      : d.error_detail?.startsWith("semantic index pending") ? "Search indexing unfinished" : null,
  }));
  const year = (docsYear ?? []) as { source: string | null; created_at: string }[];
  const byMonth = months.map(m => {
    const r = monthRange(m);
    const inM = year.filter(d => { const t = new Date(d.created_at).getTime(); return t >= r.start.getTime() && t < r.end.getTime(); });
    return { month: m, client: inM.filter(d => d.source === "client").length, fg: inM.filter(d => d.source !== "client").length };
  });
  const allDocs = (docsBad ?? []) as { id: string; status: string }[];

  // Other client calls this month.
  const au2 = (audits ?? []) as { action: string; actor_user_id: string | null }[];

  // Drafts.
  type GD = { source_storage_key?: string | null; id: string; title: string; funder: string | null; deadline: string | null; amount_cents: number | null; status: string; stage: string | null;
    purpose: string | null; mode: string | null; created_by: string | null; created_at: string; updated_at: string;
    source_kind: string | null; source_url: string | null; source_filename: string | null; source_text: string | null; submitted_at: string | null };
  const gd = (drafts ?? []) as GD[];
  const secs = (sections ?? []) as { id: string; draft_id: string; status: string; updated_at: string }[];
  const edits = lastEdits(gd, secs, (events ?? []) as { draft_id: string | null; created_at: string }[]);
  const draftRows: DraftRow[] = gd.map(d => {
    const mine = secs.filter(x => x.draft_id === d.id);
    const lastEdit = edits.get(d.id) ?? d.updated_at;
    const t = new Date(lastEdit).getTime();
    return {
      id: d.id, title: d.title, funder: d.funder, deadline: d.deadline, amountCents: d.amount_cents,
      status: d.status, stage: d.stage, purpose: d.purpose, mode: d.mode,
      createdBy: who(d.created_by), createdAt: d.created_at, lastEdit,
      sections: mine.length, answered: mine.filter(x => x.status !== "empty").length, done: mine.filter(x => x.status === "done").length,
      sourceKind: d.source_kind, sourceUrl: d.source_url, sourceFilename: d.source_filename, hasSourceText: !!d.source_text?.trim(), hasOriginal: !!d.source_storage_key,
      submittedAt: d.submitted_at,
      stall: stallState({ status: d.status, deadline: d.deadline, lastEdit }, now),
      touchedThisMonth: t >= start.getTime() && t < end.getTime(),
    };
  });

  const apps = draftRows.filter(d => d.purpose !== "standard_answers");
  const inDays = (n: number) => apps.filter(d => (d.status === "drafting" || d.status === "client_review") && d.deadline
    && new Date(d.deadline).getTime() - now.getTime() <= n * 86400_000 && new Date(d.deadline).getTime() >= now.getTime() - 86400_000).length;

  const cardRows = (cards ?? []) as { status: string; verified_at: string | null }[];
  const verified = cardRows.filter(c => c.status === "verified");

  return {
    tenant: { id: tenant.id, name: tenant.name, orgType: tenant.org_type, createdAt: tenant.created_at },
    features: [...FEATURES.map(f => f.key), "other"].map(key => {
      const rows = visits.filter(v => v.feature === key);
      return { key, label: FEATURE_LABEL[key] ?? "Other pages", people: new Set(rows.map(r => r.user_id)).size, visits: rows.length };
    }).filter(f => f.visits > 0).sort((a, b) => b.people - a.people || b.visits - a.visits),
    visitsRecorded: !visitErr,
    month, months: [...months].reverse(),
    people,
    chat: { month: clientMsgs.length, limit: LIMITS.chatPerMonthPerClient + extra, extra, perDayLimit: LIMITS.chatPerDayPerPerson,
      topics: topicCounts(clientMsgs.map(m => m.content)), nothingFound },
    requests: ((reqRows ?? []) as { id: string; user_id: string | null; status: string; created_at: string }[])
      .map(r => ({ id: r.id, at: r.created_at, by: who(r.user_id) ?? "A client user", status: r.status })),
    grants: ((grantRows ?? []) as { extra: number; note: string | null; granted_at: string }[]).map(g => ({ at: g.granted_at, extra: g.extra, note: g.note })),
    spend: {
      client: micros(us.filter(u => u.actor === "client")), admin: micros(us.filter(u => u.actor === "admin")),
      system: micros(us.filter(u => u.actor === "system")), total: micros(us), allowance: ALLOWANCE_DOLLARS,
      byFeature: [...byFeature.values()].sort((a, b) => b.cost - a.cost),
    },
    analysis: { runs: au.filter(r => !r.via_request).length, pages: au.filter(r => !r.via_request).reduce((n, r) => n + pagesOf(r.pending_chars), 0), pagesLimit: 200 },
    documents: { list: docList, byMonth, total: allDocs.length, failedNow: allDocs.filter(d => d.status === "failed").length, unreadableNow: empty.size },
    other: {
      reprocesses: au2.filter(a => a.action === "reprocess_doc" && a.actor_user_id && clientIds.has(a.actor_user_id)).length,
      readsHeld: au2.filter(a => a.action === "upload_ai_read_deferred").length,
    },
    drafts: draftRows,
    outcomes: {
      byMonth: months.map(m => {
        const r = monthRange(m);
        return { month: m, submitted: apps.filter(d => d.submittedAt && new Date(d.submittedAt) >= r.start && new Date(d.submittedAt) < r.end).length };
      }),
      won: apps.filter(d => d.status === "won").length, lost: apps.filter(d => d.status === "lost").length,
      wonCents: apps.filter(d => d.status === "won").reduce((n, d) => n + (d.amountCents ?? 0), 0),
      submittedAll: apps.filter(d => ["submitted", "won", "lost"].includes(d.status)).length,
      upcoming: { d30: inDays(30), d60: inDays(60), d90: inDays(90) },
    },
    growth: {
      docsTotal: allDocs.length, words: Number((wc as { data: unknown }).data ?? 0),
      cardsVerified: verified.length,
      cardsVerifiedThisMonth: verified.filter(c => c.verified_at && c.verified_at >= s && c.verified_at < e).length,
      cardsTotal: cardRows.filter(c => c.status !== "retired").length,
      readinessPct: coverage && profile ? readiness(profile.org_type, coverage.cov).pct : 0,
    },
    milestones,
  };
}
