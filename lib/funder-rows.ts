// Turning merged funder cards into rows worth storing.
//
// Two lists arrive from a run and they answer different questions:
//   funders   — semantic search: who works on this kind of thing?
//   evidence  — the who-funds-whom graph: who already writes cheques to
//               organizations like this one?
// The second is the differentiator and must never be diluted into the first. A
// funder appearing in both is one row that carries the graph evidence, not two
// rows that look like two findings.
//
// Pure and free of `server-only` so it is unit testable.
import type { FunderCard } from "@/lib/ledger-types";
import { normalizeEin } from "@/lib/ein";
import { resolveAccess, type AccessMode } from "@/lib/access-mode";

export interface FunderRow {
  /** When this funder first appeared for this client, preserved across runs. */
  first_matched_at?: string | null;
  matched_at?: string | null;
  funder_id: string;
  ein: string | null;
  name: string;
  website: string | null;
  location: string | null;
  focus: string | null;
  mission: string | null;
  typical_grant_range: string | null;
  match_reason: string | null;
  confidence: string | null;
  caveat: string | null;
  evidence: { name: string; total_usd?: number; latest_year?: string }[];
  evidence_count: number;
  /** The graph shows this funder already granting to organizations like this
   *  one. Only true when there is actual evidence to show for it. */
  from_graph: boolean;
  /** A For Granted record rather than a match against this client. Nothing has
   *  assessed it against this organization, and the page must not pretend. */
  from_overlay: boolean;
  /** How this funder takes requests, and whether anybody actually checked. */
  access_mode: AccessMode;
  access_note: string | null;
  access_verified: boolean;
  /**
   * Does the source record show this organization granting money to anyone?
   *
   * null means the field was absent, which is NOT the same as false. A funder
   * For Granted added by hand carries no such flag and must never be screened
   * out on it.
   */
  has_grant_history: boolean | null;
  verified_at: string | null;
}

/** A card as it leaves mergeOverlay: the Ledger's fields plus our stamp. */
type MergedFunder = FunderCard & {
  id?: string;
  _overlay?: { reviewed_at: string | null } | null;
};

export const OVERLAY_ID_MARK = "overlay:";

/**
 * The identity a funder row is stored under.
 *
 * It has to equal the id mergeOverlay matches corrections against, or a
 * verification recorded through the picker reaches this record on screen but
 * not in the data. That means the EIN when there is one — it is what
 * FunderPicker writes into base_id.
 *
 * Records the overlay itself added already carry a namespaced id, which is
 * stable across runs; keep it. Everything else falls back to a slug of the
 * name: not correctable (nothing can attach to it), but stable enough that a
 * re-run updates the row rather than accumulating duplicates.
 */
export function funderId(f: MergedFunder, index = 0): string {
  // Digits only. "34-0714588" and "340714588" are one funder, and treating them
  // as two produced a duplicate row — one badged "already funds peers", the
  // other "focus aligns" — that no re-run ever collapsed. It also broke the
  // correction path: mergeOverlay compares base_id to this id as raw strings.
  const ein = normalizeEin(f.ein);
  if (ein) return ein;
  if (f.id?.startsWith(OVERLAY_ID_MARK)) return f.id;
  const slug = (f.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  // A nameless, EIN-less card still gets its own row. Sharing one literal id
  // collapsed every such card into a single "Unnamed funder".
  return slug ? `name:${slug}` : `anonymous:${index}`;
}

/**
 * The service's wire shape has disagreed with its documentation twice now
 * (eligibility_ai_extracted, candidates), each time costing a run. So the
 * evidence list is coerced rather than trusted: a non-array would make the
 * upsert throw mid-run, after the grant half had already been written.
 * Entries without a name are dropped — they render as ", , and 2 more".
 */
function grantees(v: unknown): { name: string; total_usd?: number; latest_year?: string }[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is { name: string } =>
    !!e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string"
    && !!(e as { name: string }).name.trim());
}

function row(f: MergedFunder, fromGraph: boolean, index = 0): FunderRow {
  const evidence = grantees(f.evidence_grantees);
  // A recorded Ground Truth value wins; otherwise infer from the caveat or the
  // funder type, marked as a guess; otherwise unknown, which is the honest
  // answer for most funders until somebody looks.
  const access = resolveAccess(f);
  return {
    funder_id: funderId(f, index),
    ein: normalizeEin(f.ein) || null,
    name: f.name || "Unnamed funder",
    website: f.website ?? null,
    location: f.location ?? null,
    focus: f.focus ?? null,
    mission: f.mission ?? null,
    typical_grant_range: f.typical_grant_range ?? null,
    match_reason: f.match_reason ?? null,
    confidence: f.confidence ?? null,
    // Relayed verbatim. The tool's own instructions say a caveat must not be
    // softened into "an approachable foundation", and a pass-through vehicle
    // wastes a client's time in a specific, avoidable way.
    caveat: f.caveat ?? null,
    evidence,
    evidence_count: evidence.length,
    // "Already funds peers" is the strongest claim on the page, so it is made
    // by the evidence itself and not by which list a card arrived in. The graph
    // tool can return a card with no grantees, which rendered as a row asserting
    // a giving history in one column and denying it two columns later.
    from_graph: fromGraph && evidence.length > 0,
    from_overlay: !!f.id?.startsWith(OVERLAY_ID_MARK),
    access_mode: access.mode,
    access_note: access.note,
    access_verified: access.verified,
    has_grant_history: typeof f.has_grant_history === "boolean" ? f.has_grant_history : null,
    // Freshness in For Granted's terms: when a person confirmed this, not when
    // the source dataset was snapshotted.
    verified_at: f._overlay?.reviewed_at ?? null,
  };
}

/**
 * Merge the two lists into one set of rows, graph evidence winning.
 *
 * Order matters for the reader: funders the graph already backs come first,
 * because "they fund three organizations like yours" is a stronger reason to
 * spend an afternoon than "their mission text is similar to yours".
 */
export function funderRowsFrom(funders: FunderCard[], evidence: FunderCard[]): FunderRow[] {
  const byId = new Map<string, FunderRow>();

  (evidence as MergedFunder[]).forEach((f, i) => {
    const r = row(f, true, i);
    const prev = byId.get(r.funder_id);
    // Two graph rows for one funder: keep whichever actually carries grantees.
    if (!prev || (!prev.evidence.length && r.evidence.length)) byId.set(r.funder_id, r);
  });

  (funders as MergedFunder[]).forEach((f, i) => {
    const r = row(f, false, evidence.length + i);
    const prev = byId.get(r.funder_id);
    if (!prev) { byId.set(r.funder_id, r); return; }
    // Already known from the graph. This is a GAP FILL, field by field: the
    // search record often carries the richer profile, but spreading it over the
    // graph record replaced everything, including nulls. That silently dropped
    // caveats — and a caveat is the one field that must never be lost, because
    // it is what stops a client being pointed at a donor-advised fund that
    // takes no unsolicited proposals.
    byId.set(r.funder_id, {
      ...prev,
      name: prev.name && prev.name !== "Unnamed funder" ? prev.name : r.name,
      website: prev.website ?? r.website,
      location: prev.location ?? r.location,
      focus: prev.focus ?? r.focus,
      mission: prev.mission ?? r.mission,
      typical_grant_range: prev.typical_grant_range ?? r.typical_grant_range,
      match_reason: prev.match_reason ?? r.match_reason,
      confidence: prev.confidence ?? r.confidence,
      caveat: prev.caveat ?? r.caveat,
      verified_at: prev.verified_at ?? r.verified_at,
      // A checked answer outranks a guess, whichever list it arrived in.
      ...(prev.access_verified || !r.access_verified
        ? { access_mode: prev.access_mode !== "unknown" ? prev.access_mode : r.access_mode,
            access_note: prev.access_note ?? r.access_note,
            access_verified: prev.access_verified }
        : { access_mode: r.access_mode, access_note: r.access_note, access_verified: true }),
      evidence: prev.evidence.length ? prev.evidence : r.evidence,
      evidence_count: prev.evidence.length ? prev.evidence_count : r.evidence_count,
      from_graph: prev.from_graph || r.from_graph,
      // A yes from either list wins, and an absent flag never overrides a
      // recorded one. Two lists disagreeing about whether a funder grants is
      // a reason to keep it, not to hide it.
      has_grant_history: prev.has_grant_history === true || r.has_grant_history === true
        ? true
        : prev.has_grant_history ?? r.has_grant_history,
      from_overlay: prev.from_overlay || r.from_overlay,
    });
  });

  return [...byId.values()].sort((a, b) =>
    Number(b.from_graph) - Number(a.from_graph) ||
    b.evidence_count - a.evidence_count ||
    a.name.localeCompare(b.name));
}
