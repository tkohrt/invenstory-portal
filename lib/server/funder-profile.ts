import "server-only";
// The shared funder profile (patch 41): read and feed. Every write goes
// through applyProfileFields, so the merge rule (stated fields replace, absent
// fields never blank) and the per-field provenance hold at every feed point.
import { db } from "./db";
import { mergeProfile, profileKey, type FieldProvenance, type ProfileFields, type ProfileMeta } from "@/lib/funder-profile";

export interface FunderProfileRecord { fields: ProfileFields; meta: ProfileMeta; updated_at: string }

/** The shared profile a dossier reads live. Null when nothing is on file yet. */
export async function getFunderProfile(ein: string | null | undefined, funderId: string): Promise<FunderProfileRecord | null> {
  // tenant-safe: funder_profile is For Granted's shared, admin-only funder
  // record (no tenant_id), read by funder key.
  const { data } = await db.from("funder_profile")
    .select("fields, field_meta, updated_at").eq("funder_key", profileKey(ein, funderId)).maybeSingle();
  if (!data) return null;
  const r = data as { fields: ProfileFields; field_meta: ProfileMeta; updated_at: string };
  return { fields: r.fields ?? {}, meta: r.field_meta ?? {}, updated_at: r.updated_at };
}

/** Merge stated fields into a funder's shared profile. Best-effort: a missing
    0088 or a conflict never breaks the caller (approval must still land). */
export async function applyProfileFields(
  a: { ein: string | null | undefined; funderId: string; incoming: Record<string, unknown>; prov: FieldProvenance },
): Promise<string[]> {
  try {
    const key = profileKey(a.ein, a.funderId);
    if (!key) return [];
    // tenant-safe: shared admin-only funder record, addressed by key.
    const { data } = await db.from("funder_profile").select("fields, field_meta").eq("funder_key", key).maybeSingle();
    const cur = (data as { fields: ProfileFields; field_meta: ProfileMeta } | null) ?? { fields: {}, field_meta: {} };
    const merged = mergeProfile(cur.fields ?? {}, cur.field_meta ?? {}, a.incoming, a.prov);
    if (!merged.changed.length) return [];
    // tenant-safe: shared admin-only funder record, addressed by key.
    const { error } = await db.from("funder_profile").upsert({
      funder_key: key, ein: (a.ein ?? "").replace(/\D/g, "") || null,
      fields: merged.fields, field_meta: merged.meta, updated_at: new Date().toISOString(),
    }, { onConflict: "funder_key" });
    if (error) { console.error("[funder-profile] merge failed", error.message); return []; }
    return merged.changed;
  } catch (e) {
    console.error("[funder-profile] merge failed", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Engagement history (admin eyes only, computed live, never stored): the
 * drafts across ALL clients that reference this funder. Deliberately a
 * cross-tenant read — it is For Granted's own picture of its work — and it
 * must never reach a client page or the as-client preview.
 */
export interface EngagementRow { tenant_name: string; title: string; status: string; updated_at: string; submitted: boolean }

export async function getEngagementHistory(ein: string | null | undefined, name: string): Promise<EngagementRow[]> {
  const digits = (ein ?? "").replace(/\D/g, "");
  // Deliberate cross-tenant read: For Granted's own engagement history with one
  // funder across its clients; the dossier renders it only for a real admin
  // session, never the as-client preview.
  // tenant-safe: admin-only cross-tenant engagement history, by design (patch 41)
  const q = db.from("grant_draft").select("tenant_id, title, status, updated_at, submitted_at, funder, opportunity_ref").limit(400);
  const { data } = await q;
  const rows = ((data ?? []) as { tenant_id: string; title: string; status: string; updated_at: string; submitted_at: string | null; funder: string | null; opportunity_ref: { funder_ein?: string } | null }[])
    .filter(d => (digits && (d.opportunity_ref?.funder_ein ?? "").replace(/\D/g, "") === digits)
      || (d.funder && name && d.funder.toLowerCase().includes(name.toLowerCase().slice(0, 40))));
  if (!rows.length) return [];
  const tenantIds = [...new Set(rows.map(r => r.tenant_id))];
  // tenant-safe: tenant names for the admin-only history above.
  const { data: tenants } = await db.from("tenant").select("id, name").in("id", tenantIds);
  const names = new Map(((tenants ?? []) as { id: string; name: string }[]).map(t => [t.id, t.name]));
  return rows
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 25)
    .map(r => ({
      tenant_name: names.get(r.tenant_id) ?? "Unknown client", title: r.title,
      status: r.status, updated_at: r.updated_at, submitted: !!r.submitted_at,
    }));
}
