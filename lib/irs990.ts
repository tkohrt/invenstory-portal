// The 990 importer (patch 42): pure mapping from ProPublica's Nonprofit
// Explorer API (IRS e-file data) to the portal's shapes. Tested in
// tests/funding/irs990.test.ts. Honesty rules live here: every figure keeps
// its filing year, a 990-N filer is named as one, and nothing is invented.
import { BUDGET_BANDS } from "@/lib/eligibility-fields";

export function cleanEin(s: string): string | null {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length === 9 ? d : null;
}

export interface Filing990 {
  year: number;
  form: string;             // "990" | "990-EZ" | "990-PF"
  revenue: number | null;
  expenses: number | null;
  assets: number | null;
  /** Grants paid (990-PF), when the filing data carries it. */
  grants_paid: number | null;
  pdf_url: string | null;
}

export interface Org990 {
  name: string;
  ntee: string | null;
  filings: Filing990[];         // with data, newest first
  postcard_only: boolean;       // only 990-N e-postcards on file
  source_url: string;           // the ProPublica organization page
}

const FORM: Record<number, string> = { 0: "990", 1: "990-EZ", 2: "990-PF" };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v !== 0 ? Math.round(v) : null;
}

/** Tolerant mapping of the API's organization response. Null when unusable. */
export function parseProPublica(json: unknown, ein: string): Org990 | null {
  const j = json as { organization?: Record<string, unknown>; filings_with_data?: Record<string, unknown>[]; filings_without_data?: Record<string, unknown>[] } | null;
  const org = j?.organization;
  if (!org || typeof org.name !== "string") return null;
  const withData = Array.isArray(j?.filings_with_data) ? j.filings_with_data : [];
  const filings: Filing990[] = withData.map(f => ({
    year: typeof f.tax_prd_yr === "number" ? f.tax_prd_yr : 0,
    form: FORM[f.formtype as number] ?? "990",
    revenue: num(f.totrevenue),
    expenses: num(f.totfuncexpns),
    assets: num(f.totassetsend),
    // 990-PF grant totals appear under different keys across vintages; take
    // the first recognizable one and otherwise say nothing.
    grants_paid: num(f.grntspayableend) ?? num(f.totgrntspaid) ?? num(f.grntsandsimlramtspaid) ?? null,
    pdf_url: typeof f.pdf_url === "string" && f.pdf_url ? f.pdf_url : null,
  })).filter(f => f.year > 1990).sort((a, b) => b.year - a.year);
  const postcards = Array.isArray(j?.filings_without_data) ? j.filings_without_data.length : 0;
  return {
    name: org.name,
    ntee: typeof org.ntee_code === "string" && org.ntee_code ? org.ntee_code : null,
    filings,
    postcard_only: filings.length === 0 && postcards > 0,
    source_url: `https://projects.propublica.org/nonprofits/organizations/${ein}`,
  };
}

/** The shared-funder-profile fields a filing supports. Absent stays absent. */
export function funderProfileFrom(org: Org990): Record<string, unknown> {
  const f = org.filings[0];
  if (!f) return {};
  const out: Record<string, unknown> = { fy_year: f.year };
  if (f.assets !== null) out.assets_usd = f.assets;
  if (f.grants_paid !== null) out.annual_giving_usd = f.grants_paid;
  return out;
}

const USD = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The Layer I summary document's text: last three filings, labeled, linked. */
export function summaryDocText(org: Org990, ein: string): string {
  const lines: string[] = [
    `IRS filings summary: ${org.name}`,
    `EIN ${ein.slice(0, 2)}-${ein.slice(2)}. Public filings via ProPublica Nonprofit Explorer (IRS e-file data): ${org.source_url}`,
    org.ntee ? `NTEE code: ${org.ntee}` : "",
    "",
  ];
  if (org.postcard_only) {
    lines.push("This organization files the IRS 990-N e-postcard, which carries no public financials. That is normal for organizations under $50,000 in annual receipts.");
  }
  for (const f of org.filings.slice(0, 3)) {
    const parts = [
      f.revenue !== null ? `revenue ${USD(f.revenue)}` : null,
      f.expenses !== null ? `expenses ${USD(f.expenses)}` : null,
      f.assets !== null ? `assets ${USD(f.assets)}` : null,
      f.grants_paid !== null ? `grants paid ${USD(f.grants_paid)}` : null,
    ].filter(Boolean).join(", ");
    lines.push(`Form ${f.form}, filing year ${f.year}: ${parts || "figures not in the e-file data"}.${f.pdf_url ? ` Filing: ${f.pdf_url}` : ""}`);
  }
  lines.push("", "Figures come from the organization's own IRS filings and carry their filing year; they are not the current budget.");
  return lines.filter(l => l !== null).join("\n");
}

/** The confirm-first budget-band suggestion from the latest filed revenue. */
export function budgetBandFrom(revenue: number): { band: string; label: string } | null {
  const v = revenue < 100_000 ? "lt_100k"
    : revenue < 500_000 ? "100k_500k"
    : revenue < 1_000_000 ? "500k_1m"
    : revenue < 5_000_000 ? "1m_5m"
    : revenue < 10_000_000 ? "5m_10m" : "gt_10m";
  const band = BUDGET_BANDS.find(b => b.v === v);
  return band ? { band: band.v, label: band.l } : null;
}
