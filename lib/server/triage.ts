import "server-only";
// Reading and writing For Granted's judgments about matches.
//
// A plain server module rather than a "use server" one: these take a tenantId
// and go through the service-role client, so as actions they would be
// cross-tenant endpoints for anyone who could guess a uuid.
import { db } from "./db";
import {
  proposesCorrection, type TriageKind, type TriageState,
} from "@/lib/triage";

export interface Judgment {
  kind: TriageKind;
  targetId: string;
  label: string | null;
  state: TriageState;
  reason: string | null;
  note: string | null;
  decidedAt: string;
  /** Set once this rejection has been proposed as a Ground Truth correction. */
  overlayId: string | null;
}

/** Every standing judgment for a client, keyed for lookup by the tables. */
export async function getJudgments(
  tenantId: string, kind?: TriageKind,
): Promise<Map<string, Judgment>> {
  let q = db.from("match_triage")
    .select("kind, target_id, label, state, reason, note, updated_at, overlay_id")
    .eq("tenant_id", tenantId);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw new Error(`judgments read failed: ${error.message}`);

  const out = new Map<string, Judgment>();
  for (const r of (data ?? []) as {
    kind: TriageKind; target_id: string; label: string | null; state: TriageState;
    reason: string | null; note: string | null; updated_at: string; overlay_id: string | null;
  }[]) {
    out.set(`${r.kind}:${r.target_id}`, {
      kind: r.kind, targetId: r.target_id, label: r.label, state: r.state,
      reason: r.reason, note: r.note, decidedAt: r.updated_at, overlayId: r.overlay_id,
    });
  }
  return out;
}

/**
 * Turn a rejection that is a fact about the record into a Ground Truth
 * proposal.
 *
 * A PROPOSAL, never an approved correction. These change what every client
 * sees, and the whole overlay design is that nothing reaches the merged view
 * without a person approving it. One mistaken click in a client's shortlist
 * must not rewrite the shared record.
 *
 * Returns the overlay row id, or null when this judgment is not a global fact.
 * Best-effort: failing to file a proposal must not lose the judgment itself,
 * which is the thing the person actually asked for.
 */
export async function proposeFromJudgment(args: {
  tenantId: string; kind: TriageKind; state: TriageState;
  reason: string | null; targetId: string; label: string | null;
  note: string | null; userId: string; sourceUrl?: string | null;
}): Promise<string | null> {
  const code = proposesCorrection(args.kind, args.state, args.reason);
  if (!code) return null;

  // The overlay is keyed on the base record, not on the client, because the
  // claim is about the record. surfaced_for_tenant only records which
  // engagement noticed it.
  const isFunder = args.kind === "funder";
  const { data, error } = await db.from("ledger_overlay").insert({
    kind: args.kind,
    base_id: args.targetId,
    ein: isFunder ? args.targetId : null,
    title: args.label ?? args.targetId,
    // The correction IS the claim. Recorded as a field so the reviewer sees
    // what is being asserted rather than having to infer it from a code.
    fields: { triage_finding: code.code, triage_statement: code.label },
    // A judgment made in a client's shortlist has no external page behind it.
    // The portal itself is the honest answer to "where was this verified".
    source_url: args.sourceUrl?.trim()
      || `https://portal.forgranted.com/funder-matches#${encodeURIComponent(args.targetId)}`,
    provenance: "client_surfaced",
    surfaced_for_tenant: args.tenantId,
    status: "proposed",
    // Somebody looked at this record and formed a view. That is better than a
    // guess and worse than a checked source, which is what medium means.
    confidence: "medium",
    proposed_by: args.userId,
    review_note: args.note?.slice(0, 500) ?? null,
  }).select("id").maybeSingle();

  if (error) {
    console.error("[triage] could not propose a Ground Truth correction", error);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}
