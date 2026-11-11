import "server-only";
import { withAiUsage } from "./ai-usage";
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
  findGrants, findFunders, fundersLikeMine, ledgerConfigured, LedgerUnavailable, warmLedger,
} from "./ledger";
import { RUN_WAKE_MS, ASLEEP_MESSAGE } from "@/lib/ledger-wake";
import type { GrantCard, FunderCard, RawGrantResult } from "@/lib/ledger-types";
// Signal 1 is pure and lives outside server-only so it can be unit tested.
import { screenGrant, needText, typicalGrantSize, normalizeGrant, dedupeScreened, qualifyGrantIds, GRANT_ID_MAX } from "@/lib/grant-screen";
// Public international sources (patch 4, 1 Nov 2026): planned from the profile,
// searched in parallel with Ground Truth, screened by the same rules.
import { searchPhrases, keepForProfile, toGrantCard, iatiFunderRows, threeSixtyFunderRows, canadaFunderRows, searchCountries, MAX_IATI_COUNTRIES } from "@/lib/open-data";
import { countryName } from "@/lib/countries";
import { resolveSources, planFromSources } from "@/lib/sources";
import { getSourceSettings, sourceAvailability } from "./sources";
import { searchOpenSources, type OpenResults } from "./open-data";
// Approved web finds join only the clients they fit (patch 5).
import { additionFits } from "@/lib/web-discovery";
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
  queries: { track: string; text: string; ok: boolean; results: number }[];
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

  /**
   * Write down what is about to be asked, BEFORE asking it.
   *
   * This record exists so a disappointing run can be diagnosed. Written at the
   * end, it was the first casualty of exactly the runs worth diagnosing: a run
   * killed at the function limit left no trace of its queries at all, which is
   * how a real stall on 7 September became unanswerable without reading the
   * database by hand. The row is filled in with what each query returned once
   * the calls come back.
   *
   * Best-effort. A diagnostic that can fail a run is worse than no diagnostic.
   */
  const plannedQueries = [
    ...grantQs.map(text => ({ track: "grants" as const, text })),
    ...funderQs.map(text => ({ track: "funders" as const, text })),
  ];
  const { data: runRow, error: planErr } = await db.from("match_run").insert({
    tenant_id: tenantId, queries: plannedQueries, used_profile: useProfile,
    multi_query: multiQuery, ran_by: ranBy ?? null, profile_note: health?.note ?? null,
  }).select("id").maybeSingle();
  if (planErr) console.error("could not record the planned queries", planErr);
  const runId = (runRow as { id: string } | null)?.id ?? null;

  // Outside the US, public sources too. A US-only profile plans none of them.
  // Which sources this client searches (patch 11): Automatic follows the
  // profile, and a person's On or Off wins.
  const sourceStates = resolveSources(p, await getSourceSettings(tenantId), sourceAvailability("admin"), "admin");
  const openPlan = planFromSources(p, sourceStates);
  const openWanted = !!(openPlan.worldbank || openPlan.eu || openPlan.iati || openPlan.canada);
  const phrases = searchPhrases(p);
  const noOpen: OpenResults = { opportunities: [], funders: [], ukFunders: [], canadaProgrammes: [], calls: [] };

  // Ground Truth naps (patch 19): if it does not answer a quick health check,
  // wake it first, in this run, rather than firing every question at a host
  // that is still starting and refuses them all at once.
  // One call: it returns at once when the service is already awake.
  step(0, 5, "checking Ground Truth is awake (it naps when nobody has searched for a while)");
  await warmLedger(RUN_WAKE_MS).catch(() => null);

  step(1, 5, `asking ${grantQs.length + funderQs.length + 1} questions of the funding data${openWanted ? ", and public international sources" : ""}`);
  const [grantEnvs, funderEnvs, evidenceEnv, overlay, funderOverlay, dossier, openRes] = await Promise.all([
    Promise.all(grantQs.map(need => attempt(`grant query "${need.slice(0, 60)}"`, () => findGrants({ need })))),
    Promise.all(funderQs.map(need => attempt(`funder query "${need.slice(0, 60)}"`, () =>
      findFunders({ need, location: p.state_code ?? undefined, grant_size: size })))),
    attempt("graph query", () => fundersLikeMine({
      org_description: funderQs[0] ?? needText(p, orgName, "funders"),
      location: p.state_code ?? undefined,
    })),
    getApprovedOverlay("grant").then(rows => rows.filter(r => additionFits(r, tenantId, p))),
    getApprovedOverlay("funder").then(rows => rows.filter(r => additionFits(r, tenantId, p))),
    buildDossier(tenantId, orgName, p),
    // Never throws: each source fails on its own and says so in the run record.
    openWanted ? searchOpenSources(openPlan, phrases).catch(() => noOpen) : Promise.resolve(noOpen),
  ]);

  // Every grant query failing is an outage, not an empty shortlist. Throwing
  // here is what protects the cache: the zero-result path below deletes, and a
  // sleeping service must never be the reason a client's matches disappear.
  // Public sources that answered keep a run alive: an international client's
  // shortlist is worth saving even while Ground Truth naps.
  const openAnswered = openRes.calls.some(c => c.ok);
  if (grantEnvs.length && grantEnvs.every(e => !e.ok) && funderEnvs.every(e => !e.ok) && !openAnswered) {
    throw new LedgerUnavailable(
      ASLEEP_MESSAGE);
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
  // Public opportunities join here, before ids, the overlay and the screen, so
  // a Ground Truth correction can attach to one exactly as to a Ledger record.
  // Their ids are namespaced ("wb:", "eu:") and can never collide with a link.
  const openCards = openRes.opportunities.filter(o => keepForProfile(o, p)).map(toGrantCard);
  normalized.push(...openCards);

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

  /**
   * SAVE FIRST, EXPLAIN AFTER. The order here is the whole point.
   *
   * Explaining 31 matches is a model call per batch and the longest step in a
   * run. It used to happen BEFORE anything was written, so a run killed at the
   * function limit threw away seven Ledger calls and a full screening pass to
   * protect nothing: on 7 September a run died 57 seconds in, at match 16 of
   * 31, and saved not one row. The page went on showing a shortlist from a week
   * earlier as though it were current.
   *
   * The comment on the old code said a rationale failure must not lose the
   * match. That was true of an exception and false of a killed function, which
   * is the failure that actually happens. Now the results are durable before
   * the expensive optional step begins, every row starts as `pending`, and an
   * interrupted run costs explanations that the existing follow-on job refills
   * in one click.
   */
  step(3, 5, "saving the results");
  const ranAt = new Date().toISOString();
  // Pure, so it costs nothing to compute before the writes it feeds.
  const ledgerFunderRows = funderRowsFrom(mergedFunders, mergedEvidence);
  // Funders from international aid data, after Ground Truth's own, never twice.
  // Then UK funders of those same peers, from 360Giving (patch 9).
  const openWhere = searchCountries(p, MAX_IATI_COUNTRIES).slice(0, 3).map(c => countryName(c) ?? c).join(", ");
  const funderRows = [
    ...ledgerFunderRows,
    ...iatiFunderRows(openRes.funders).filter(f => !ledgerFunderRows.some(r => r.funder_id === f.funder_id)),
    ...threeSixtyFunderRows(openRes.ukFunders ?? [], openWhere),
    // And Government of Canada programmes funding organizations there (patch 10).
    ...canadaFunderRows(openRes.canadaProgrammes ?? [], c => countryName(c) ?? c),
  ].filter((f, i, all) => all.findIndex(x => x.funder_id === f.funder_id) === i);

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
        // Nothing is explained yet at this point in a run, by design: results
        // are made durable before the expensive optional step starts. Every row
        // therefore begins owed an explanation, and either this run's last step
        // or the follow-on job settles it.
        rationale: null,
        rationale_source: "pending",
        verified_at: s.verified_at ?? null,
        // Patch 4 (0073): which source, what kind of money, and its currency.
        source: s.source ?? "ledger",
        money_kind: s.money_kind ?? "grants",
        currency: s.currency ?? null,
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
        source: f.source ?? "ledger",
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
    // What each public source was asked, kept beside Ground Truth's queries.
    ...openRes.calls.map(c => ({ track: `open:${c.source}`, text: c.note ? `${c.text} (${c.note})` : c.text, ok: c.ok, results: c.results })),
  ];
  const outcome = {
    queries,
    profile_note: (health?.note ?? null) && failedQueries
      ? `${health?.note ?? ""} ${failedQueries} of ${queries.length} queries failed this run.`.trim()
      : health?.note ?? null,
    kept: screened.length, dropped, funders: funderRows.length,
  };
  // Fill in the row opened before the calls. Inserting a second one when that
  // failed keeps the record complete rather than losing this run's queries
  // because a write minutes ago did not land.
  const { error: runErr } = runId
    ? await db.from("match_run").update(outcome).eq("tenant_id", tenantId).eq("id", runId)
    : await db.from("match_run").insert({
        tenant_id: tenantId, used_profile: useProfile, multi_query: multiQuery,
        ran_by: ranBy ?? null, ...outcome,
      });
  if (runErr) console.error("could not record match run", runErr);

  /**
   * The last step, and the only one a run can afford to lose.
   *
   * Everything above is on disk. Every grant row went in as `pending`, so if
   * this is cut short the shortlist stands, the page says how many explanations
   * are owed, and one button fills them. Wrapped, because an explanation
   * failure must not fail a run whose results are already saved.
   */
  step(4, 5, `explaining ${screened.length} matches against the Inven(s)tory`);
  try {
    await withAiUsage({ tenantId, actor: "admin", feature: "match_rationale" }, () => addRationales(screened, dossier, p, orgName,
      (done, total) => step(4, 5, `explained ${done} of ${total} matches`)));
    await writeRationales(tenantId, screened);
  } catch (e) {
    console.error("rationale generation failed", e);
  }

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
    /** When this first appeared, preserved across runs. See 0036. */
    first_matched_at: string | null;
    title: string | null; funder: string | null; url: string | null;
    rationale: string | null; rationale_source: string | null;
    source_site: string | null; verified_at: string | null;
    /** Patch 4 (0073). Null on rows stored before it. */
    source?: string | null; money_kind?: string | null; currency?: string | null;
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

/**
 * Store the explanations that were produced, and only those.
 *
 * A row whose source is still `pending` did not get one, and writing it back as
 * though it had is how a match ends up permanently holding a rule-based summary
 * that nothing will ever revisit.
 */
export async function writeRationales(
  tenantId: string, grants: ScreenedGrant[],
): Promise<number> {
  let filled = 0;
  for (const g of grants) {
    if (!g.rationale_source || g.rationale_source === "pending") continue;
    const { error } = await db.from("eligible_grant")
      .update({ rationale: g.rationale?.slice(0, 2000) ?? null, rationale_source: g.rationale_source })
      .eq("tenant_id", tenantId).eq("grant_id", g.grant_id.slice(0, GRANT_ID_MAX));
    if (error) console.error("[rationales] write failed", error);
    else filled += 1;
  }
  return filled;
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

/**
 * The search history rail (Funding split, patch 24): every run with its date
 * and counts, newest first. CLIENT-SAFE BY CONSTRUCTION: no `queries` column,
 * so the exact query text (For Granted's working view) never leaves the
 * server for a client session. Counts and dates only.
 */
export interface RunHistoryRow {
  id: string; ran_at: string; kept: number; dropped: number;
  funders: number; used_profile: boolean;
}
export async function getRunHistory(tenantId: string, limit = 10): Promise<RunHistoryRow[]> {
  const { data, error } = await db.from("match_run")
    .select("id, ran_at, kept, dropped, funders, used_profile")
    .eq("tenant_id", tenantId)
    .order("ran_at", { ascending: false })
    .limit(limit);
  // Best-effort: the rail is context, never the content. An empty rail beats
  // a broken page.
  if (error) return [];
  return (data ?? []) as RunHistoryRow[];
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

  await withAiUsage({ tenantId, actor: "admin", feature: "match_rationale" }, () => addRationales(screened, dossier, p, orgName,
    (done, count) => opts.onProgress?.({ done, total: count, detail: `explained ${done} of ${count} matches` })));

  const filled = await writeRationales(tenantId, screened);
  return { filled, remaining: await pendingRationaleCount(tenantId) };
}
