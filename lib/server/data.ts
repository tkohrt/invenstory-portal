import "server-only";
// User-facing data layer. Every read here runs through userClient() → RLS
// enforces tenancy as the signed-in user. No explicit tenant filter is trusted
// for security: for a client, RLS restricts to their tenant; for an admin,
// is_admin() lifts the filter and the activeTenant arg simply *selects* which
// client to view. The Phase 3 service-role scaffold is gone from this file.
import { WORKSPACE_FEATURES, WORKSPACE_FEATURE_MAP } from "@/lib/workspace";
import { userClient } from "./supabase";
import { db } from "./db";
import type {
  ArtifactBundle, ArtifactCard, ArtifactSet, ArtifactType, CiteDoc,
  Document, DocumentWithTags, Layer, Tenant, TenantSummary,
} from "@/lib/types";

export async function getTenants(): Promise<Tenant[]> {
  const s = await userClient();
  const { data, error } = await s.from("tenant").select("*").order("name");
  if (error) throw error;
  return data as Tenant[];
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const s = await userClient();
  const { data } = await s.from("tenant").select("*").eq("id", id).single();
  return data as Tenant | null;
}

export async function getDocumentsWithTags(tenantId: string, redactForClient = false): Promise<DocumentWithTags[]> {
  const s = await userClient();
  const { data, error } = await s
    .from("document")
    .select("*, document_tag(tag), app_user!document_uploaded_by_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((d: Record<string, unknown>) => ({
    ...(d as unknown as Document),
    error_detail: redactForClient ? null : ((d as unknown as Document).error_detail),
    tags: ((d.document_tag as { tag: string }[]) ?? []).map(t => t.tag),
    uploader_name: (d.app_user as { full_name: string } | null)?.full_name ?? "—",
  }));
}

async function resolveCites(tenantId: string, cards: ArtifactCard[]): Promise<ArtifactBundle["cards"]> {
  const ids = [...new Set(cards.flatMap(c => c.citations))];
  if (ids.length === 0) return cards.map(c => ({ ...c, citation_docs: [] }));
  const s = await userClient();
  const { data } = await s.from("document").select("id, title").eq("tenant_id", tenantId).in("id", ids);
  const map = new Map(((data ?? []) as CiteDoc[]).map(d => [d.id, d]));
  return cards.map(c => ({ ...c, citation_docs: c.citations.map(id => map.get(id)).filter((x): x is CiteDoc => Boolean(x)) }));
}

export async function getArtifactBundles(tenantId: string): Promise<ArtifactBundle[]> {
  const s = await userClient();
  const [{ data: types }, { data: sets }] = await Promise.all([
    s.from("artifact_type").select("*").order("slug"),
    s.from("artifact_set").select("*").eq("tenant_id", tenantId),
  ]);
  const bundles: ArtifactBundle[] = [];
  for (const type of (types ?? []) as ArtifactType[]) {
    const set = ((sets ?? []) as ArtifactSet[]).find(x => x.type_slug === type.slug);
    if (!set) continue;
    const { data: cards } = await s.from("artifact_card").select("*")
      .eq("tenant_id", tenantId).eq("set_id", set.id).order("sort_order");
    bundles.push({ type, set, cards: await resolveCites(tenantId, (cards ?? []) as ArtifactCard[]) });
  }
  return bundles;
}


// Nav-visible artifact types: admins see all (to manage/toggle); clients see
// only types whose set is client_visible for their tenant.
export async function getNavArtifactTypes(tenantId: string, isAdmin: boolean): Promise<import("@/lib/types").NavArtifact[]> {
  const s = await userClient();
  const { data: types } = await s.from("artifact_type").select("slug, nav_label").order("slug");
  const { data: sets } = await s.from("artifact_set").select("type_slug, client_visible").eq("tenant_id", tenantId);
  const visibleMap = new Map((sets ?? []).map(x => [x.type_slug, x.client_visible]));
  const items = ((types ?? []) as { slug: string; nav_label: string }[])
    .map(t => ({ slug: t.slug, nav_label: t.nav_label, visible: visibleMap.get(t.slug) ?? true }));
  // Admins see every type (with its visibility flag); clients see only visible ones.
  return isAdmin ? items : items.filter(i => i.visible);
}

// Top-level Workspace feature visibility. Each toggleable feature has a default
// (see lib/workspace.ts). Resolution: an explicit feature_visibility row wins;
// otherwise the feature's registry default applies (e.g. Answer Library => hidden,
// Dashboard/Ask/Grants => visible). Unknown keys default hidden.
export async function getFeatureVisible(tenantId: string, featureKey: string): Promise<boolean> {
  const map = await getWorkspaceVisibility(tenantId);
  return map[featureKey] ?? (WORKSPACE_FEATURE_MAP[featureKey]?.defaultVisible ?? false);
}

// Resolved visibility for every toggleable Workspace feature, applying defaults.
export async function getWorkspaceVisibility(tenantId: string): Promise<Record<string, boolean>> {
  const s = await userClient();
  const { data } = await s.from("feature_visibility")
    .select("feature_key, visible").eq("tenant_id", tenantId);
  const rows = new Map((data ?? []).map((r: { feature_key: string; visible: boolean }) => [r.feature_key, r.visible]));
  const out: Record<string, boolean> = {};
  for (const f of WORKSPACE_FEATURES) out[f.key] = rows.get(f.key) ?? f.defaultVisible;
  return out;
}

export async function getArtifactTypes(): Promise<ArtifactType[]> {
  const s = await userClient();
  const { data } = await s.from("artifact_type").select("*").order("slug");
  return (data ?? []) as ArtifactType[];
}

// Admin aggregates: RLS still applies (is_admin() gate), a non-admin gets nothing.
export async function getTenantSummaries(): Promise<TenantSummary[]> {
  const s = await userClient();
  const tenants = await getTenants();
  const { data: docs } = await s.from("document").select("tenant_id, layer");
  return tenants.map(t => {
    const mine = (docs ?? []).filter(d => d.tenant_id === t.id);
    const by_layer: Record<Layer, number> = { I: 0, II: 0, III: 0 };
    mine.forEach(d => { by_layer[d.layer as Layer] += 1; });
    return { ...t, doc_count: mine.length, by_layer };
  });
}

export interface PendingReview { set: ArtifactSet; type: ArtifactType; tenant: Tenant; card_count: number }
export async function getPendingReviews(): Promise<PendingReview[]> {
  const s = await userClient();
  const { data: sets } = await s.from("artifact_set").select("*, tenant(*), artifact_type(*)").eq("status", "pending");
  return ((sets ?? []) as (ArtifactSet & { tenant: Tenant; artifact_type: ArtifactType })[])
    .map(s => ({ set: s, type: s.artifact_type, tenant: s.tenant, card_count: 0 }));
}

export async function getPrimaryContact(tenantId: string): Promise<string | null> {
  const s = await userClient();
  const { data } = await s.from("app_user").select("full_name")
    .eq("tenant_id", tenantId).eq("role", "client").order("created_at").limit(1).maybeSingle();
  return data?.full_name ?? null;
}

export async function getClientStats(tenantId: string): Promise<import("@/lib/types").ClientStats> {
  const s = await userClient();
  const [{ data: docs }, { data: drafts }, wc] = await Promise.all([
    s.from("document").select("layer").eq("tenant_id", tenantId),
    s.from("grant_draft").select("status, amount_cents").eq("tenant_id", tenantId),
    s.rpc("tenant_word_count", { p_tenant: tenantId }),
  ]);
  const byLayer = { I: 0, II: 0, III: 0 } as Record<import("@/lib/types").Layer, number>;
  (docs ?? []).forEach(d => { byLayer[d.layer as import("@/lib/types").Layer] += 1; });
  const dr = (drafts ?? []) as { status: string; amount_cents: number | null }[];
  const applied = dr.filter(d => ["submitted", "won", "lost"].includes(d.status)).length;
  const won = dr.filter(d => d.status === "won").length;
  const inProgress = dr.filter(d => ["drafting", "client_review"].includes(d.status)).length;
  const revenueWonCents = dr.filter(d => d.status === "won").reduce((n, d) => n + (d.amount_cents ?? 0), 0);
  return { docs: (docs ?? []).length, byLayer, words: Number(wc.data ?? 0), applied, won, inProgress, revenueWonCents };
}

export async function getPortfolioStats(): Promise<import("@/lib/types").PortfolioStats> {
  const { data: tenants } = await db.from("tenant").select("id, name").order("name");
  const { data: docs } = await db.from("document").select("tenant_id");
  const { data: drafts } = await db.from("grant_draft").select("tenant_id, status, amount_cents");
  const dr = (drafts ?? []) as { tenant_id: string; status: string; amount_cents: number | null }[];
  let totalWords = 0;
  const perClient = await Promise.all((tenants ?? []).map(async (t: { id: string; name: string }) => {
    const { data: wc } = await db.rpc("tenant_word_count", { p_tenant: t.id });
    totalWords += Number(wc ?? 0);
    const clientDrafts = dr.filter(d => d.tenant_id === t.id);
    return {
      id: t.id,
      name: t.name,
      docs: (docs ?? []).filter(d => d.tenant_id === t.id).length,
      won: clientDrafts.filter(d => d.status === "won").length,
      revenueWonCents: clientDrafts.filter(d => d.status === "won").reduce((n, d) => n + (d.amount_cents ?? 0), 0),
    };
  }));
  return {
    tenants: (tenants ?? []).length,
    totalDocs: (docs ?? []).length,
    totalWords,
    applied: dr.filter(d => ["submitted", "won", "lost"].includes(d.status)).length,
    won: dr.filter(d => d.status === "won").length,
    revenueWonCents: dr.filter(d => d.status === "won").reduce((n, d) => n + (d.amount_cents ?? 0), 0),
    perClient,
  };
}

// ---- Answer Library ----
export async function getAnswerLibrary(tenantId: string, orgType: "nonprofit" | "startup" | null): Promise<import("@/lib/types").AnswerLibraryItem[]> {
  const s = await userClient();
  const audiences = ["both", orgType ?? "nonprofit"];
  const [{ data: questions }, { data: answers }] = await Promise.all([
    s.from("grant_question").select("*").eq("active", true).in("audience", audiences).order("sort_order"),
    s.from("answer").select("*").eq("tenant_id", tenantId),
  ]);
  const ansByQ = new Map((answers ?? []).map((a: Record<string, unknown>) => [a.question_id as string, a]));
  // citations for the answers of this tenant
  const answerIds = (answers ?? []).map((a: Record<string, unknown>) => a.id as string);
  const citesByAnswer = new Map<string, import("@/lib/types").AnswerCite[]>();
  if (answerIds.length) {
    const { data: cites } = await s.from("answer_citation").select("answer_id, document_id").in("answer_id", answerIds);
    const docIds = [...new Set((cites ?? []).map((c: Record<string, unknown>) => c.document_id as string))];
    const { data: docs } = await s.from("document").select("id, title").in("id", docIds.length ? docIds : ["00000000-0000-0000-0000-000000000000"]);
    const titleById = new Map((docs ?? []).map((d: Record<string, unknown>) => [d.id as string, d.title as string]));
    const ansById = new Map((answers ?? []).map((a: Record<string, unknown>) => [a.id as string, a.question_id as string]));
    void ansById;
    for (const c of (cites ?? []) as Record<string, unknown>[]) {
      const aid = c.answer_id as string;
      const list = citesByAnswer.get(aid) ?? [];
      list.push({ document_id: c.document_id as string, title: titleById.get(c.document_id as string) ?? "Document" });
      citesByAnswer.set(aid, list);
    }
  }
  return ((questions ?? []) as import("@/lib/types").GrantQuestion[]).map(q => {
    const a = ansByQ.get(q.id) as Record<string, unknown> | undefined;
    return {
      question: q,
      answer: a ? {
        short_answer: (a.short_answer as string) ?? null, long_answer: (a.long_answer as string) ?? null,
        completeness: a.completeness as import("@/lib/types").Completeness, robustness_score: (a.robustness_score as number) ?? 0,
        source: a.source as "auto" | "human", status: a.status as "draft" | "in_review" | "published",
        reviewed_at: (a.reviewed_at as string) ?? null, stale: (a.stale as boolean) ?? false,
      } : null,
      citations: a ? (citesByAnswer.get(a.id as string) ?? []) : [],
    };
  });
}

export async function getAllQuestions(): Promise<import("@/lib/types").GrantQuestion[]> {
  const s = await userClient();
  const { data } = await s.from("grant_question").select("*").order("audience").order("sort_order");
  return (data ?? []) as import("@/lib/types").GrantQuestion[];
}
