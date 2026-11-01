import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getCachedMatches, getCachedFunders } from "@/lib/server/matching";
import { ledgerConfigured, ledgerHealth } from "@/lib/server/ledger";
import { getContactsForEins } from "@/lib/server/funder-contacts";
import { getEligibilityProfile } from "@/lib/server/eligibility";
import { getSearchProfile } from "@/lib/server/search-profile-read";
import { profileBuildProgress } from "@/lib/server/search-profile-extract";
import { getLastRunQueries, pendingRationaleCount } from "@/lib/server/matching";
import { latestJob } from "@/lib/server/jobs";
import { getJudgments } from "@/lib/server/triage";
import FunderMatchesView from "@/components/FunderMatchesView";
import { closedInBrain } from "@/lib/server/brain";
import WebFinds from "@/components/WebFinds";
import { getLeads, webSearchAvailable } from "@/lib/server/discovery";
import { getClientViews, selfSearchOn } from "@/lib/server/client-view";
import { suppresses } from "@/lib/triage";
import type { Judgment } from "@/lib/server/triage";

export default async function FunderMatchesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/");
  await closedInBrain(session.tenantId);  // Auto-Draft patch 3: not a client page
  // Hidden for every client by default (workspace.ts, defaultVisible:false);
  // admins always pass so For Granted can run matches on a client's behalf.
  await gateFeature(session.role, session.tenantId, "funder_matches");

  // Patch 7 (1 Nov 2026): For Granted can see the page exactly as the client
  // does (?view=client). Everything below then loads as for a client session.
  const isAdmin = session.role === "admin";
  const viewingAsClient = isAdmin && sp.view === "client";
  const asAdmin = isAdmin && !viewingAsClient;

  const configured = ledgerConfigured();
  const [tenant, allMatches, allFunders, eligibility, health, judgments, clientViews, selfOn] = await Promise.all([
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
      available={webSearchAvailable()} canRun={canRun} initialJob={discoverJob}
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
    />
  );
}
