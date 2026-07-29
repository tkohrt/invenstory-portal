import "server-only";
// Live data layer. Same shapes the Phase 1 mock exposed — pages didn't change.
// PHASE 3 NOTE: explicit .eq("tenant_id", ...) on service client is the
// temporary pre-auth tenancy filter; Phase 4 moves user reads under RLS.
import { db } from "./db";
import type {
  ArtifactBundle, ArtifactCard, ArtifactSet, ArtifactType, CiteDoc,
  Document, DocumentWithTags, Layer, Tenant, TenantSummary,
} from "@/lib/types";

export async function getTenants(): Promise<Tenant[]> {
  const { data, error } = await db.from("tenant").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const { data } = await db.from("tenant").select("*").eq("id", id).single();
  return data;
}

export async function getDocumentsWithTags(tenantId: string): Promise<DocumentWithTags[]> {
  const { data, error } = await db
    .from("document")
    .select("*, document_tag(tag), app_user!document_uploaded_by_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data.map((d: Record<string, unknown>) => ({
    ...(d as unknown as Document),
    tags: ((d.document_tag as { tag: string }[]) ?? []).map(t => t.tag),
    uploader_name: (d.app_user as { full_name: string } | null)?.full_name ?? "—",
  }));
}

async function resolveCites(tenantId: string, cards: ArtifactCard[]): Promise<ArtifactBundle["cards"]> {
  const ids = [...new Set(cards.flatMap(c => c.citations))];
  if (ids.length === 0) return cards.map(c => ({ ...c, citation_docs: [] }));
  const { data } = await db.from("document").select("id, title").eq("tenant_id", tenantId).in("id", ids);
  const map = new Map((data ?? []).map((d: CiteDoc) => [d.id, d]));
  return cards.map(c => ({
    ...c,
    citation_docs: c.citations.map(id => map.get(id)).filter((x): x is CiteDoc => Boolean(x)),
  }));
}

export async function getArtifactBundles(tenantId: string): Promise<ArtifactBundle[]> {
  const [{ data: types }, { data: sets }] = await Promise.all([
    db.from("artifact_type").select("*").order("slug"),
    db.from("artifact_set").select("*").eq("tenant_id", tenantId),
  ]);
  const bundles: ArtifactBundle[] = [];
  for (const type of (types ?? []) as ArtifactType[]) {
    const set = ((sets ?? []) as ArtifactSet[]).find(s => s.type_slug === type.slug);
    if (!set) continue;
    const { data: cards } = await db.from("artifact_card").select("*")
      .eq("tenant_id", tenantId).eq("set_id", set.id).order("sort_order");
    bundles.push({ type, set, cards: await resolveCites(tenantId, (cards ?? []) as ArtifactCard[]) });
  }
  return bundles;
}

export async function getTenantSummaries(): Promise<TenantSummary[]> {
  const tenants = await getTenants();
  const { data: docs } = await db.from("document").select("tenant_id, layer");
  return tenants.map(t => {
    const mine = (docs ?? []).filter(d => d.tenant_id === t.id);
    const by_layer: Record<Layer, number> = { I: 0, II: 0, III: 0 };
    mine.forEach(d => { by_layer[d.layer as Layer] += 1; });
    return { ...t, doc_count: mine.length, by_layer };
  });
}

export interface PendingReview { set: ArtifactSet; type: ArtifactType; tenant: Tenant; card_count: number }
export async function getPendingReviews(): Promise<PendingReview[]> {
  const { data: sets } = await db.from("artifact_set").select("*, tenant(*), artifact_type(*)").eq("status", "pending");
  return ((sets ?? []) as (ArtifactSet & { tenant: Tenant; artifact_type: ArtifactType })[]).map(s => ({
    set: s, type: s.artifact_type, tenant: s.tenant, card_count: 0,
  }));
}
