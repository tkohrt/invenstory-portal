"use server";
// Funder dossier pages (patch 40): the client's one verb. Request an approach
// files a Requests-inbox row (patch 37); contact details never move, and the
// conversation it starts is For Granted's to have.
import { getSession } from "./session";
import { db } from "./db";
import { notifyClientRequest } from "./notify";

export async function requestApproachAction(funderId: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "You are signed out. Sign in and try again." };
  if (s.role !== "client") return { ok: false, error: "The as-client preview cannot send requests." };
  // Only a funder this tenant was actually matched with can be asked about.
  const { data } = await db.from("matched_funder").select("funder_id")
    .eq("tenant_id", s.tenantId).eq("funder_id", funderId).maybeSingle();
  if (!data) return { ok: false, error: "That funder is not on your list." };
  const { data: t } = await db.from("tenant").select("name").eq("id", s.tenantId).maybeSingle();
  await notifyClientRequest({
    org: (t as { name: string } | null)?.name ?? "A client", requester: s.user.full_name,
    what: `requested an approach to ${name.slice(0, 200)} — they want to talk strategy for reaching this funder.`,
    tenantId: s.tenantId,
    inbox: { kind: "approach_request", sourceKey: `approach:${funderId}` },
  });
  return { ok: true };
}

/**
 * Re-read a funder's own website for its social, newsletter and feed links
 * (patch 63). For Granted only. The address read is the one on this tenant's
 * matched funder record, never one the browser sends.
 */
export async function refreshFunderLinksAction(funderId: string): Promise<{ ok: true; found: number; changed: number } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "For Granted only." };
  const { data } = await db.from("matched_funder").select("funder_id, ein, website")
    .eq("tenant_id", s.tenantId).eq("funder_id", String(funderId).slice(0, 220)).maybeSingle();
  const f = data as { funder_id: string; ein: string | null; website: string | null } | null;
  if (!f) return { ok: false, error: "That funder is not on this client's list." };
  if (!f.website) return { ok: false, error: "No website is on record for this funder, so there is nothing to read." };
  const { lookupFunderLinks } = await import("./funder-links");
  const r = await lookupFunderLinks({ ein: f.ein, funderId: f.funder_id, website: f.website });
  if (!r.ok) return r;
  return { ok: true, found: Object.keys(r.found).length, changed: r.changed.length };
}
