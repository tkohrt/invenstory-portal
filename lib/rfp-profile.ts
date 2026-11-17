// A client's RFP profile, read and cleaned (patch 58, 17 Nov 2026). Pure,
// tested in tests/portal/rfp-profile.test.ts. Stored in rfp_profile (0096).
//
// capabilities  what the client sells and has shipped, in plain sentences:
//               the text the fit step judges against and must quote.
// naics         6-digit NAICS codes for the candidate pull (2 to 6 digits kept,
//               so a sector prefix still works).
// keywords      phrases matched against notice titles and descriptions.

export interface RfpProfile { capabilities: string; naics: string[]; keywords: string[] }
export const EMPTY_RFP_PROFILE: RfpProfile = { capabilities: "", naics: [], keywords: [] };

export const CAPABILITIES_MAX = 6000;
const MAX_CODES = 20, MAX_KEYWORDS = 30;

/** NAICS codes from free text: any run of 2 to 6 digits, deduplicated, in order. */
export function parseNaics(raw: string | string[] | null | undefined): string[] {
  const text = Array.isArray(raw) ? raw.map(String).join(" ") : typeof raw === "string" ? raw : "";
  const out: string[] = [];
  for (const m of text.matchAll(/\b\d{2,6}\b/g)) if (!out.includes(m[0]) && out.length < MAX_CODES) out.push(m[0]);
  return out;
}

/** Keywords from free text, one per line or comma-separated; at least 3 characters each. */
export function parseKeywords(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\n,;]+/) : [];
  const out: string[] = [];
  for (const p of parts) {
    const k = String(p).replace(/\s+/g, " ").trim().slice(0, 60);
    if (k.length >= 3 && !out.some(o => o.toLowerCase() === k.toLowerCase()) && out.length < MAX_KEYWORDS) out.push(k);
  }
  return out;
}

export function cleanRfpProfile(i: { capabilities?: unknown; naics?: unknown; keywords?: unknown }): RfpProfile {
  const cap = typeof i.capabilities === "string" ? i.capabilities.replace(/\r\n?/g, "\n").trim().slice(0, CAPABILITIES_MAX) : "";
  return {
    capabilities: cap,
    naics: parseNaics(i.naics as string | string[]),
    keywords: parseKeywords(i.keywords as string | string[]),
  };
}

/** What stops a run, in words; null when the profile can run. */
export function profileProblem(p: RfpProfile): string | null {
  if (p.capabilities.length < 80) return "Add a few sentences on what the client sells and has shipped: the fit step judges every notice against them.";
  if (!p.naics.length && !p.keywords.length) return "Add at least one NAICS code or keyword, so the scan knows which notices to look at.";
  return null;
}
