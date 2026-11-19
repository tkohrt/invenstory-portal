// One opportunity, one entry (patch 68, 19 Nov 2026). Pure; tested in
// tests/funding/opportunity.test.ts.
//
// Until this patch the review queue knew an opportunity by its web address
// alone. The same grant seen at two addresses was two entries, and one a
// person rejected came back as new the moment its address or wording moved.
// This file says when two sightings are the same opportunity:
//   1. They are candidates when they share a site (the host of the entry's
//      own link) or a funder (the funder's name, normalised).
//   2. Their titles must say the same thing: at least two significant words
//      each, nearly all shared; every number, single letter and roman
//      numeral in one present in the other (so "2026" is not "2027", "Round
//      13" is not "Round 14", "Track A" is not "Track B"); and the kind of
//      thing they name must not disagree (a "Fund" is not an "Accelerator").
//      A title too short for that must be the same title, word for word.
//   3. They must be the same cycle: deadlines within CYCLE_DAYS of each
//      other, or at least one with no deadline. Next year's round is a new
//      opportunity, and is filed as one.
// Deliberately strict. A missed match costs a duplicate in the queue; a wrong
// match would fold a real opportunity into another and lose it.

export const CYCLE_DAYS = 120;
/** How much of the two titles' significant words must be shared (Jaccard). */
export const TITLE_MATCH = 0.8;

/** The site an entry's own link is on: host without "www.", lower case. Null for anything that is not a web address. */
export function oppHost(url: string | null | undefined): string | null {
  const m = /^https?:\/\/(?:www\.)?([^/:#?\s]+)/i.exec((url ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * A funder's name as a key: lower case, a leading "the" dropped, everything
 * but letters and digits removed. Mirrored in SQL by migration 0101's
 * backfill; change one and change the other. Null when there is no name.
 */
export function funderKey(name: string | null | undefined): string | null {
  const k = (name ?? "").toLowerCase().replace(/^\s*the\s+/, "").replace(/[^a-z0-9]+/g, "");
  return k || null;
}

// Words that carry no identity at all.
const FILLER = new Set(["the", "of", "for", "and", "in", "on", "to", "by", "with", "at", "from", "powered", "now", "open", "new", "fy", "apply", "application", "applications", "opportunity", "opportunities", "funding"]);
// Words that say what KIND of thing it is. Two titles may leave them out, but
// may not disagree on them: "Arts Fund" and "Arts Accelerator" are two things.
const KIND: Record<string, string> = {
  grant: "grant", grants: "grant", fund: "fund", funds: "fund", award: "award", awards: "award",
  accelerator: "accelerator", accelerators: "accelerator", initiative: "initiative", initiatives: "initiative",
  program: "program", programs: "program", programme: "program", programmes: "program",
  fellowship: "fellowship", fellowships: "fellowship", prize: "prize", prizes: "prize", challenge: "challenge", challenges: "challenge",
  competition: "competition", residency: "residency", scholarship: "scholarship", scholarships: "scholarship",
  call: "call", request: "call", proposals: "call", rfp: "call", nofo: "call",
};

/**
 * A title taken apart: the words that say WHICH opportunity it is; its marks
 * (numbers, single letters and roman numerals: "13", "A", "IV"), which must
 * agree exactly; the kinds it names; and the whole title normalised, for
 * titles too short to compare by words.
 */
export function titleParts(title: string | null | undefined): { words: Set<string>; numbers: Set<string>; kinds: Set<string>; whole: string } {
  const words = new Set<string>(), numbers = new Set<string>(), kinds = new Set<string>();
  const tokens = (title ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
  for (const t of tokens) {
    if (/^\d+$/.test(t) || t.length === 1 || /^(ii|iii|iv|vi|vii|viii|ix|xi|xii)$/.test(t)) numbers.add(t);
    else if (t in KIND) kinds.add(KIND[t]);
    else if (!FILLER.has(t)) words.add(t);
  }
  return { words, numbers, kinds, whole: tokens.join(" ") };
}

/** Whether two titles name the same opportunity. */
export function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = titleParts(a), y = titleParts(b);
  if (!x.whole || !y.whole) return false;
  if (x.whole === y.whole) return x.words.size > 0; // the same title, word for word (never one made only of generic words)
  // Too little to go on: with fewer than two significant words a near match is a guess.
  if (x.words.size < 2 || y.words.size < 2) return false;
  // Every mark must agree both ways, except that a bare year on one side
  // only is allowed ("2027 Kresge Artist Fellowships" and "Kresge Artist
  // Fellowships"): the cycle rule below is what tells years apart.
  const isYear = (n: string) => /^(19|20)\d\d$/.test(n);
  const onlyIn = (p: Set<string>, q: Set<string>) => [...p].filter(n => !q.has(n));
  const extra = [...onlyIn(x.numbers, y.numbers), ...onlyIn(y.numbers, x.numbers)];
  if (extra.some(n => !isYear(n))) return false;
  if (onlyIn(x.numbers, y.numbers).some(isYear) && onlyIn(y.numbers, x.numbers).some(isYear)) return false; // two different years
  // The kinds must not disagree: both name one, and they share none.
  if (x.kinds.size && y.kinds.size && ![...x.kinds].some(k => y.kinds.has(k))) return false;
  let shared = 0;
  for (const w of x.words) if (y.words.has(w)) shared += 1;
  return shared / (x.words.size + y.words.size - shared) >= TITLE_MATCH;
}

const day = (d: string | null | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000 : null;
};

/** Same round: deadlines within CYCLE_DAYS, or at least one side has none. */
export function sameCycle(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = day(a), y = day(b);
  return x === null || y === null || Math.abs(x - y) <= CYCLE_DAYS;
}

export interface Sighting {
  title: string | null | undefined;
  /** The entry's own link. */
  url: string | null | undefined;
  funder: string | null | undefined;
  close_date: string | null | undefined;
}

const initials = (name: string | null | undefined) =>
  (name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !["the", "of", "for", "and", "on", "in"].includes(w)).map(w => w[0]).join("");

/**
 * Whether two funder names could be the same funder: the same key, one inside
 * the other ("Kresge" and "Kresge Foundation"), or one the initials of the
 * other ("NEH" and "National Endowment for the Humanities").
 */
export function funderAgrees(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = funderKey(a), fb = funderKey(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const [short, long] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
  if (short.length >= 4 && long.includes(short)) return true;
  return short.length >= 2 && (initials(a) === fb || initials(b) === fa);
}

/**
 * Whether two sightings could be the same opportunity at all. The same funder
 * (by name) is enough. The same site is enough only when the funders do not
 * disagree: application platforms and news sites host many funders, so two
 * NAMED, different funders on one site are two things.
 */
export function sameOrigin(a: Sighting, b: Sighting): boolean {
  const named = !!funderKey(a.funder) && !!funderKey(b.funder);
  if (named) {
    if (funderAgrees(a.funder, b.funder)) return true;
    return false;
  }
  const ha = oppHost(a.url), hb = oppHost(b.url);
  return !!ha && !!hb && ha === hb;
}

export function sameOpportunity(a: Sighting, b: Sighting): boolean {
  return sameOrigin(a, b) && sameTitle(a.title, b.title) && sameCycle(a.close_date, b.close_date);
}

/**
 * Whether a rejection still binds a new sighting. A rejection is a judgment
 * of that round. Once the rejected entry's own deadline has passed, a new,
 * open sighting is a new round (quarterly and rolling programmes come back
 * inside the 120-day window), and is filed.
 */
export function rejectionStands(rejectedClose: string | null | undefined, today: string): boolean {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(rejectedClose ?? "");
  return !m || m[1] >= today;
}

/**
 * Of the entries on file, the one a new sighting is another view of, or null.
 * When several match, the live approved entry is met first (it is the
 * standing decision, and reviewers reject duplicates of it), then a rejection
 * that still stands, then a waiting entry, oldest first. `today` is
 * YYYY-MM-DD.
 */
export function findTwin<T extends Sighting & { status: string; created_at: string }>(seen: Sighting, onFile: T[], today = new Date().toISOString().slice(0, 10)): T | null {
  const rank: Record<string, number> = { approved: 0, rejected: 1, in_review: 2, proposed: 3 };
  const hits = onFile.filter(e => e.status in rank && sameOpportunity(seen, e) && (e.status !== "rejected" || rejectionStands(e.close_date, today)));
  hits.sort((p, q) => rank[p.status] - rank[q.status] || p.created_at.localeCompare(q.created_at));
  return hits[0] ?? null;
}

// ---------------------------------------------------------------------------
// What changed between two sightings of one opportunity.

export interface Change { field: "close_date" | "open_date" | "max_award" | "min_award"; label: string; was: string; now: string }
// Dates and amounts only. Free-text terms are left out on purpose: the same
// terms are worded differently on every read ("$100k" and "$100,000"), and
// each rewording would be a new "change".
const FACTS: { field: Change["field"]; label: string; money?: boolean }[] = [
  { field: "close_date", label: "Deadline" },
  { field: "open_date", label: "Opens" },
  { field: "max_award", label: "Largest award", money: true },
  { field: "min_award", label: "Smallest award", money: true },
];
const shown = (v: unknown, money?: boolean): string => {
  if (v === null || v === undefined || v === "") return "";
  if (!money) return String(v).trim();
  // An amount is compared as a number however it was stored (50000, "50000", "50,000").
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : String(v).trim();
};

/**
 * The facts a later sighting states differently. Only a fact the later
 * sighting actually states counts: silence is not a change, so a thinner read
 * of the same page never proposes blanking what is on file.
 */
export function changedFacts(onFile: Record<string, unknown> | null | undefined, later: Record<string, unknown> | null | undefined): Change[] {
  const out: Change[] = [];
  for (const f of FACTS) {
    const now = shown(later?.[f.field], f.money);
    if (!now) continue;
    const was = shown(onFile?.[f.field], f.money);
    if (was.toLowerCase() !== now.toLowerCase()) out.push({ field: f.field, label: f.label, was, now });
  }
  return out;
}

/** The changed facts laid over what is on file: what approving an update writes. */
export function applyChanges(onFile: Record<string, unknown>, later: Record<string, unknown>): Record<string, unknown> {
  const out = { ...onFile };
  let money = false;
  for (const c of changedFacts(onFile, later)) { out[c.field] = later[c.field]; if (c.field === "max_award" || c.field === "min_award") money = true; }
  // An amount travels with its currency.
  if (money && typeof later.currency === "string" && later.currency) out.currency = later.currency;
  return out;
}

export function changeLine(c: Change): string {
  return c.was ? `${c.label} was ${c.was}, now ${c.now}` : `${c.label} now ${c.now} (none on file)`;
}

// ---------------------------------------------------------------------------
// "Also seen at": the other places one entry has been sighted.

export interface Seen { url: string; source: string | null; at: string }
export const MAX_SEEN = 12;

/** Add a sighting, newest last, one per address, capped. Compare with `seenChanged` to know whether anything was added. */
export function addSeen(list: unknown, s: Seen, own?: string | null): Seen[] {
  const cur = (Array.isArray(list) ? list : []).filter((x): x is Seen => !!x && typeof (x as Seen).url === "string");
  if (!/^https?:\/\//i.test(s.url) || s.url === own || cur.some(x => x.url === s.url)) return cur;
  return [...cur, { url: s.url.slice(0, 500), source: s.source?.slice(0, 200) ?? null, at: s.at }].slice(-MAX_SEEN);
}

/** Whether addSeen changed the list (its length alone cannot say, once it is at the cap). */
export function seenChanged(before: unknown, after: Seen[]): boolean {
  const cur = (Array.isArray(before) ? before : []).filter((x): x is Seen => !!x && typeof (x as Seen).url === "string");
  return cur.length !== after.length || cur.some((x, i) => x.url !== after[i].url);
}
