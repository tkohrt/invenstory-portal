// 990 phase two (patch 45): the Part XV parser and the derived intelligence.
// Pure, no dependencies, tested in tests/funding/irs990-grants.test.ts against
// fixture XML. The parser is deliberately a targeted extractor, not a full XML
// reader: it looks for the grant groups the 990-PF schema has carried since
// TY2016 (with the older vintage's names as aliases) and ignores everything
// else, because filings in the wild are long and occasionally malformed.

export interface FilingGrant {
  recipient: string;
  recipient_norm: string;
  amount: number | null;
  purpose: string | null;
  recipient_state: string | null;
}

/** What the year-over-year rate compares: case, punctuation, whitespace and
    the trailing corporate dress removed, so "The Example Fund, Inc." and
    "EXAMPLE FUND INC" are one grantee. */
export function recipientNorm(name: string): string {
  return name.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'"()]/g, " ")
    .replace(/\b(incorporated|inc|llc|ltd|corp|corporation|co|foundation|fdn|the)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

const GROUP_RE = /<(?:GrantOrContributionPdDurYrGrp|GrantOrContriPaidDurYear)>([\s\S]*?)<\/(?:GrantOrContributionPdDurYrGrp|GrantOrContriPaidDurYear)>/g;

function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}>([^<]+)</${n}>`));
    if (m) {
      const v = m[1].replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
      if (v) return v;
    }
  }
  return null;
}

/** Every grant paid in a 990-PF filing's Part XV. Empty when none parse. */
export function parse990PFGrants(xml: string): FilingGrant[] {
  const out: FilingGrant[] = [];
  for (const m of xml.matchAll(GROUP_RE)) {
    const block = m[1];
    const recipient = tag(block, ["BusinessNameLine1Txt", "BusinessNameLine1", "RecipientPersonNm", "RecipientPersonName"]);
    if (!recipient) continue;
    const amtRaw = tag(block, ["Amt", "Amount"]);
    const amt = amtRaw ? Number(amtRaw.replace(/[^\d.-]/g, "")) : NaN;
    out.push({
      recipient: recipient.slice(0, 300),
      recipient_norm: recipientNorm(recipient).slice(0, 300),
      amount: Number.isFinite(amt) && amt > 0 ? Math.round(amt) : null,
      purpose: tag(block, ["GrantOrContributionPurposeTxt", "PurposeOfGrantOrContribution"])?.slice(0, 500) ?? null,
      recipient_state: tag(block, ["StateAbbreviationCd", "State"])?.slice(0, 2)?.toUpperCase() ?? null,
    });
  }
  return out;
}

export interface GrantStats {
  year: number;
  grants_count: number;
  grants_total_usd: number | null;
  typical_grant_usd: number | null;   // the median
  /** Of this year's distinct grantees, the share absent from the prior year's
      list. Null without a prior year to compare against. */
  new_grantee_rate: number | null;
  prior_year: number | null;
}

export function grantStats(year: number, grants: FilingGrant[], prior: { year: number; grants: FilingGrant[] } | null): GrantStats {
  const amounts = grants.map(g => g.amount).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const total = amounts.length ? amounts.reduce((a, b) => a + b, 0) : null;
  const median = amounts.length ? amounts[Math.floor(amounts.length / 2)] : null;
  let rate: number | null = null;
  let priorYear: number | null = null;
  if (prior && prior.grants.length) {
    const before = new Set(prior.grants.map(g => g.recipient_norm));
    const current = [...new Set(grants.map(g => g.recipient_norm))].filter(Boolean);
    if (current.length) {
      rate = Math.round((current.filter(n => !before.has(n)).length / current.length) * 100);
      priorYear = prior.year;
    }
  }
  return { year, grants_count: grants.length, grants_total_usd: total, typical_grant_usd: median, new_grantee_rate: rate, prior_year: priorYear };
}

/** The one-line reading of the rate, honest about what it can and cannot say. */
export function rateSentence(s: GrantStats): string | null {
  if (s.new_grantee_rate === null || s.prior_year === null) return null;
  const r = s.new_grantee_rate;
  const read = r >= 50 ? "genuinely open to new names"
    : r >= 25 ? "open to new names, with a stable core"
    : r >= 10 ? "mostly repeat grantees; a way in exists but is narrow"
    : "almost entirely repeat grantees; this is a relationship play, not an application";
  return `${r}% of ${s.year} grantees were new names versus ${s.prior_year}: ${read}.`;
}
