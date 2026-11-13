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
