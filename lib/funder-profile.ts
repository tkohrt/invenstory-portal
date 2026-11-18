// The shared funder profile (patch 41): the field dictionary and the merge
// rule. Pure; tested in tests/funding/funder-profile.test.ts.
//
// The dictionary exists so data has somewhere to land BEFORE it shows up:
// every feed point (Ground Truth approval, the verification form, web
// discovery, curated lists, the coming 990 importer) fills these same keys,
// and the dossier renders whatever is filled with that field's own provenance.

export type ProfileFieldKind = "text" | "long" | "usd" | "year" | "pct" | "num" | "url" | "stamp";

export interface ProfileFieldDef {
  key: string; label: string; kind: ProfileFieldKind; hint?: string;
  /** Patch 63: "links" render as the dossier's own row of links; "meta" never renders. Absent: an ordinary fact. */
  group?: "links" | "meta";
}

export const PROFILE_FIELDS: ProfileFieldDef[] = [
  { key: "giving_cycle", label: "Giving cycle", kind: "text", hint: "e.g. LOIs each January; board meets quarterly; rolling" },
  { key: "programs", label: "Named programs", kind: "long", hint: "the funder's own program names, comma-separated" },
  { key: "geography", label: "Where they give", kind: "long", hint: "the geographic footprint of their giving" },
  { key: "application_process", label: "Application process", kind: "long", hint: "the steps, in the funder's own terms (LOI first, invite after review…)" },
  { key: "assets_usd", label: "Total assets", kind: "usd" },
  { key: "annual_giving_usd", label: "Annual giving", kind: "usd" },
  { key: "fy_year", label: "Most recent filing year", kind: "year" },
  // 990 phase two (patch 45): derived from the filing's own grant list.
  { key: "new_grantee_rate", label: "New-grantee rate", kind: "pct", hint: "share of the latest filing's grantees that were new names vs the year before" },
  { key: "typical_grant_usd", label: "Typical grant", kind: "usd", hint: "the median grant paid in the latest filing" },
  { key: "grants_count", label: "Grants paid (latest filing)", kind: "num" },
  // The funder's own channels (patch 63): read from its own website. See lib/funder-links.ts.
  { key: "linkedin_url", label: "LinkedIn", kind: "url", group: "links" },
  { key: "x_url", label: "X", kind: "url", group: "links" },
  { key: "bluesky_url", label: "Bluesky", kind: "url", group: "links" },
  { key: "facebook_url", label: "Facebook", kind: "url", group: "links" },
  { key: "instagram_url", label: "Instagram", kind: "url", group: "links" },
  { key: "youtube_url", label: "YouTube", kind: "url", group: "links" },
  { key: "newsletter_url", label: "Newsletter sign-up", kind: "url", group: "links" },
  { key: "rss_url", label: "News feed (RSS)", kind: "url", group: "links" },
  // When the funder's site was last read for its links, found or not, so the dossier does not re-read it on every visit.
  { key: "links_checked_at", label: "Links last checked", kind: "stamp", group: "meta" },
];

/** The ordinary facts the dossier lists one per row (everything but the links row and bookkeeping). */
export const FACT_FIELDS = PROFILE_FIELDS.filter(f => !f.group);

export const PROFILE_KEYS = PROFILE_FIELDS.map(f => f.key);

/** How a field arrived; shown beside it on the dossier. */
export interface FieldProvenance { how: "verification" | "web_discovery" | "curated_list" | "manual" | "import_990" | "funder_site"; source_url: string | null; at: string }

export type ProfileFields = Record<string, unknown>;
export type ProfileMeta = Record<string, FieldProvenance>;

const HOW_LABEL: Record<FieldProvenance["how"], string> = {
  verification: "Confirmed by For Granted",
  web_discovery: "Found by the web search, reviewed by For Granted",
  curated_list: "From a curated list, reviewed by For Granted",
  manual: "Recorded by For Granted",
  import_990: "From the funder's own IRS filing",
  funder_site: "From the funder's own website",
};

export function provenanceLine(p: FieldProvenance): string {
  const day = new Date(p.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${HOW_LABEL[p.how]} · ${day}`;
}

function cleanValue(def: ProfileFieldDef, v: unknown): unknown {
  if (def.kind === "pct") {
    const n = typeof v === "number" ? v : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : undefined;
  }
  if (def.kind === "num") {
    const n = typeof v === "number" ? v : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  }
  if (def.kind === "usd" || def.kind === "year") {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
    if (!Number.isFinite(n) || n <= 0) return undefined;
    if (def.kind === "year" && (n < 1990 || n > 2100)) return undefined;
    return Math.round(n);
  }
  if (def.kind === "url") {
    if (typeof v !== "string") return undefined;
    try {
      const u = new URL(v.trim());
      return (u.protocol === "https:" || u.protocol === "http:") && u.href.length <= 300 ? u.href : undefined;
    } catch { return undefined; }
  }
  if (def.kind === "stamp") {
    return typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined;
  }
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, def.kind === "long" ? 1500 : 300) : undefined;
}

/**
 * The merge rule, the same at every feed point: a field the source stated
 * replaces what was there (newer knowledge wins, with its provenance); a field
 * the source did not state is left exactly alone. Nothing here can blank a
 * fact.
 */
export function mergeProfile(
  fields: ProfileFields, meta: ProfileMeta,
  incoming: Record<string, unknown>, prov: FieldProvenance,
): { fields: ProfileFields; meta: ProfileMeta; changed: string[] } {
  const outF = { ...fields };
  const outM = { ...meta };
  const changed: string[] = [];
  for (const def of PROFILE_FIELDS) {
    if (!(def.key in incoming)) continue;
    const v = cleanValue(def, incoming[def.key]);
    if (v === undefined) continue;
    if (outF[def.key] === v) continue;
    outF[def.key] = v;
    outM[def.key] = prov;
    changed.push(def.key);
  }
  return { fields: outF, meta: outM, changed };
}

/** The key a funder's shared profile lives under. */
export function profileKey(ein: string | null | undefined, funderId: string): string {
  const digits = (ein ?? "").replace(/\D/g, "");
  return digits || funderId;
}
