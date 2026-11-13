// Curated list sweeps (P2.5, patch 39). Pure rules: how a pasted list is
// turned into leads for the review queue, and how an approved entry is
// screened for a tenant. Tested in tests/funding/curated.test.ts.
import { urlKey, noLinks, type RawLead, type Lead } from "@/lib/web-discovery";
import type { GrantCard } from "@/lib/ledger-types";
import type { FundingKind } from "@/lib/eligibility-fields";

export const CURATED_PARSE_SYSTEM = `You turn a pasted list of funding opportunities into structured entries.
Answer with ONLY a JSON object: {"leads":[{"kind":"opportunity"|"funder","money_kind":"grants"|"contracts"|"programs","title":...,"funder":...,"url":...,"deadline":"YYYY-MM-DD or null","amount":...,"geography":...,"eligibility":...,"why":null,"quote":null}]}.
Rules: one entry per opportunity in the text, nothing invented. A field the text does not state is null. The url must appear in the text; an entry with no url is still kept (url null). Dates become YYYY-MM-DD when the text makes the date certain, else null. Keep titles under 20 words.`;

export function curatedParseUser(pasted: string, today: string): string {
  return `Today is ${today}. The pasted list:\n\n${pasted}`;
}

/**
 * Like web-discovery's groundLeads, but for an admin-pasted list: there are no
 * search results to ground against, so every entry is marked "site" (the
 * queue's check-the-link confidence) and entries may arrive with no URL at
 * all, carried on a key of their own title. Review still gates everything.
 */
export function curatedLeads(raw: RawLead[], today: string): Lead[] {
  const out: Lead[] = [];
  const seen = new Set<string>();
  const str = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;
  const KINDS = ["grants", "contracts", "programs"];
  for (const r of raw) {
    const title = str(r.title, 300);
    if (!title) continue;
    const url = str(r.url, 1000);
    const key = url ? urlKey(url) : `curated:${title.toLowerCase()}`;
    if (!key || seen.has(key)) continue;
    const d = str(r.deadline, 20);
    const rolling = !!d && /rolling|ongoing|open/i.test(d);
    const deadline = d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime()) ? d : null;
    if (deadline && deadline < today) continue;
    seen.add(key);
    out.push({
      kind: r.kind === "funder" ? "funder" : "opportunity",
      money_kind: (typeof r.money_kind === "string" && KINDS.includes(r.money_kind) ? r.money_kind : "grants") as FundingKind,
      title, funder: str(r.funder, 200), url: url ?? "", url_key: key,
      deadline, rolling, amount: noLinks(str(r.amount, 120)), geography: noLinks(str(r.geography, 200)),
      eligibility: noLinks(str(r.eligibility, 600)), why: null, quote: null,
      grounded: "site",
    });
  }
  return out;
}

/** An approved curated entry's fields, as the screen's GrantCard. */
export function curatedCard(fields: Record<string, unknown>): GrantCard {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    title: s(fields.title), agency: s(fields.agency),
    opportunity_number: s(fields.opportunity_number),
    eligibility: s(fields.eligibility), close_date: s(fields.close_date),
    max_award: n(fields.max_award), website: s(fields.website),
    money_kind: s(fields.money_kind), source: "curated",
  };
}

/** What a matched client sees for one entry. */
export interface CuratedMatchRow {
  overlay_id: string; list_id: string; list_name: string;
  context_note: string | null; swept_at: string; verdict: string;
  title: string; funder: string | null; close_date: string | null;
  max_award: number | null; website: string | null; notes: string | null;
}
