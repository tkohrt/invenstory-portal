// Which Ground Truth state a base record is in.
//
// Pure and free of `server-only` so it can be unit tested. The third state is
// the one that earns its keep: without it, two people file competing
// corrections for the same record and the unique partial index rejects the
// second at approve time, which is late and confusing. Surfaced in the picker,
// a duplicate becomes an edit.
export type GroundTruthState = "base" | "verified" | "pending";

export interface GroundTruthStatus {
  state: GroundTruthState;
  /** Who approved the live correction, when there is one. */
  verified_by?: string | null;
  verified_at?: string | null;
  /** The pending proposal's id, so the UI can link straight to it. */
  pending_id?: string;
}

export interface StatusRow {
  base_id: string | null;
  ein: string | null;
  status: string;
  reviewed_at: string | null;
  id: string;
  reviewer_name?: string | null;
}

const BASE: GroundTruthStatus = { state: "base" };

/**
 * Resolve one status per requested key.
 *
 * Approved outranks pending: a record that is both live-corrected and has a
 * newer proposal in flight should read as verified, because that is what
 * matching is currently using. The pending id still rides along so the UI can
 * mention it.
 */
export function resolveGroundTruthStatus(
  keys: string[], rows: StatusRow[],
): Record<string, GroundTruthStatus> {
  const out: Record<string, GroundTruthStatus> = {};
  for (const k of keys) out[k] = { ...BASE };

  for (const r of rows) {
    // A funder overlay may be keyed by base_id or by EIN depending on how it
    // was filed; match on either so a correction is never invisible.
    for (const key of [r.base_id, r.ein]) {
      if (!key || !(key in out)) continue;
      const cur = out[key];

      if (r.status === "approved") {
        // Newest approval wins if there are somehow two.
        if (cur.state !== "verified" || (r.reviewed_at ?? "") > (cur.verified_at ?? "")) {
          out[key] = {
            state: "verified",
            verified_at: r.reviewed_at,
            verified_by: r.reviewer_name ?? null,
            pending_id: cur.pending_id,
          };
        }
      } else if (r.status === "proposed" || r.status === "in_review") {
        if (cur.state === "base") out[key] = { state: "pending", pending_id: r.id };
        else if (cur.state === "verified" && !cur.pending_id) out[key] = { ...cur, pending_id: r.id };
      }
      // rejected and superseded rows say nothing about the current state.
    }
  }
  return out;
}

export const STATUS_LABEL: Record<GroundTruthState, string> = {
  base: "Base only",
  verified: "Ground Truth applied",
  pending: "Correction pending review",
};

export const STATUS_HELP: Record<GroundTruthState, string> = {
  base: "Nobody has verified this record yet. It is the June 2026 snapshot as published.",
  verified: "For Granted has verified this record. Your entry will supersede the current correction.",
  pending: "A correction for this record is already waiting in the queue. Consider editing that one instead of filing a second.",
};
