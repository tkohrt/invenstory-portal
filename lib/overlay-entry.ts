// Turning a filled-in verification form into an overlay row.
//
// Pure and free of `server-only` so it can be tested without a database. The
// rule that matters: a blank field means "leave the base record alone", never
// "overwrite it with empty". Getting that backwards would let a half-filled
// form silently erase good data for every client.
import type { OverlayManualEntry } from "@/lib/types";

export interface BuiltEntry {
  fields: Record<string, unknown>;
  title: string;
  ein: string | null;
  opportunity_number: string | null;
  base_id: string | null;
}

export function buildOverlayEntry(e: OverlayManualEntry): BuiltEntry {
  const fields: Record<string, unknown> = {};
  const put = (k: string, v: string | undefined) => {
    const t = (v ?? "").trim();
    if (t) fields[k] = t;
  };
  put("name", e.name); put("website", e.website); put("location", e.location);
  put("focus", e.focus); put("typical_grant_range", e.typical_grant_range);
  put("agency", e.agency); put("eligibility", e.eligibility);
  put("caveat", e.caveat); put("notes", e.notes);

  if (e.close_date?.trim()) {
    const d = new Date(e.close_date);
    if (isNaN(d.getTime())) throw new Error("Close date must be a real date (YYYY-MM-DD).");
    fields.close_date = e.close_date.trim();
  }

  for (const k of ["min_award", "max_award"] as const) {
    const raw = (e[k] ?? "").replace(/[$,\s]/g, "");
    if (raw) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${k.replace("_", " ")} must be a number.`);
      fields[k] = Math.round(n);
    }
  }

  const title = (e.title || e.name || e.opportunity_number || "").trim();
  if (!title) throw new Error("Give it a title so it's recognisable in the queue.");
  if (!Object.keys(fields).length) throw new Error("Fill in at least one field, or there's nothing to record.");

  return {
    fields, title,
    ein: e.ein?.replace(/\D/g, "") || null,
    opportunity_number: e.opportunity_number?.trim() || null,
    base_id: e.base_id?.trim() || null,
  };
}
