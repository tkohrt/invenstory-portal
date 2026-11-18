"use server";
// Signals (patch 64): the admin's verbs on the Sources tab. For Granted only.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { upsertSource, checkPage, readHeldEmail, type Budget } from "./signals";
import { CATEGORIES, type SourceCategory, type SourceKind, type SourceRow } from "@/lib/signals";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function admin() {
  const s = await getSession();
  return s && s.role === "admin" ? s : null;
}
const budget = (): Budget => ({ parses: 2, stopAt: Date.now() + 100_000 });

export async function addSourceAction(a: { kind: string; address: string; label: string; category: string }): Promise<Result<{ created: boolean }>> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  if (a.kind !== "page" && a.kind !== "bluesky") return { ok: false, error: "Choose a page or a Bluesky account. Newsletter senders add themselves when their first email arrives." };
  const category = (CATEGORIES as string[]).includes(a.category) ? a.category as SourceCategory : "funder";
  const r = await upsertSource({ kind: a.kind as SourceKind, address: a.address, label: a.label, category, origin: "manual", userId: s.user.id });
  if (!r.ok) return r;
  revalidatePath("/admin/reviews");
  return { ok: true, created: r.created };
}

export async function setSourceActiveAction(id: string, active: boolean): Promise<Result> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  const { error } = await db.from("signal_source").update({ active: !!active }).eq("id", String(id));
  if (error) return { ok: false, error: "That did not save. Try again." };
  revalidatePath("/admin/reviews");
  return { ok: true };
}

/** Read one watched page now, without waiting for the next run. */
export async function checkSourceNowAction(id: string): Promise<Result<{ message: string }>> {
  const s = await admin();
  if (!s) return { ok: false, error: "For Granted only." };
  const { data } = await db.from("signal_source").select("*").eq("id", String(id)).maybeSingle();
  const src = data as SourceRow | null;
  if (!src || src.kind !== "page") return { ok: false, error: "Only a watched page can be read on demand." };
  const r = await checkPage(src, budget());
  revalidatePath("/admin/reviews");
  if (r.error) return { ok: false, error: r.error };
  if (!r.changed) return { ok: true, message: "Read. Nothing has changed since the last read." };
  return { ok: true, message:
    r.status === "filed" ? `Changed. ${r.entries} entr${r.entries === 1 ? "y" : "ies"} read from it; new ones are in the Ground Truth queue.`
    : r.status === "nothing" ? "Changed, but no opportunities could be read from it."
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
    r.status === "filed" ? `${r.entries} entr${r.entries === 1 ? "y" : "ies"} read from it; new ones are in the Ground Truth queue.`
    : r.status === "nothing" ? "Read. No opportunities in it."
    : r.status === "skipped" ? "It does not read like funding news, so it was not parsed."
    : "It will be parsed on the next run." };
}
