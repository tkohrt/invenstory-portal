"use server";
// Signals (patch 64): the admin's verbs on the Sources tab. For Granted only.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { upsertSource, checkPage, checkBluesky, readHeldEmail, sourceById, type Budget } from "./signals";
import { CATEGORIES, type SourceCategory, type SourceKind, type SourceRow } from "@/lib/signals";
import { canBeFirstParty, isTrust } from "@/lib/trust";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function admin() {
  const s = await getSession();
  return s && s.role === "admin" ? s : null;
}
const budget = (): Budget => ({ parses: 2, stopAt: Date.now() + 100_000 });

export async function addSourceAction(a: { kind: string; address: string; label: string; category: string; trust?: string }): Promise<Result<{ created: boolean }>> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  if (a.kind !== "page" && a.kind !== "bluesky") return { ok: false, error: "Choose a page or a Bluesky account. Newsletter senders add themselves when their first email arrives." };
  const category = (CATEGORIES as string[]).includes(a.category) ? a.category as SourceCategory : "funder";
  // Whose words it carries is the person's call at the form (patch 67). An aggregator or procurement portal never starts first-party.
  const trust = isTrust(a.trust) && (category === "funder" || category === "accelerator") ? a.trust : "review";
  const r = await upsertSource({ kind: a.kind as SourceKind, address: a.address, label: a.label, category, origin: "manual", userId: s.user.id, trust });
  if (!r.ok) return r;
  revalidatePath("/admin/reviews");
  return { ok: true, created: r.created };
}

export async function setSourceActiveAction(id: string, active: boolean): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  const { error } = await db.from("signal_source").update({ active: !!active }).eq("id", String(id));
  if (error) return { ok: false, error: "That did not save. Try again." };
  // Approving a sender releases its held mail to the next run, so nothing held is lost if nobody presses Read it.
  if (active) await db.from("signal").update({ status: "new" }).eq("source_id", String(id)).eq("status", "held");
  revalidatePath("/admin/reviews");
  return { ok: true };
}

/**
 * Say whose words a source carries (patch 67). First-party: its opportunities
 * reach matched clients at once with the "not yet reviewed" label. Review:
 * nothing from it reaches a client until approved. The change applies to what
 * the source produces from now on; entries already filed keep their standing
 * (approve or reject those in the queue). Audited: this decides what clients
 * see unreviewed.
 */
export async function setSourceTrustAction(id: string, trust: string): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  if (!isTrust(trust)) return { ok: false, error: "Choose one of the two." };
  const { data } = await db.from("signal_source").select("id, kind, label").eq("id", String(id)).maybeSingle();
  const src = data as { id: string; kind: string; label: string } | null;
  if (!src) return { ok: false, error: "That source is not on file." };
  if (trust === "first_party" && !canBeFirstParty(src.kind)) return { ok: false, error: "Mail always waits for review: a sender's address does not prove who wrote it." };
  const { error } = await db.from("signal_source").update({ trust }).eq("id", src.id);
  if (error) return { ok: false, error: "That did not save. Has migration 0100 been applied?" };
  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: null, action: "source_trust",
    detail: `${src.label.slice(0, 120)}: ${trust === "first_party" ? "publishes with the not-yet-reviewed label" : "waits for review"}`,
  });
  revalidatePath("/admin/reviews");
  return { ok: true };
}

/** Read one watched page now, without waiting for the next run. */
export async function checkSourceNowAction(id: string): Promise<Result<{ message: string }>> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  const src: SourceRow | null = await sourceById(String(id));
  if (src?.kind === "bluesky") {
    const b = await checkBluesky(src, budget());
    revalidatePath("/admin/reviews");
    if (!b.ok) return { ok: false, error: b.error ?? "Bluesky did not answer." };
    return { ok: true, message: b.kept
      ? `Read. ${b.kept} new post${b.kept === 1 ? "" : "s"} about funding${b.filed ? `; ${b.filed} new entr${b.filed === 1 ? "y" : "ies"} in the Ground Truth queue` : ""}.`
      : "Read. No new posts about funding." };
  }
  if (!src || src.kind !== "page") return { ok: false, error: "Only a watched page or a Bluesky account can be read on demand." };
  const r = await checkPage(src, budget());
  revalidatePath("/admin/reviews");
  if (r.error) return { ok: false, error: r.error };
  if (!r.changed) return { ok: true, message: "Read. Nothing has changed since the last read." };
  return { ok: true, message:
    r.status === "filed" ? `Changed. ${r.entries} new entr${r.entries === 1 ? "y is" : "ies are"} in the Ground Truth queue.`
    : r.status === "nothing" ? "Changed, but nothing in it is new to the queue."
    : r.status === "skipped" ? "Changed, but it does not read like funding news, so it was not parsed."
    : "Changed. It will be parsed on the next run." };
}

/** Read one held email, after its sender was approved. */
export async function readHeldAction(signalId: string): Promise<Result<{ message: string }>> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  const r = await readHeldEmail(String(signalId), budget());
  revalidatePath("/admin/reviews");
  if (!r.ok) return { ok: false, error: r.error ?? "That email could not be read." };
  return { ok: true, message:
    r.status === "filed" ? `${r.entries} new entr${r.entries === 1 ? "y is" : "ies are"} in the Ground Truth queue.`
    : r.status === "nothing" ? "Read. Nothing in it is new to the queue."
    : r.status === "skipped" ? "It does not read like funding news, so it was not parsed."
    : "It will be parsed on the next run." };
}
