import "server-only";
// 990 phase two (patch 45): fetch a foundation's filing XML, parse Part XV,
// store the grants, derive the intelligence. Per funder, on demand — the
// corpus grows as fast as For Granted's actual funder universe and no faster.
// No model calls anywhere; a filing is parsed, never interpreted.
import { db } from "./db";
import { fetch990 } from "./irs990";
import { parse990PFGrants, grantStats, rateSentence, type FilingGrant, type GrantStats } from "@/lib/irs990-grants";
import { applyProfileFields } from "./funder-profile";

const MAX_STORED_PER_YEAR = 2000;

/** The filing's full XML via ProPublica's object-id download, or null. The
    endpoint has been stable for years but is not a contract; every failure
    here is soft and the UI says what it could not get. */
async function fetchFilingXml(objectId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://projects.propublica.org/nonprofits/download-xml?object_id=${encodeURIComponent(objectId)}`, {
      headers: { accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.includes("<Return") ? text : null;
  } catch { return null; }
}

export interface IngestResult {
  ok: true;
  years: number[];
  stats: GrantStats;
  sentence: string | null;
  changed: string[];
}

export async function ingestFunderGrants(funderId: string, einRaw: string):
  Promise<IngestResult | { ok: false; status: "none" | "error"; error: string }> {
  const ein = einRaw.replace(/\D/g, "");
  if (ein.length !== 9) return { ok: false, status: "error", error: "That EIN does not look right (nine digits)." };

  const r = await fetch990(ein);
  if (r.status === "none") return { ok: false, status: "none", error: "No IRS e-filings on record for that EIN." };
  if (r.status === "error") return { ok: false, status: "error", error: "The filings service could not be reached. Try again in a minute." };

  // The two most recent 990-PF filings with XML on record: the latest carries
  // the list, the one before it is what the new-grantee rate compares against.
  const pfs = r.org.filings.filter(f => f.form === "990-PF" && f.object_id).slice(0, 2);
  if (!pfs.length) {
    return { ok: false, status: "none", error: r.org.postcard_only
      ? "This organization files the 990-N e-postcard; there is no grant list to read."
      : "No 990-PF filings with retrievable XML on record. This funder may be a public charity, whose grant lists the standard 990 carries less consistently." };
  }

  const byYear: { year: number; grants: FilingGrant[] }[] = [];
  for (const f of pfs) {
    const xml = await fetchFilingXml(f.object_id!);
    if (!xml) continue;
    const grants = parse990PFGrants(xml).slice(0, MAX_STORED_PER_YEAR);
    if (!grants.length) continue;
    byYear.push({ year: f.year, grants });
    // Idempotent: each pull replaces that funder-year wholesale.
    // tenant-safe: funder_grant is For Granted's shared, admin-only corpus of public filings (no tenant_id).
    await db.from("funder_grant").delete().eq("ein", ein).eq("tax_year", f.year);
    // tenant-safe: shared admin-only corpus, as above.
    const { error } = await db.from("funder_grant").insert(grants.map(x => ({
      ein, tax_year: f.year, recipient: x.recipient, recipient_norm: x.recipient_norm,
      amount: x.amount, purpose: x.purpose, recipient_state: x.recipient_state,
    })));
    if (error) console.error("[990-grants] store failed", error.message);
  }
  if (!byYear.length) {
    return { ok: false, status: "error", error: "The filings exist but their XML could not be retrieved or held no readable grant list. Logged; the summary numbers still work." };
  }

  byYear.sort((a, b) => b.year - a.year);
  const stats = grantStats(byYear[0].year, byYear[0].grants, byYear[1] ?? null);

  // The derived intelligence onto the shared profile, provenance import_990.
  // grants_total is the truer annual_giving figure (summed from the list).
  const incoming: Record<string, unknown> = {
    fy_year: stats.year, grants_count: stats.grants_count,
  };
  if (stats.grants_total_usd !== null) incoming.annual_giving_usd = stats.grants_total_usd;
  if (stats.typical_grant_usd !== null) incoming.typical_grant_usd = stats.typical_grant_usd;
  if (stats.new_grantee_rate !== null) incoming.new_grantee_rate = stats.new_grantee_rate;
  const changed = await applyProfileFields({
    ein, funderId, incoming,
    prov: { how: "import_990", source_url: r.org.source_url, at: new Date().toISOString() },
  });

  return { ok: true, years: byYear.map(y => y.year), stats, sentence: rateSentence(stats), changed };
}

/** The latest ingested year's grants for a dossier, biggest first. */
export async function getFunderGrants(einRaw: string | null | undefined): Promise<{ year: number; total: number; top: { recipient: string; amount: number | null; purpose: string | null; recipient_state: string | null }[] } | null> {
  const ein = (einRaw ?? "").replace(/\D/g, "");
  if (!ein) return null;
  // tenant-safe: shared admin-only corpus of public filings, read by EIN.
  const { data: yr } = await db.from("funder_grant").select("tax_year").eq("ein", ein)
    .order("tax_year", { ascending: false }).limit(1).maybeSingle();
  const year = (yr as { tax_year: number } | null)?.tax_year;
  if (!year) return null;
  // tenant-safe: shared admin-only corpus, as above.
  const [{ count }, { data }] = await Promise.all([
    db.from("funder_grant").select("id", { count: "exact", head: true }).eq("ein", ein).eq("tax_year", year),
    db.from("funder_grant").select("recipient, amount, purpose, recipient_state")
      .eq("ein", ein).eq("tax_year", year).order("amount", { ascending: false, nullsFirst: false }).limit(8),
  ]);
  return {
    year, total: count ?? 0,
    top: (data ?? []) as { recipient: string; amount: number | null; purpose: string | null; recipient_state: string | null }[],
  };
}
