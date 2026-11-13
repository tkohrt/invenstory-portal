import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getCachedMatches, getCachedFunders } from "@/lib/server/matching";
import { ledgerConfigured, ledgerHealth } from "@/lib/server/ledger";
import { getContactsForEins } from "@/lib/server/funder-contacts";
import { getEligibilityProfile, getGaps } from "@/lib/server/eligibility";
import { getSearchProfile } from "@/lib/server/search-profile-read";
import { getFactReviews } from "@/lib/server/profile-review";
import { factId } from "@/lib/search-profile";
import { profileBuildProgress } from "@/lib/server/search-profile-extract";
import { getLastRunQueries, pendingRationaleCount, getRunHistory } from "@/lib/server/matching";
import { latestJob } from "@/lib/server/jobs";
import { getJudgments } from "@/lib/server/triage";
import FunderMatchesView from "@/components/FunderMatchesView";
import { getSetupState } from "@/lib/server/setup";
import { closedInBrain } from "@/lib/server/brain";
import WebFinds from "@/components/WebFinds";
import { getLeads, webSearchAvailable } from "@/lib/server/discovery";
import { getClientViews, selfSearchOn } from "@/lib/server/client-view";
import { suppresses } from "@/lib/triage";
import type { Judgment } from "@/lib/server/triage";
import { getSourceStates, getLastRunBySource } from "@/lib/server/sources";
import { getSavedItems } from "@/lib/server/saved";
import { getCuratedMatches } from "@/lib/server/curated";
import { getWorkspaceVisibility } from "@/lib/server/data";
import type { FundingMode } from "@/components/FunderMatchesView";

export default async function FundingPage({ searchParams }: { searchParams: Promise<{ view?: string; mode?: string; focus?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/");
  await closedInBrain(session.tenantId);  // Auto-Draft patch 3: not a client page
  // The Funding split (patch 24): one page, two modes, two per-client switches.
  // funder_matches is Grants mode (the stored settings carry over) and
  // funder_compass is Funders mode. A client needs at least one on; admins
  // always pass so For Granted can run matches on a client's behalf. The mode
  // asked for is clamped to one the client actually has.
  const vis = await getWorkspaceVisibility(session.tenantId);
  const grantsOn = session.role === "admin" || vis.funder_matches === true;
  const fundersOn = session.role === "admin" || vis.funder_compass === true;
  if (!grantsOn && !fundersOn) {
    await gateFeature(session.role, session.tenantId, "funder_matches"); // redirects
  }
  // P1.5 (patch 38): the Funding tools open once the critical eligibility
  // answers are in and a readiness check has run. Clients who are not there
  // yet land on the Readiness screen, which names both keys. Admins always
  // pass, so For Granted can work on a client's behalf, and the as-client
  // preview passes with them (the nav badge is the signal, not a locked door
  // in For Granted's face).
  if (session.role === "client") {
    const gaps = await getGaps(session.tenantId).catch(() => null);
    if (gaps && (gaps.gaps.some(g => g.tier === "critical") || !gaps.computedAt)) redirect("/readiness?unlock=funding");
  }
  let mode: FundingMode = sp.mode === "funders" ? "funders" : "grants";
  if (mode === "funders" && !fundersOn) mode = "grants";
  if (mode === "grants" && !grantsOn) mode = "funders";
  // When this person last visited this mode (patch 25): drives the NEW tags.
  // Null for admins and for the as-client preview, which cannot know the
  // client's own reading history, so the preview shows the first-visit
  // baseline (no tags) rather than a guess.
  const prefs = (session.user.ui_prefs as Record<string, unknown> | null) ?? {};
  const seenAt = session.role === "client"
    ? ((prefs[mode === "funders" ? "funding_seen_funders" : "funding_seen_grants"] as string | undefined) ?? null)
    : null;
  // Notification bars this person has dismissed (patch 28); keyed by the news.
  const dismissed = Array.isArray(prefs.funding_dismissed) ? (prefs.funding_dismissed as string[]) : [];

  // Patch 7 (1 Nov 2026): For Granted can see the page exactly as the client
  // does (?view=client). Everything below then loads as for a client session.
  const isAdmin = session.role === "admin";
  const viewingAsClient = isAdmin && sp.view === "client";
  const asAdmin = isAdmin && !viewingAsClient;

  const configured = ledgerConfigured();
  // Funders the client already knows (company setup, patch 14).
  const knownFunders = (await getSetupState(session.tenantId).catch(() => null))?.answers.known_funders ?? [];
  // Sources (patch 11): every session sees which databases are searched and
  // why; the query text stays For Granted's.
  const [sources, sourcesRun] = await Promise.all([
    getSourceStates(session.tenantId, asAdmin ? "admin" : "client").catch(() => []),
    getLastRunBySource(session.tenantId).catch(() => ({ ranAt: null, bySource: {} })),
  ]);
  const webState = sources.find(s => s.id === "web");
  const webOn = webState?.on ?? true;
  const webOffReason = !webSearchAvailable()
    ? (asAdmin ? "Web search needs the AgentCore web search gateway in this environment." : "The web search is not available right now.")
    : webState && !webState.on ? `The web search is off. ${webState.unavailable ?? webState.why} See Sources.` : null;
  // Curated-list sweeps (P2.5, patch 39). Survives a missing 0087.
  const curatedPromise = getCuratedMatches(session.tenantId).catch(() => []);
  const [tenant, allMatches, allFunders, eligibility, health, judgments, clientViews, selfOn, runs, savedItems] = await Promise.all([
    getTenant(session.tenantId),
    getCachedMatches(session.tenantId),
    getCachedFunders(session.tenantId),
    getEligibilityProfile(session.tenantId).catch(() => null),
    configured ? ledgerHealth() : Promise.resolve({ ok: false, detail: "Not configured." }),
    // Read for every session (through the service client, scoped to this
    // client): a row For Granted ruled out is removed before a client's page is
    // built, rather than sent and hidden. Until patch 7 a client saw them.
    getJudgments(session.tenantId).catch(() => new Map<string, Judgment>()),
    getClientViews(session.tenantId),
    selfSearchOn(session.tenantId),
    // The history rail: dates and counts only, safe for every session.
    getRunHistory(session.tenantId).catch(() => []),
    // The save-for-later bucket (patch 26), tenant's own rows only.
    getSavedItems(session.tenantId),
  ]);

  const ruledOut = new Set<string>();
  for (const [key, j] of judgments) if (suppresses(j.state)) ruledOut.add(key);
  const matches = asAdmin ? allMatches : allMatches.filter(m => !ruledOut.has(`grant:${m.grant_id}`));
  const funders = asAdmin ? allFunders : allFunders.filter(f => !ruledOut.has(`funder:${f.funder_id}`));

  // Contacts are For Granted's own working knowledge and never reach a client
  // screen, so they are fetched only for an admin session. A client's page does
  // not merely hide them; it never loads them.
  // The Search Profile and the query text are For Granted's working view. A
  // client session never loads them rather than loading and hiding them.
  const [contacts, profile, lastQueries, matchJob, profileJob, pendingRationales, profileStored] = asAdmin
    ? await Promise.all([
        getContactsForEins(funders.map(f => f.ein ?? "").filter(Boolean)),
        getSearchProfile(session.tenantId).catch(() => null),
        getLastRunQueries(session.tenantId).catch(() => []),
        // So a reload rejoins work already in flight rather than looking idle.
        latestJob(session.tenantId, "match").catch(() => null),
        latestJob(session.tenantId, "search_profile").catch(() => null),
        pendingRationaleCount(session.tenantId).catch(() => 0),
        // So a reload offers Continue rather than a button that deletes the
        // documents already read.
        profileBuildProgress(session.tenantId).catch(() => ({ done: 0, total: 0 })),
      ])
    : [{}, null, [], null, null, 0, { done: 0, total: 0 }];

  // The matching-profile page (patch 34, decided 10 Nov) shows the profile's
  // FACTS to clients with their quotes; the exact query text remains For
  // Granted's working view, as above. Here only a NUMBER crosses to the view:
  // how many facts await the client's review, for the funders-mode rung.
  const [profForCount, factReviews] = await Promise.all([
    asAdmin ? Promise.resolve(profile) : getSearchProfile(session.tenantId).catch(() => null),
    getFactReviews(session.tenantId),
  ]);
  const profileAwaiting = profForCount
    ? profForCount.facts.filter(f => f.subject === "organization" && f.documentId && !factReviews.has(factId(f))).length
    : 0;
  const profileGeneratedAt = profForCount?.generatedAt ?? null;

  // A client For Granted lets search for itself runs matching and the web
  // search from this page (patch 7), and rejoins its own run on reload.
  const clientRuns = !isAdmin && selfOn;
  const canRun = asAdmin || clientRuns;
  const [ownMatchJob, ownPending] = clientRuns
    ? await Promise.all([latestJob(session.tenantId, "match").catch(() => null), pendingRationaleCount(session.tenantId).catch(() => 0)])
    : [null, 0];

  // Found on the web (patch 5). A client reads only rows whose exact page was
  // found; For Granted sees every row with its review status.
  const [leads, discoverJob] = await Promise.all([
    getLeads(session.tenantId, !asAdmin).catch(() => []),
    canRun ? latestJob(session.tenantId, "discover").catch(() => null) : Promise.resolve(null),
  ]);
  const views = Object.fromEntries([...clientViews].map(([k, v]) => [k, v]));
  const webSection = (leads.length > 0 || canRun) ? (
    <WebFinds leads={leads} isAdmin={asAdmin} orgName={tenant?.name ?? "this organization"}
      available={webSearchAvailable() && webOn} offReason={webOffReason} canRun={canRun} initialJob={discoverJob}
      clientViews={views} clientMode={!asAdmin} preview={viewingAsClient} />
  ) : null;

  return (
    <FunderMatchesView
      webSection={webSection}
      matches={matches}
      funders={funders}
      orgName={tenant?.name ?? "this organization"}
      configured={configured}
      health={health}
      contacts={contacts}
      eligibility={eligibility}
      profile={profile}
      lastQueries={lastQueries}
      matchJob={asAdmin ? matchJob : ownMatchJob}
      profileJob={profileJob}
      profileStored={profileStored}
      // For Granted's judgments and reasons stay For Granted's: a client's page
      // gets none (the rows they ruled out were removed above).
      judgments={asAdmin ? Object.fromEntries(
        [...judgments].map(([k, j]) => [k, {
          state: j.state, reason: j.reason, note: j.note, decidedAt: j.decidedAt,
        }]),
      ) : {}}
      pendingRationales={asAdmin ? pendingRationales : ownPending}
      isAdmin={asAdmin}
      canRun={canRun}
      viewingAsClient={viewingAsClient}
      selfSearch={asAdmin ? selfOn : null}
      clientViews={views}
      sources={sources}
      sourcesRun={sourcesRun}
      selfSearchOn={selfOn}
      knownFunders={knownFunders}
      mode={mode}
      runs={runs}
      savedItems={savedItems}
      curatedMatches={await curatedPromise}
      dismissedNotices={dismissed}
      focusId={typeof sp.focus === "string" ? sp.focus.slice(0, 220) : null}
      profileAwaiting={profileAwaiting}
      profileGeneratedAt={profileGeneratedAt}
      seenAt={seenAt}
      grantsOn={grantsOn}
      fundersOn={fundersOn}
    />
  );
}
