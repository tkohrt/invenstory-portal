import "server-only";
// Funder matching: eligibility filter -> alignment rank -> evidence boost.
//
// The pipeline from the architecture doc, in that order:
//   1. ELIGIBILITY (hard filter, rules not fingerprints) — drop what the org
//      cannot win. This exclusion is the value competitors skip.
//   2. ALIGNMENT (soft rank, fingerprints) — done inside the Ledger, which
//      embeds our query text with its own model and ranks against its own
//      vectors. The portal never reconciles two embedding spaces.
//   3. EVIDENCE (graph boost) — funders already funding orgs like this one.
//
// Everything the Ledger returns is a June 2026 lead, never a fact. Verdicts
// below say "check" whenever the rules cannot honestly say more.
import { db } from "./db";
import { getEligibilityProfile } from "./eligibility";
import { getApprovedOverlay, mergeOverlay } from "./ledger-overlay";
import { applyFunderOverlay, type LedgerRecord } from "@/lib/ledger-merge";
import { funderRowsFrom, type FunderRow } from "@/lib/funder-rows";
import { grantQueries, funderQueries, assessProfile } from "@/lib/search-profile";
import { getSearchProfile } from "./search-profile-read";
import { buildDossier, addRationales } from "./match-rationale";
import {
  findGrants, findFunders, fundersLikeMine, ledgerConfigured, LedgerUnavailable,
} from "./ledger";
import type { GrantCard, FunderCard, RawGrantResult } from "@/lib/ledger-types";
// Signal 1 is pure and lives outside server-only so it can be unit tested.
import { screenGrant, needText, typicalGrantSize, normalizeGrant, dedupeScreened, qualifyGrantIds, GRANT_ID_MAX } from "@/lib/grant-screen";
import type { Verdict, ScreenedGrant } from "@/lib/grant-screen";
export { screenGrant, needText } from "@/lib/grant-screen";
export type { Verdict, ScreenedGrant } from "@/lib/grant-screen";

export interface MatchRun {
  grants: ScreenedGrant[];
  funders: FunderRow[];
  evidence: FunderCard[];
  dropped: number;
  note?: string;
  ranAt: string;
  /** Exactly what was sent to each index, whether it answered, and how much. */
  queries: { track: "grants" | "funders"; text: string; ok: boolean; results: number }[];
  /** False means this fell back to the eligibility form. */
  usedProfile: boolean;
  profileNote: string | null;
}

/**
 * Run the full pipeline for one tenant and cache the grant verdicts.
 *
 * Overlay is merged over the Ledger's grant results before screening, so an FG
 * correction (a moved deadline, a fixed eligibility line) drives the verdict
 * rather than the stale June 2026 record.
 */
export async function runMatch(
  tenantId: string, orgName: string,
  opts: {
    multiQuery?: boolean; ranBy?: string;
    /** Called as the run moves, so a page can show where it has got to. */
    onProgress?: (p: { done: number; total: number; detail: string }) => void;
  } = {},
): Promise<MatchRun> {
  if (!ledgerConfigured()) throw new LedgerUnavailable("The Funder Ledger service is not configured yet.");

  const p = await getEligibilityProfile(tenantId);
  if (!p.org_type || !p.cause_areas.length) {
    throw new Error("Fill in at least the organization type and one cause area before matching.");
  }

  const multiQuery = opts.multiQuery ?? true;
  const ranBy = opts.ranBy;
  // Best-effort throughout. Progress reporting must never be the reason a run
  // fails, so every call is fire-and-forget.
  const step = (done: number, total: number, detail: string) => {
    try { opts.onProgress?.({ done, total, detail }); } catch { /* never fatal */ }
  };

  // The Inven(s)tory drives the search when there is one worth searching on.
  //
  // This is the change the whole feature was for. Until now the query was built
  // from a dozen eligibility fields while the Inven(s)tory, the actual product,
  // was used only to explain matches after the fact. The eligibility profile is
  // still authoritative for screening; it just no longer has to carry the
  // description on its own.
  step(0, 5, "reading what we know about this client");
  const stored = await getSearchProfile(tenantId).catch(() => null);
  const health = stored ? assessProfile(stored) : null;
  const useProfile = !!stored && !!health?.usable;

  // Several angles per track rather than one blended paragraph. One long query
  // averages into mush; three sharper ones each retrieve a different
  // neighbourhood. Single-query stays reachable so two runs can be compared and
  // the Inven(s)tory's contribution can actually be attributed.
  const grantTexts = useProfile
    ? grantQueries(stored, p, orgName)
    : [needText(p, orgName, "grants")];
  const funderTexts = useProfile
    ? funderQueries(stored, p, orgName)
    : [needText(p, orgName, "funders")];

  const grantQs = multiQuery ? grantTexts : grantTexts.slice(0, 1);
  const funderQs = multiQuery ? funderTexts : funderTexts.slice(0, 1);
  const size = typicalGrantSize(p.budget_band);

  // Each angle is its own call. A failure on one must not lose the others: a
  // partial shortlist beats an empty one, and the alternative is that a single
  // slow query takes down a whole run.
  // Each angle is its own call, and each records whether it actually ran. A
  // partial failure must not look like a small result set: the service naps,
  // and "zero grants" and "the service was asleep" have opposite consequences
  // one screen later, where an empty run sweeps the cache.
  type Ran<T> = { ok: boolean; results: T[]; note?: string };
  const attempt = async <T,>(label: string, fn: () => Promise<{ results: T[]; note?: string }>): Promise<Ran<T>> => {
    try { const r = await fn(); return { ok: true, results: r.results, note: r.note }; }
    catch (e) { console.error(`[match] ${label} failed`, e); return { ok: false, results: [] }; }
  };

  step(1, 5, `asking ${grantQs.length + funderQs.length + 1} questions of the funding data`);
  const [grantEnvs, funderEnvs, evidenceEnv, overlay, funderOverlay, dossier] = await Promise.all([
    Promise.all(grantQs.map(need => attempt(`grant query "${need.slice(0, 60)}"`, () => findGrants({ need })))),
    Promise.all(funderQs.map(need => attempt(`funder query "${need.slice(0, 60)}"`, () =>
      findFunders({ need, location: p.state_code ?? undefined, grant_size: size })))),
    attempt("graph query", () => fundersLikeMine({
      org_description: funderQs[0] ?? needText(p, orgName, "funders"),
      location: p.state_code ?? undefined,
    })),
    getApprovedOverlay("grant"),
    getApprovedOverlay("funder"),
    buildDossier(tenantId, orgName, p),
  ]);

  // Every grant query failing is an outage, not an empty shortlist. Throwing
  // here is what protects the cache: the zero-result path below deletes, and a
  // sleeping service must never be the reason a client's matches disappear.
  if (grantEnvs.length && grantEnvs.every(e => !e.ok) && funderEnvs.every(e => !e.ok)) {
    throw new LedgerUnavailable(
      "Ground Truth did not answer any query. Nothing has been changed. It may have been asleep: try again in a minute.");
  }
  const failedQueries = [...grantEnvs, ...funderEnvs].filter(e => !e.ok).length;

  const grantsEnv = {
    results: grantEnvs.flatMap(e => e.results),
    // The first note from any query that actually ran, not from a slot that
    // failed and has no note to give.
    note: grantEnvs.find(e => e.ok && e.note)?.note,
  };
  const fundersEnv = { results: funderEnvs.flatMap(e => e.results) as FunderCard[] };

  // The service's response shape differs from the published spec (prose in
  // close_date, "$500,000" strings for amounts, eligibility under a different
  // key). Normalize first, or the screener reads nothing and the DB rejects
  // the write.
  step(2, 5, `screening ${grantsEnv.results.length} opportunities against the eligibility profile`);
  const normalized = (grantsEnv.results as unknown as RawGrantResult[]).map(normalizeGrant);

  // Merge FG corrections over the frozen base before anything is judged.
  //
  // Ids are assigned here, once, and carried unchanged through screening and
  // into eligible_grant. Anything that recomputes a record's identity later
  // breaks the review loop silently: a correction filed against the cached id
  // matches no base record, is neither applied nor appended, and vanishes.
  // Sorted before ids are assigned. qualifyGrantIds gives the bare id to the
  // FIRST record it sees and a slug-qualified one to later collisions, so
  // identity used to depend on position in the list. With several queries
  // unioned, that position changes whenever the index reranks, which would
  // silently move a Ground Truth correction from one programme to its
  // neighbour on the same landing page. Sorting makes the id a property of the
  // record rather than of the run.
  const ordered = [...normalized].sort((a, b) =>
    (a.opportunity_number ?? "").localeCompare(b.opportunity_number ?? "") ||
    (a.title ?? "").localeCompare(b.title ?? ""));
  const withIds = qualifyGrantIds(ordered) as unknown as LedgerRecord[];
  const unmatched: string[] = [];
  const merged = mergeOverlay(withIds, overlay, {
    onUnmatched: row => unmatched.push(row.base_id ?? row.id),
  });
  if (unmatched.length) {
    // Not an error: a correction for an opportunity this run did not return is
    // normal. Logged because a correction that NEVER matches on any run is a
    // broken loop, and silence is how the last one went unnoticed for weeks.
    console.warn(`ground truth: ${unmatched.length} grant correction(s) matched no record this run`, unmatched.slice(0, 10));
  }

  // The funder side gets the same treatment, and until now did not: funder
  // results were returned raw, so an approved funder correction sat in the
  // overlay marked approved and reached no view at all. Every verification
  // recorded through the picker was write-only.
  //
  // Funders key on EIN, which is what the picker writes into base_id, so a
  // correction lands on the record it was attached to. Both lists are merged:
  // the same funder can arrive through search and through the graph, and a
  // correction that applied to one but not the other would be worse than none.
  const mergedFunders = applyFunderOverlay(fundersEnv.results, funderOverlay);
  // Evidence takes corrections but not additions: this list means "funders the
  // graph shows already backing organizations like this one", and an
  // FG-discovered funder with no graph history is not that.
  const mergedEvidence = applyFunderOverlay(evidenceEnv.results, funderOverlay, { additions: false });

  const collected: ScreenedGrant[] = [];
  let dropped = 0;
  for (const rec of merged) {
    const s = screenGrant(rec as unknown as GrantCard, p);
    if (!s) { dropped += 1; continue; }
    if (rec._overlay) {
      s.from_overlay = true;
      // Freshness a client can actually act on: when a person confirmed this,
      // not when the source dataset was snapshotted.
      s.verified_at = rec._overlay.reviewed_at ?? null;
    }
    collected.push(s);
  }

  // Several programmes can share one landing page, so ids must be made unique
  // before they reach a single upsert batch.
  const screened = dedupeScreened(collected);

  // Sort by how confidently we can act: eligible, then likely, then check;
  // soonest deadline first inside each band, rolling last.
  const rank: Record<Verdict, number> = { eligible: 0, likely: 1, check: 2 };
  screened.sort((a, b) =>
    rank[a.verdict] - rank[b.verdict] ||
    (a.close_date ?? "9999").localeCompare(b.close_date ?? "9999"));

  // Explain each surviving match against the profile and the Inven(s)tory.
  // Best-effort: a rationale failure must not lose the match itself.
  step(3, 5, `explaining ${screened.length} matches against the Inven(s)tory`);
  try {
    await addRationales(screened, dossier, p, orgName,
      (done, total) => step(3, 5, `explaining match ${done} of ${total} against the Inven(s)tory`));
  } catch (e) {
    console.error("rationale generation failed", e);
  }

  step(4, 5, "saving the results");
  const ranAt = new Date().toISOString();

  if (screened.length) {
    const { error } = await db.from("eligible_grant").upsert(
      screened.map(s => ({
        tenant_id: tenantId, grant_id: s.grant_id.slice(0, GRANT_ID_MAX), verdict: s.verdict,
        reason: s.reason.slice(0, 500), close_date: s.close_date,
        award_ceiling: s.award_ceiling, matched_at: ranAt,
        title: s.title?.slice(0, 400) ?? null,
        funder: s.funder?.slice(0, 200) ?? null,
        source_site: s.source_site?.slice(0, 200) ?? null,
        url: s.website?.slice(0, 500) ?? null,
        rationale: s.rationale?.slice(0, 2000) ?? null,
        // Which explanations still owe a real answer. A run cut short at the
        // function limit leaves these pending, and the follow-on job fills them.
        rationale_source: s.rationale_source ?? "pending",
        verified_at: s.verified_at ?? null,
      })),
      { onConflict: "tenant_id,grant_id" });
    // Never report a successful run over a rejected write. The first version of
    // this swallowed the error and cheerfully claimed "15 opportunities kept"
    // while the table stayed empty.
    if (error) throw new Error(`Matching ran but could not be saved: ${error.message}`);

    // A run is a snapshot, not an accumulation. Anything this run did not
    // return is stale by definition, and leaving it behind blends runs together
    // (which is how rows with no title survived a schema change and sat in the
    // results table looking like current matches).
    const { error: sweepError } = await db.from("eligible_grant")
      .delete().eq("tenant_id", tenantId).lt("matched_at", ranAt);
    if (sweepError) console.error("could not clear stale matches", sweepError);
  } else {
    // No survivors: clear the table rather than leaving the last run's results
    // standing as though they were current. Bounded by ranAt like the funder
    // sweep, so a concurrent run's fresh rows are not collateral, and loud on
    // failure rather than silent.
    const { error: clearErr } = await db.from("eligible_grant")
      .delete().eq("tenant_id", tenantId).lt("matched_at", ranAt);
    if (clearErr) console.error("could not clear grant matches", clearErr);
  }

  // The funder side, stored under the same rule: a run is a snapshot, not an
  // accumulation. Until now these were computed and discarded, which is why an
  // approved funder correction reached no view — there was no view.
  const funderRows = funderRowsFrom(mergedFunders, mergedEvidence);
  if (funderRows.length) {
    const { error } = await db.from("matched_funder").upsert(
      funderRows.map(f => ({
        tenant_id: tenantId,
        funder_id: f.funder_id.slice(0, 200),
        ein: f.ein, name: f.name.slice(0, 300),
        website: f.website?.slice(0, 500) ?? null,
        location: f.location?.slice(0, 200) ?? null,
        focus: f.focus?.slice(0, 500) ?? null,
        mission: f.mission?.slice(0, 4000) ?? null,
        typical_grant_range: f.typical_grant_range?.slice(0, 120) ?? null,
        match_reason: f.match_reason?.slice(0, 800) ?? null,
        confidence: f.confidence, caveat: f.caveat?.slice(0, 800) ?? null,
        evidence: f.evidence.slice(0, 12),
        // The full count, not the truncated one: "and 40 more" is the honest
        // reading of a funder with fifty grantees, and it is what the list is
        // ordered by.
        evidence_count: f.evidence_count,
        from_graph: f.from_graph, from_overlay: f.from_overlay,
        access_mode: f.access_mode,
        access_note: f.access_note?.slice(0, 800) ?? null,
        access_verified: f.access_verified,
        has_grant_history: f.has_grant_history,
        verified_at: f.verified_at,
        matched_at: ranAt,
      })),
      { onConflict: "tenant_id,funder_id" },
    );
    // Loud, like the grant write: a discarded error is how a run once reported
    // success over an empty table.
    if (error) throw new Error(`Funder matches could not be saved: ${error.message}`);

    const { error: sweep } = await db.from("matched_funder")
      .delete().eq("tenant_id", tenantId).lt("matched_at", ranAt);
    if (sweep) console.error("could not clear stale funder matches", sweep);
  } else {
    // Also bounded by ranAt. An unguarded delete here would wipe the rows a
    // concurrent run had just written — two admin tabs is enough, since a run
    // can take well over a minute.
    const { error: clear } = await db.from("matched_funder")
      .delete().eq("tenant_id", tenantId).lt("matched_at", ranAt);
    if (clear) console.error("could not clear funder matches", clear);
  }

  // What was actually asked, kept so a disappointing run can be diagnosed
  // rather than argued about.
  // What ran, not what was intended. A query that failed and was swallowed
  // would otherwise be recorded as if it had executed, which defeats the point
  // of keeping this in exactly the case where diagnosis matters.
  const queries = [
    ...grantQs.map((text, i) => ({ track: "grants" as const, text, ok: grantEnvs[i]?.ok ?? false, results: grantEnvs[i]?.results.length ?? 0 })),
    ...funderQs.map((text, i) => ({ track: "funders" as const, text, ok: funderEnvs[i]?.ok ?? false, results: funderEnvs[i]?.results.length ?? 0 })),
  ];
  const { error: runErr } = await db.from("match_run").insert({
    tenant_id: tenantId, queries, used_profile: useProfile, multi_query: multiQuery,
    ran_by: ranBy ?? null,
    profile_note: (health?.note ?? null) && failedQueries
      ? `${health?.note ?? ""} ${failedQueries} of ${queries.length} queries failed this run.`.trim()
      : health?.note ?? null,
    kept: screened.length, dropped, funders: funderRows.length,
  });
  if (runErr) console.error("could not record match run", runErr);

  return {
    grants: screened, funders: funderRows, evidence: mergedEvidence,
    dropped, note: grantsEnv.note, ranAt,
    queries, usedProfile: useProfile, profileNote: health?.note ?? null,
  };
}

/** Cached verdicts from the last run, for rendering without hitting the Ledger. */
export async function getCachedMatches(tenantId: string) {
  const { data } = await db.from("eligible_grant")
    .select("*").eq("tenant_id", tenantId).order("close_date", { ascending: true, nullsFirst: false });
  return (data ?? []) as {
    grant_id: string; verdict: Verdict; reason: string | null;
    close_date: string | null; award_ceiling: number | null; matched_at: string;
    title: string | null; funder: string | null; url: string | null;
    rationale: string | null; rationale_source: string | null;
    source_site: string | null; verified_at: string | null;
  }[];
}

/** Cached funder matches from the last run. */
export async function getCachedFunders(tenantId: string): Promise<FunderRow[]> {
  const { data, error } = await db.from("matched_funder")
    .select("*").eq("tenant_id", tenantId)
    // The same ranking funderRowsFrom computes. Ordering by evidence_count is
    // why that column exists: PostgREST cannot sort on jsonb array length, so
    // without it a funder with one peer grantee outranked one with twelve
    // whenever its name sorted earlier, and the tested ordering never reached
    // the page.
    .order("from_graph", { ascending: false })
    .order("evidence_count", { ascending: false })
    .order("name", { ascending: true });
  // A failed read must not render as "nothing found". An empty list is a claim
  // about this client's prospects, and it should only be made when it is true.
  if (error) throw new Error(`Funder matches could not be read: ${error.message}`);
  return (data ?? []) as unknown as FunderRow[];
}

/** The query text from the most recent run, for the admin panel. */
export interface RunQuery { track: string; text: string; ok?: boolean; results?: number }

export async function getLastRunQueries(tenantId: string): Promise<RunQuery[]> {
  const { data, error } = await db.from("match_run")
    .select("queries").eq("tenant_id", tenantId)
    .order("ran_at", { ascending: false }).limit(1).maybeSingle();
  // A failed read is not "no queries". Rendering it as an absence would hide
  // the one thing this panel exists to show.
  if (error) throw new Error(`match run read failed: ${error.message}`);
  return ((data?.queries ?? []) as RunQuery[]);
}

/** How many matches are still waiting for a real explanation. */
export async function pendingRationaleCount(tenantId: string): Promise<number> {
  const { count } = await db.from("eligible_grant")
    .select("grant_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("rationale_source", "pending");
  return count ?? 0;
}

/**
 * Finish the explanations a cut-short run did not reach.
 *
 * Separate from a match run because it is resumable and a run is not: it reads
 * what is already cached, fills what it can inside its own budget, and can be
 * called again. Nothing else about the run is redone, so this is cheap and
 * safe to repeat.
 */
export async function fillPendingRationales(
  tenantId: string, orgName: string,
  opts: { onProgress?: (p: { done: number; total: number; detail: string }) => void } = {},
): Promise<{ filled: number; remaining: number }> {
  const p = await getEligibilityProfile(tenantId);
  const { data } = await db.from("eligible_grant")
    .select("*").eq("tenant_id", tenantId).eq("rationale_source", "pending")
    .order("matched_at", { ascending: false });

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const total = rows.length;
  if (!total) return { filled: 0, remaining: 0 };

  const dossier = await buildDossier(tenantId, orgName, p);

  // Only as many as the remaining budget can plausibly carry. Anything left
  // stays pending and the next call picks it up, which is the whole point.
  const slice = rows.slice(0, 24);
  const screened = slice.map(r => ({
    grant_id: String(r.grant_id), title: String(r.title ?? r.grant_id),
    verdict: r.verdict, reason: String(r.reason ?? ""),
    close_date: r.close_date, award_ceiling: r.award_ceiling,
    funder: r.funder ?? undefined, eligibility: r.eligibility ?? undefined,
  })) as unknown as ScreenedGrant[];

  await addRationales(screened, dossier, p, orgName,
    (done, count) => opts.onProgress?.({ done, total: count, detail: `explaining match ${done} of ${count}` }));

  let filled = 0;
  for (const g of screened) {
    if (g.rationale_source === "pending") continue;
    const { error } = await db.from("eligible_grant")
      .update({ rationale: g.rationale?.slice(0, 2000) ?? null, rationale_source: g.rationale_source })
      .eq("tenant_id", tenantId).eq("grant_id", g.grant_id);
    if (error) console.error("[rationales] write failed", error);
    else filled += 1;
  }
  return { filled, remaining: await pendingRationaleCount(tenantId) };
}
