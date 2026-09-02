// Reading what the Ledger actually sends back.
//
// This module exists because the same mistake has now bitten twice: we trusted
// MCP_TOOLS.md over the wire, and shipped code that silently found nothing.
// find_grants returns `eligibility_ai_extracted` where the doc says
// `eligibility`; lookup_funder returns its list under `candidates` where the
// doc implies `results`; get_funder returns a single object with a `profile`
// key and no list at all. None of those failed loudly — they returned empty.
//
// So the rules here are deliberately forgiving:
//   1. a bare array is the list
//   2. otherwise try the key names we have actually seen
//   3. otherwise take the first array-of-objects in the envelope
// Rule 3 is the one that stops the NEXT undocumented key name from costing an
// afternoon. It cannot fire on a well-formed envelope, because rule 2 gets
// there first.

import type { LedgerEnvelope } from "@/lib/ledger-types";

/** Key names the service has been observed to use for its list payload. */
const LIST_KEYS = [
  "results", "candidates", "funders", "grants",
  "opportunities", "matches", "items",
] as const;

/** Envelope keys that are metadata, never the list. */
const META_KEYS = new Set(["as_of", "verify", "note", "suggestions", "query", "total", "count"]);

/**
 * Keys that mark a payload as ONE record rather than a list of them. get_funder
 * answers with { profile, officers_public_990, grant_history }, and the loose
 * fallback below would happily hand back the officers as if they were search
 * results. A single-record payload has no list, and saying so is the honest
 * answer; callers read it through `raw`.
 */
const SINGLE_RECORD_KEYS = ["profile"] as const;

function isObjectList(v: unknown): boolean {
  return Array.isArray(v) && (v.length === 0 || typeof v[0] === "object");
}

export function unwrapLedgerList<T>(data: unknown): LedgerEnvelope<T> {
  if (Array.isArray(data)) return { results: data as T[], raw: data };

  const env = (data ?? {}) as Record<string, unknown>;

  let list: unknown;
  for (const k of LIST_KEYS) {
    if (isObjectList(env[k])) { list = env[k]; break; }
  }
  const isSingleRecord = SINGLE_RECORD_KEYS.some(
    k => typeof env[k] === "object" && env[k] !== null && !Array.isArray(env[k]),
  );
  if (list === undefined && !isSingleRecord) {
    for (const [k, v] of Object.entries(env)) {
      if (!META_KEYS.has(k) && isObjectList(v) && (v as unknown[]).length) { list = v; break; }
    }
  }

  return {
    results: Array.isArray(list) ? (list as T[]) : [],
    as_of: typeof env.as_of === "string" ? env.as_of : undefined,
    verify: typeof env.verify === "string" ? env.verify : undefined,
    note: typeof env.note === "string" ? env.note : undefined,
    suggestions: Array.isArray(env.suggestions) ? (env.suggestions as string[]) : undefined,
    raw: data,
  };
}

export interface FunderProfileFields {
  ein: string;
  name?: string; website?: string; location?: string;
  focus?: string; typical_grant_range?: string; mission?: string;
}

function usd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/**
 * get_funder returns { profile, officers_public_990, grant_history, ... } —
 * one object, no list — so it must be read from the raw payload rather than
 * from a results array. It also has no `typical_grant_range`; the range lives
 * in the profile as grant_size_minimum / grant_size_maximum, which is a
 * lifetime observed span from 990 data, not a published guideline. We format
 * it as a range and let the reviewer correct it, which is the whole point of
 * Ground Truth.
 */
export function funderProfileFromPayload(ein: string, data: unknown): FunderProfileFields {
  const top = (data ?? {}) as Record<string, unknown>;
  const p = (typeof top.profile === "object" && top.profile !== null
    ? top.profile
    : top) as Record<string, unknown>;

  const str = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : undefined);
  const num = (k: string) => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : undefined);

  const city = str("city"); const state = str("state_code");
  const lo = num("grant_size_minimum"); const hi = num("grant_size_maximum");
  let range: string | undefined;
  if (hi !== undefined && hi > 0) range = lo ? `${usd(lo)} – ${usd(hi)}` : `Up to ${usd(hi)}`;
  else if (lo) range = `From ${usd(lo)}`;

  return {
    ein: str("ein") ?? ein,
    name: str("organization_name") ?? str("name"),
    website: str("website"),
    location: [city, state].filter(Boolean).join(", ") || str("location"),
    focus: str("ntee_description") ?? str("focus"),
    typical_grant_range: str("typical_grant_range") ?? range,
    mission: str("mission"),
  };
}
