import "server-only";
// User-facing data layer. Every read here runs through userClient() → RLS
// enforces tenancy as the signed-in user. No explicit tenant filter is trusted
// for security: for a client, RLS restricts to their tenant; for an admin,
// is_admin() lifts the filter and the activeTenant arg simply *selects* which
// client to view. The Phase 3 service-role scaffold is gone from this file.
import { userClient } from "./supabase";
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

export async function getDocumentsWithTags(tenantId: string): Promise<DocumentWithTags[]> {
  const s = await userClient();
  const { data, error } = await s
    .from("document")
    .select("*, document_tag(tag), app_user!document_uploaded_by_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((d: Record<string, unknown>) => ({
    ...(d as unknown as Document),
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
