"use server";
// Peer organizations, saved from the Funding Eligibility page (patch 48). In
// setup they are saved with the eligibility step (setup-actions.ts); this is
// the same list for a client who is past setup, or a For Granted admin
// entering it for them.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { cleanPeerOrgs, matchedOrgs, peerCheck, type PeerCheck } from "@/lib/peers";
import type { SetupAnswers } from "@/lib/setup";

export async function savePeerOrgsAction(input: string[]): Promise<{ ok: boolean; error: string | null; peers: string[] }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again.", peers: [] };
  const peers = cleanPeerOrgs(input);
  const fail = { ok: false, error: "That did not save. Please try again, or tell your For Granted team.", peers };
  // A client made before setup existed, or one an admin is preparing before
  // the first sign-in, may have no row yet. Making one claims nothing: the
  // owner stays empty, so the first client to arrive still gets the welcome.
  const made = await db.from("tenant_setup").upsert({ tenant_id: s.tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
  if (made.error) { console.error("[peers] could not make the setup row", made.error.message); return fail; }
  const { data, error: readErr } = await db.from("tenant_setup").select("answers").eq("tenant_id", s.tenantId).maybeSingle();
  if (readErr) { console.error("[peers] read failed", readErr.message); return fail; }
  const answers = ((data as { answers?: SetupAnswers | null } | null)?.answers ?? {}) as SetupAnswers;
  const { error } = await db.from("tenant_setup").update({ answers: { ...answers, peer_orgs: peers }, updated_at: new Date().toISOString() }).eq("tenant_id", s.tenantId);
  if (error) { console.error("[peers] save failed", error.message); return fail; }
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "peer_orgs_save", detail: `count=${peers.length}` });
  revalidatePath("/funding-eligibility"); revalidatePath("/funding");
  return { ok: true, error: null, peers };
}

/**
 * Does Ground Truth know this peer? (patch 49). Asked as the person leaves the
 * box, in setup and on the Funding Eligibility page, so a name that would find
 * nothing, or the wrong organization, is caught while it can still be fixed.
 * Reads only: nothing is saved here. Quiet on every failure, because a check
 * that cannot be made must not look like a peer that was not found.
 */
export async function checkPeerOrgAction(input: string): Promise<PeerCheck> {
  const s = await getSession();
  if (!s) return { kind: "unchecked" };
  const name = cleanPeerOrgs([input])[0];
  if (!name) return { kind: "unchecked" };
  try {
    const { fundersLikeMine, ledgerConfigured } = await import("./ledger");
    if (!ledgerConfigured()) return { kind: "unchecked" };
    const exact = matchedOrgs((await fundersLikeMine({ peer_orgs: [name], limit: 1 })).raw);
    const first = peerCheck(name, exact);
    // Only a name that did not land cleanly is worth the slower, meaning-based
    // look for what the person may have meant.
    if (first.kind === "found" || (first.kind === "missing" && first.ein)) return first;
    const similar = await fundersLikeMine({ org_description: name, limit: 1 }).then(r => matchedOrgs(r.raw)).catch(() => [] as string[]);
    return peerCheck(name, exact, similar);
  } catch (e) {
    console.error("[peers] check failed", e instanceof Error ? e.message : e);
    return { kind: "unchecked" };
  }
}
