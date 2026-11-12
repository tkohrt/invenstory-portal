/**
 * Query hygiene for the search bar (patch 31).
 *
 * The search RPC parses queries with Postgres's websearch_to_tsquery, whose
 * web syntax treats a minus as "exclude this word". Our own title convention
 * ("Layer II - N4HC Quarterly Update") therefore built queries that FORBADE
 * the word after every dash: in production, 25 of 68 documents could not be
 * found by searching their own exact title. Nobody is using minus-exclusion
 * on purpose, so hyphens become spaces before the parser ever sees them.
 * Quoted phrases keep working; hyphenated words still match, because the
 * index stores their parts ("non-profit" indexes as non + profit too).
 */
export function cleanSearchQuery(q: string): string {
  return q.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

/** Escape a user string for use inside an ILIKE pattern. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, m => `\\${m}`);
}
