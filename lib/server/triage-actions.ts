"use server";
// Recording a judgment about a match.
//
// Admin-only. A rejection changes what a client sees, and a global rejection
// proposes a change to what EVERY client sees, so this is a decision taken
// deliberately rather than one inherited from the tenant policy.
//
// Every export of a "use server" module is a public endpoint, so none of these
// takes a tenant id: it comes from the session, the only source a caller cannot
// supply.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { proposeFromJudgment } from "./triage";
import { validateTriage, type TriageKind } from "@/lib/triage";

async function adminSession() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

function asKind(v: string): TriageKind {
  if (v !== "funder" && v !== "grant") throw new Error("unknown kind");
  return v;
}

/**
 * Set, or change, what For Granted thinks of one row.
 *
 * The reason is validated here rather than trusted to the form. A rejection
 * with no reason is the one shape of this data that teaches nothing: it cannot
 * be counted, cannot suppress usefully, and cannot become a correction.
 */
export async function setTriageAction(input: {
  kind: string; targetId: string; label?: string | null;
  state: string; reason?: string | null; note?: string | null;
}) {
  const s = await adminSession();
  const kind = asKind(input.kind);
  if (!input.targetId) throw new Error("no row given");

  const checked = validateTriage(kind, input.state, input.reason);
  if (!checked.ok) throw new Error(checked.error);

  const overlayId = await proposeFromJudgment({
    tenantId: s.tenantId, kind, state: checked.state, reason: checked.reason,
    targetId: input.targetId, label: input.label ?? null,
    note: input.note ?? null, userId: s.user.id,
  });

  const { error } = await db.from("match_triage").upsert({
    tenant_id: s.tenantId, kind, target_id: input.targetId,
    label: input.label?.slice(0, 300) ?? null,
    state: checked.state, reason: checked.reason,
    note: input.note?.slice(0, 500) ?? null,
    // Only overwrite with a new proposal id; a re-judgement that files no
    // proposal should not erase the record of one already filed.
    ...(overlayId ? { overlay_id: overlayId } : {}),
    decided_by: s.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,kind,target_id" });
  if (error) throw new Error(`Could not save that decision: ${error.message}`);

  revalidatePath("/funder-matches");
}

/** Undo a judgment entirely, putting the row back in the list unmarked. */
export async function clearTriageAction(kind: string, targetId: string) {
  const s = await adminSession();
  const k = asKind(kind);
  if (!targetId) throw new Error("no row given");
  // The Ground Truth proposal it may have filed is deliberately left standing.
  // That claim is about the record rather than about this client's shortlist,
  // and withdrawing it is a decision for the review queue.
  const { error } = await db.from("match_triage")
    .delete().eq("tenant_id", s.tenantId).eq("kind", k).eq("target_id", targetId);
  if (error) throw new Error(`Could not undo that: ${error.message}`);
  revalidatePath("/funder-matches");
}
