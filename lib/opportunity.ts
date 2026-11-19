// One opportunity, one entry (patch 68, 19 Nov 2026). Pure; tested in
// tests/funding/opportunity.test.ts.
//
// Until this patch the review queue knew an opportunity by its web address
// alone. The same grant seen at two addresses was two entries, and one a
// person rejected came back as new the moment its address or wording moved.
// This file says when two sightings are the same opportunity:
//   1. They are candidates when they share a site (the host of the entry's
//      own link) or a funder (the funder's name, normalised).
//   2. Their titles must say the same thing: the significant words nearly all
//      shared, and every number in one present in the other (so "2026" is
//      not "2027" and "Round 13" is not "Round 14").
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

// Words that say what kind of thing it is, not which one.
const GENERIC = new Set([
  "the", "a", "an", "of", "for", "and", "in", "on", "to", "by", "with", "at", "from", "powered",
  "grant", "grants", "program", "programs", "programme", "programmes", "fund", "funding", "opportunity", "opportunities",
  "accelerator", "accelerators", "application", "applications", "apply", "call", "request", "proposals", "rfp", "nofo",
  "award", "awards", "initiative", "now", "open", "new", "fy",
]);

/** The words of a title that say WHICH opportunity it is, and its numbers. */
export function titleParts(title: string | null | undefined): { words: Set<string>; numbers: Set<string> } {
  const words = new Set<string>(), numbers = new Set<string>();
  for (const t of (title ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/)) {
    if (!t) continue;
    if (/^\d+$/.test(t)) numbers.add(t);
    else if (!GENERIC.has(t) && t.length > 1) words.add(t);
  }
  return { words, numbers };
}

/** Whether two titles name the same opportunity. */
export function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = titleParts(a), y = titleParts(b);
  if (!x.words.size || !y.words.size) return false;
  // Every number must agree both ways, except that a bare year on one side
  // only is allowed ("2027 Kresge Artist Fellowships" and "Kresge Artist
  // Fellowships"): the cycle rule below is what tells years apart.
  const isYear = (n: string) => /^(19|20)\d\d$/.test(n);
  const onlyIn = (p: Set<string>, q: Set<string>) => [...p].filter(n => !q.has(n));
  const extra = [...onlyIn(x.numbers, y.numbers), ...onlyIn(y.numbers, x.numbers)];
  if (extra.some(n => !isYear(n))) return false;
  if (onlyIn(x.numbers, y.numbers).some(isYear) && onlyIn(y.numbers, x.numbers).some(isYear)) return false; // two different years
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

/** Whether two sightings could be the same opportunity at all: same site, or same funder. */
export function sameOrigin(a: Sighting, b: Sighting): boolean {
  const ha = oppHost(a.url), hb = oppHost(b.url);
  if (ha && hb && ha === hb) return true;
  const fa = funderKey(a.funder), fb = funderKey(b.funder);
  return !!fa && !!fb && fa === fb;
}

export function sameOpportunity(a: Sighting, b: Sighting): boolean {
  return sameOrigin(a, b) && sameTitle(a.title, b.title) && sameCycle(a.close_date, b.close_date);
}

/**
 * Of the entries on file, the one a new sighting is another view of, or null.
 * When several match, a decision a person made wins (rejected, then approved),
 * then a waiting entry, oldest first: the new sighting must meet the decision
 * if there is one.
 */
export function findTwin<T extends Sighting & { status: string; created_at: string }>(seen: Sighting, onFile: T[]): T | null {
  const rank: Record<string, number> = { rejected: 0, approved: 1, in_review: 2, proposed: 3 };
  const hits = onFile.filter(e => e.status in rank && sameOpportunity(seen, e));
  hits.sort((p, q) => rank[p.status] - rank[q.status] || p.created_at.localeCompare(q.created_at));
  return hits[0] ?? null;
}

// ---------------------------------------------------------------------------
// What changed between two sightings of one opportunity.

export interface Change { field: "close_date" | "open_date" | "max_award" | "min_award" | "investment_terms"; label: string; was: string; now: string }
const FACTS: { field: Change["field"]; label: string; money?: boolean }[] = [
  { field: "close_date", label: "Deadline" },
  { field: "open_date", label: "Opens" },
  { field: "max_award", label: "Largest award", money: true },
  { field: "min_award", label: "Smallest award", money: true },
  { field: "investment_terms", label: "Terms" },
];
const shown = (v: unknown, money?: boolean): string =>
  v === null || v === undefined || v === "" ? "" : money && typeof v === "number" ? `$${Math.round(v).toLocaleString("en-US")}` : String(v).trim();

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
  for (const c of changedFacts(onFile, later)) out[c.field] = later[c.field];
  return out;
}

export function changeLine(c: Change): string {
  return c.was ? `${c.label} was ${c.was}, now ${c.now}` : `${c.label} now ${c.now} (none on file)`;
}

// ---------------------------------------------------------------------------
// "Also seen at": the other places one entry has been sighted.

export interface Seen { url: string; source: string | null; at: string }
export const MAX_SEEN = 12;

/** Add a sighting, newest last, one per address, capped. Returns the same array when nothing changes. */
export function addSeen(list: unknown, s: Seen, own?: string | null): Seen[] {
  const cur = (Array.isArray(list) ? list : []).filter((x): x is Seen => !!x && typeof (x as Seen).url === "string");
  if (!/^https?:\/\//i.test(s.url) || s.url === own || cur.some(x => x.url === s.url)) return cur;
  return [...cur, { url: s.url.slice(0, 500), source: s.source?.slice(0, 200) ?? null, at: s.at }].slice(-MAX_SEEN);
}
