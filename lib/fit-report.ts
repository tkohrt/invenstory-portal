// The fit report (patch 6 of the 1 November 2026 build).
//
// One clean page a client or For Granted can read top to bottom: every lead the
// search kept, from every source, each with the same four questions answered
// the same way. Can they apply? Does it fit the mission? Is the money the right
// size? How do they get in? Then one next step. Grouped by what to do, not by
// where it came from, and with no cap: Tyler's top ten is a reading of this
// list, not a limit on it.
//
// Pure and free of `server-only`: built from rows the page already loads, and
// tested. Nothing here calls a model; every call is worked out from what the
// screen, the explanation and Ground Truth already said, and says so.
import type { EligibilityProfile } from "@/lib/eligibility-fields";
import { typicalGrantSize } from "@/lib/grant-screen";
import type { FunderRow } from "@/lib/funder-rows";
import { funderBlock } from "@/lib/funder-eligibility";
import { hiddenByScreen } from "@/lib/funder-screen";
import { ACCESS_LABEL } from "@/lib/access-mode";
import { SOURCE_SHORT } from "@/lib/open-data";
import { FUNDING_KIND_LABEL, isFundingKind } from "@/lib/eligibility-fields";

export type Call3 = "yes" | "check" | "no";
export type FitCall = "strong" | "partial" | "unclear";
export type RangeCall = "fits" | "small" | "large" | "unknown";
export type Group = "apply" | "approach" | "research" | "ruled_out";

export interface FitRow {
  id: string;
  kind: "opportunity" | "funder";
  title: string;
  funder: string | null;
  url: string | null;
  origin: string;
  moneyKind: string | null;
  eligibility: { call: Call3; why: string };
  mission: { call: FitCall; why: string };
  range: { call: RangeCall; why: string };
  access: string;
  deadline: string | null;
  next: string;
  group: Group;
  /** The client's own view of the row, when they gave one (patch 7). */
  clientView?: string | null;
}

export interface MatchInput {
  grant_id: string; verdict: "eligible" | "likely" | "check"; reason: string | null;
  close_date: string | null; award_ceiling: number | null; title: string | null; funder: string | null;
  url: string | null; rationale: string | null; rationale_source?: string | null; verified_at: string | null;
  source?: string | null; money_kind?: string | null; currency?: string | null;
}

export interface LeadInput {
  id: string; kind: "opportunity" | "funder"; money_kind: string; title: string; funder: string | null;
  url: string; deadline: string | null; rolling: boolean; amount_text: string | null; why: string | null;
  eligibility: string | null; review?: string | null;
}

export const GROUP_LABEL: Record<Group, string> = {
  apply: "Apply: open calls that look eligible",
  approach: "Approach: funders worth a letter or an introduction",
  research: "Research first: worth a check before any time is spent",
  ruled_out: "Ruled out",
};

export const GROUP_HELP: Record<Group, string> = {
  apply: "The screen found nothing blocking and at least one real reason it fits. Confirm on the funder's own page, then decide.",
  approach: "No open call to answer. These give through relationships, letters of inquiry or announced rounds.",
  research: "Possible, but something needs a person's read first: eligibility the screen could not decide, or a find not yet checked.",
  ruled_out: "Set aside by For Granted or by the funder's own rules. Shown to For Granted only.",
};

/** The top of the client's budget band, for "bigger than your whole budget". */
const BAND_TOP: Record<string, number> = {
  lt_100k: 100_000, "100k_500k": 500_000, "500k_1m": 1_000_000, "1m_5m": 5_000_000, "5m_10m": 10_000_000,
};

function money(n: number, currency?: string | null): string {
  const c = (currency ?? "USD").toUpperCase();
  const sym = c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : `${c} `;
  return n >= 1_000_000 ? `${sym}${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${sym}${Math.round(n / 1000)}K` : `${sym}${n}`;
}

/**
 * Is the money the right size for this organization? Against the grant size
 * the budget band implies (typicalGrantSize) and the band's top. Other
 * currencies are compared as written: close enough to say "small" or "large",
 * and the figure is shown so nobody has to trust the word.
 */
export function rangeFit(
  amount: number | null, p: EligibilityProfile | null, currency?: string | null,
  /** How the amount reads, when the source said it in words ("EUR 250,000 per project"). */
  said?: string | null,
): { call: RangeCall; why: string } {
  if (amount == null || amount <= 0) return { call: "unknown", why: said ? `${said}.` : "No amount stated." };
  const typical = typicalGrantSize(p?.budget_band ?? null);
  const top = p?.budget_band ? BAND_TOP[p.budget_band] : undefined;
  const shown = said ?? `Up to ${money(amount, currency)}`;
  if (!typical) return { call: "unknown", why: `${shown}. Add an annual budget to Funding Eligibility to judge the size.` };
  if (amount < typical / 2) return { call: "small", why: `${shown}: small for an organization of your size.` };
  if (top && amount > top * 2) return { call: "large", why: `${shown}: more than twice your annual budget. Usually needs a track record at that scale or partners.` };
  return { call: "fits", why: `${shown}: in range for your budget.` };
}

/** "$10,000 - $50,000" or "$25K" as the top figure. */
export function rangeTop(text: string | null): number | null {
  if (!text) return null;
  const nums = [...text.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*([kKmM])?/g)].map(m => {
    const n = Number(m[1]);
    return m[2] ? n * (m[2].toLowerCase() === "m" ? 1_000_000 : 1_000) : n;
  }).filter(n => Number.isFinite(n) && n >= 100);
  return nums.length ? Math.max(...nums) : null;
}

/** How many real positive signals the screen found, from its own reason line. */
export function signalCount(reason: string | null): number {
  if (!reason) return 0;
  return reason.split(";").map(s => s.trim()).filter(s =>
    /^(eligibility text names|names |cause overlap|strong alignment|restricted to 501)/.test(s)).length;
}

function blockerIn(reason: string | null): string | null {
  if (!reason) return null;
  const b = reason.split(";").map(s => s.trim()).find(s => /federal opportunity|cost match/.test(s));
  return b ?? null;
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function decideBy(deadline: string | null, today: Date): string {
  if (!deadline) return "There is no deadline listed: confirm it is still open before writing.";
  const days = Math.ceil((new Date(`${deadline}T12:00:00Z`).getTime() - today.getTime()) / 86_400_000);
  if (days <= 21) return `Closes ${fmtDay(deadline)}, ${days} days away: decide this week.`;
  return `Closes ${fmtDay(deadline)}: decide by ${fmtDay(new Date(new Date(`${deadline}T12:00:00Z`).getTime() - 21 * 86_400_000).toISOString().slice(0, 10))} to leave three weeks to write.`;
}

export function opportunityRow(m: MatchInput, p: EligibilityProfile | null, today = new Date()): FitRow {
  const blocker = blockerIn(m.reason);
  const eligibility: FitRow["eligibility"] =
    m.verdict === "eligible" ? { call: "yes", why: "The eligibility text names your kind of organization, and nothing blocks it." }
    : m.verdict === "likely" ? { call: "yes", why: "Nothing blocks it, and there is at least one real reason it fits." }
    : blocker ? { call: "check", why: `Possible blocker: ${blocker}.` }
    : { call: "check", why: "The screen could not decide: read the eligibility section." };
  const n = signalCount(m.reason);
  const mission: FitRow["mission"] = {
    call: n >= 2 ? "strong" : n === 1 ? "partial" : "unclear",
    why: m.rationale && m.rationale_source === "llm" ? m.rationale : (m.reason ?? "Topical match only."),
  };
  const group: Group = m.verdict === "check" ? "research" : "apply";
  return {
    id: m.grant_id, kind: "opportunity", title: m.title || m.grant_id, funder: m.funder, url: m.url,
    origin: SOURCE_SHORT[m.source ?? "ledger"] ?? "Ground Truth",
    moneyKind: m.money_kind ?? "grants",
    eligibility, mission, range: rangeFit(m.award_ceiling, p, m.currency),
    access: m.close_date ? `Open call, closes ${fmtDay(m.close_date)}` : "Open call, rolling or no date listed",
    deadline: m.close_date,
    next: group === "apply" ? `Confirm eligibility on the funder's page. ${decideBy(m.close_date, today)}`
      : `Read the eligibility section before spending time. ${m.close_date ? decideBy(m.close_date, today) : ""}`.trim(),
    group,
  };
}

export function funderRow(f: FunderRow, p: EligibilityProfile | null): FitRow {
  const block = p ? funderBlock(f, p) : null;
  const verified = !!f.verified_at;
  const eligibility: FitRow["eligibility"] = block
    ? { call: "no", why: `The funder's own guidelines: ${block.reason}.` }
    : verified ? { call: "yes", why: `For Granted checked this funder on ${new Date(f.verified_at!).toLocaleDateString()} and found nothing ruling you out.` }
    : { call: "check", why: "Funders publish who they fund on their own site; not checked yet." };
  const peers = f.evidence.slice(0, 3).map(e => e.name).filter(Boolean);
  const mission: FitRow["mission"] =
    f.from_graph && f.evidence_count > 0 ? { call: "strong", why: `Already funds organizations like yours: ${peers.join(", ")}${f.evidence_count > peers.length ? ` and ${f.evidence_count - peers.length} more` : ""}.` }
    : f.source === "iati" ? { call: "partial", why: f.match_reason ?? "Funds running work in your countries." }
    : f.confidence === "strong" ? { call: "strong", why: f.match_reason ?? "Strong alignment with their stated focus." }
    : f.confidence === "moderate" ? { call: "partial", why: f.match_reason ?? "Some alignment with their stated focus." }
    : { call: "unclear", why: f.match_reason ?? "Alignment by description only." };
  const mode = f.access_mode;
  const accessWord = verified || mode === "unknown" ? ACCESS_LABEL[mode] : `Likely ${ACCESS_LABEL[mode].toLowerCase()}`;
  const group: Group = block || mode === "closed" || hiddenByScreen(f) ? "ruled_out"
    : mode === "unknown" ? "research" : "approach";
  const next =
    mode === "open" ? "Read their guidelines, then send a letter of inquiry."
    : mode === "rfp_cycle" ? "Find when their next round opens and what it covers."
    : mode === "invitation_only" || mode === "preselected_only" ? "Look for a warm introduction, ideally through an organization they already fund."
    : mode === "donor_advised" ? "Look for their own competitive or discretionary fund; the vehicle itself is a dead end."
    : mode === "closed" ? "Not accepting requests now. Check again next cycle."
    : "Find out how they take requests before writing anything.";
  return {
    id: f.funder_id, kind: "funder", title: f.name, funder: f.name, url: f.website,
    origin: SOURCE_SHORT[f.source ?? "ledger"] ?? "Ground Truth", moneyKind: "grants",
    eligibility, mission, range: rangeFit(rangeTop(f.typical_grant_range), p),
    access: accessWord, deadline: null, next, group,
  };
}

export function leadRow(l: LeadInput, p: EligibilityProfile | null, today = new Date()): FitRow {
  const amount = l.amount_text ? rangeTop(l.amount_text) : null;
  const approved = l.review === "approved";
  return {
    id: `web:${l.id}`, kind: l.kind, title: l.kind === "funder" ? (l.funder ?? l.title) : l.title,
    funder: l.funder, url: l.url, origin: "Web", moneyKind: l.money_kind,
    eligibility: { call: "check", why: l.eligibility ? `The page says: ${l.eligibility}` : "Not screened: read who can apply on the page." },
    mission: { call: l.why ? "partial" : "unclear", why: l.why ?? "Found by the web search." },
    range: rangeFit(amount, p, null, l.amount_text),
    access: l.kind === "funder" ? (l.eligibility ? "See how they take requests" : "Access unknown")
      : l.deadline ? `Open call, closes ${fmtDay(l.deadline)}` : l.rolling ? "Rolling" : "No deadline found",
    deadline: l.deadline,
    next: `${approved ? "Checked by For Granted. " : "Found on the web and not yet checked: read the page first. "}${l.kind === "opportunity" ? decideBy(l.deadline, today) : "Then find out how they take requests."}`,
    group: "research",
  };
}

const CALL_ORDER: Record<string, number> = { yes: 0, strong: 0, fits: 0, check: 1, partial: 1, unknown: 1, unclear: 2, small: 2, large: 2, no: 3 };

/** Within a group: soonest deadline first for calls, best fit first for funders. */
function sortRows(rows: FitRow[]): FitRow[] {
  return [...rows].sort((a, b) =>
    (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999")
    || CALL_ORDER[a.mission.call] - CALL_ORDER[b.mission.call]
    || CALL_ORDER[a.eligibility.call] - CALL_ORDER[b.eligibility.call]
    || a.title.localeCompare(b.title));
}

export interface FitReport {
  groups: { key: Group; label: string; help: string; rows: FitRow[] }[];
  counts: Record<Group, number> & { total: number };
}

/**
 * Every row, grouped and sorted. Rows For Granted ruled out (and, for a client,
 * rows the client set aside) arrive in `ruledOut` and land in that group,
 * which the page shows to For Granted only.
 */
export function buildFitReport(input: {
  matches: MatchInput[]; funders: FunderRow[]; leads: LeadInput[];
  eligibility: EligibilityProfile | null; ruledOut?: Set<string>; includeRuledOut: boolean;
  clientViews?: Map<string, string>; today?: Date;
}): FitReport {
  const today = input.today ?? new Date();
  const rows: FitRow[] = [
    ...input.matches.map(m => opportunityRow(m, input.eligibility, today)),
    ...input.funders.map(f => funderRow(f, input.eligibility)),
    ...input.leads.map(l => leadRow(l, input.eligibility, today)),
  ].map(r => {
    const key = `${r.kind === "funder" && !r.id.startsWith("web:") ? "funder" : r.id.startsWith("web:") ? "lead" : "grant"}:${r.id.replace(/^web:/, "")}`;
    const out = input.clientViews?.has(key) ? { ...r, clientView: input.clientViews.get(key) } : r;
    return input.ruledOut?.has(key) ? { ...out, group: "ruled_out" as Group } : out;
  });
  const order: Group[] = ["apply", "approach", "research", "ruled_out"];
  const groups = order
    .filter(g => g !== "ruled_out" || input.includeRuledOut)
    .map(g => ({ key: g, label: GROUP_LABEL[g], help: GROUP_HELP[g], rows: sortRows(rows.filter(r => r.group === g)) }))
    .filter(g => g.rows.length > 0);
  const counts = { apply: 0, approach: 0, research: 0, ruled_out: 0, total: 0 } as FitReport["counts"];
  for (const g of groups) { counts[g.key] = g.rows.length; counts.total += g.rows.length; }
  return { groups, counts };
}

/** The money kind in words, or null for plain grants. */
export function kindWord(k: string | null): string | null {
  return k && k !== "grants" && isFundingKind(k) ? FUNDING_KIND_LABEL[k] : null;
}

/** The report as CSV, one row per lead, for a spreadsheet. */
export function reportCsv(report: FitReport): string {
  const esc = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Group", "Type", "Title", "Funder", "Source", "Kind", "Can apply", "Why (eligibility)", "Mission fit", "Why (fit)", "Size", "Why (size)", "Access", "Deadline", "Next step", "Link"];
  const lines = [head.map(esc).join(",")];
  for (const g of report.groups) for (const r of g.rows) {
    lines.push([GROUP_LABEL[g.key].split(":")[0], r.kind === "funder" ? "Funder" : "Opportunity", r.title, r.funder, r.origin,
      kindWord(r.moneyKind) ?? "Grants", r.eligibility.call, r.eligibility.why, r.mission.call, r.mission.why,
      r.range.call, r.range.why, r.access, r.deadline, r.next, r.url].map(v => esc(v as string | null)).join(","));
  }
  return lines.join("\n");
}
