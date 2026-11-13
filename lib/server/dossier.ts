import "server-only";
// Funder dossier pages (patch 40, from the 7 Nov audit): one page per matched
// funder, assembled from what the cache already holds. Nothing here runs a
// model or calls the Ledger service; a dossier is a reading of work already
// done, which is why it loads instantly and costs nothing.
import { db } from "./db";
import { normalizeEin } from "@/lib/ein";
import type { FunderRow } from "@/lib/funder-rows";
import type { ContactRole } from "@/lib/funder-contact";
import { ROLE_LABEL } from "@/lib/funder-contact";

/** One matched funder for one tenant, or null when no such match exists. */
export async function getFunderDossier(tenantId: string, funderId: string): Promise<FunderRow | null> {
  const { data } = await db.from("matched_funder")
    .select("*").eq("tenant_id", tenantId).eq("funder_id", funderId).maybeSingle();
  return (data as unknown as FunderRow) ?? null;
}

/**
 * The contacts shadow (decided in the 7 Nov audit): the client sees the SHAPE
 * of For Granted's relationship asset, never the asset. Counts, role labels
 * and portfolios only; names, emails, phones, notes and sources never leave
 * the server for a client session. Departed contacts do not count.
 */
export interface ContactShadow {
  count: number;
  roles: string[];       // deduped human labels, e.g. "Program officer"
  portfolios: string[];  // deduped, at most 3
  newestVerified: string | null;
}

export async function getContactShadow(ein: string | null): Promise<ContactShadow | null> {
  const key = ein ? normalizeEin(ein) : "";
  if (!key) return null;
  // tenant-safe: funder_contact carries no tenant_id (see 0026). It is For
  // Granted IP shared across engagements; this helper ships aggregates only
  // (count, role labels, portfolios), the product decision from the 7 Nov
  // audit, and never the records themselves.
  const { data } = await db.from("funder_contact")
    .select("role, portfolio, status, last_verified_at").eq("ein", key);
  const rows = ((data ?? []) as { role: ContactRole; portfolio: string | null; status: string; last_verified_at: string }[])
    .filter(r => r.status !== "departed");
  if (!rows.length) return null;
  return {
    count: rows.length,
    roles: [...new Set(rows.map(r => ROLE_LABEL[r.role] ?? "Contact"))],
    portfolios: [...new Set(rows.map(r => r.portfolio).filter((p): p is string => !!p))].slice(0, 3),
    newestVerified: rows.map(r => r.last_verified_at).sort().pop() ?? null,
  };
}
