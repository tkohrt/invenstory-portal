import { redirect } from "next/navigation";
import { after } from "next/server";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getWorkspaceVisibility } from "@/lib/server/data";
import { closedInBrain } from "@/lib/server/brain";
import { getGaps } from "@/lib/server/eligibility";
import { getFunderDossier, getContactShadow } from "@/lib/server/dossier";
import { getFunderProfile, getEngagementHistory } from "@/lib/server/funder-profile";
import { getFunderGrants } from "@/lib/server/irs990-grants";
import { getContactsForEins } from "@/lib/server/funder-contacts";
import { getJudgments } from "@/lib/server/triage";
import { suppresses } from "@/lib/triage";
import { getSetupState } from "@/lib/server/setup";
import { knownFunderMatch, RELATIONSHIP_LABEL } from "@/lib/setup";
import FunderDossierView from "@/components/FunderDossierView";
import { linksStale } from "@/lib/funder-links";
import { lookupFunderLinks } from "@/lib/server/funder-links";

/**
 * The funder dossier (patch 40): one page per matched funder. Gated exactly
 * like the Funding page — Funders mode on (or admin), the P1.5 readiness gate,
 * never the Brain — plus one more rule: a funder For Granted ruled out never
 * renders for a client, even by URL.
 */
/** A client's browser is never sent For Granted's bookkeeping or the machine feed address (patch 63). */
function forClient<T extends { fields: Record<string, unknown>; meta: Record<string, unknown> } | null>(p: T): T {
  if (!p) return p;
  const drop = new Set(["rss_url", "links_checked_at", "links_failed_at"]);
  const keep = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !drop.has(k)));
  return { ...p, fields: keep(p.fields), meta: keep(p.meta) };
}

export default async function FunderDossierPage({ params, searchParams }: {
  params: Promise<{ fid: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ fid }, sp] = await Promise.all([params, searchParams]);
  const funderId = decodeURIComponent(fid).slice(0, 220);
  const session = await getSession();
  if (!session) redirect("/");
  await closedInBrain(session.tenantId);
  const vis = await getWorkspaceVisibility(session.tenantId);
  const fundersOn = session.role === "admin" || vis.funder_compass === true;
  if (!fundersOn) await gateFeature(session.role, session.tenantId, "funder_compass"); // redirects
  if (session.role === "client") {
    const gaps = await getGaps(session.tenantId).catch(() => null);
    if (gaps && (gaps.gaps.some(g => g.tier === "critical") || !gaps.computedAt)) redirect("/readiness?unlock=funding");
  }
  const isAdmin = session.role === "admin";
  const viewingAsClient = isAdmin && sp.view === "client";

  const [funder, judgments, setup] = await Promise.all([
    getFunderDossier(session.tenantId, funderId),
    getJudgments(session.tenantId).catch(() => new Map()),
    getSetupState(session.tenantId).catch(() => null),
  ]);
  if (!funder) redirect("/funding?mode=funders");
  const j = judgments.get(`funder:${funder.funder_id}`);
  if (!isAdmin && j && suppresses(j.state)) redirect("/funding?mode=funders");

  const [shadow, contacts, profile, history, filingGrants] = await Promise.all([
    getContactShadow(funder.ein),
    // Full records for the admin's own eyes only; a client session never loads them.
    isAdmin && !viewingAsClient && funder.ein ? getContactsForEins([funder.ein]).then(m => m[funder.ein ?? ""] ?? []).catch(() => []) : Promise.resolve([]),
    // The shared funder profile (patch 41): read LIVE, so a fact verified once
    // shows on every client's dossier at once. Survives a missing 0088.
    getFunderProfile(funder.ein, funder.funder_id).catch(() => null),
    // For Granted's own cross-client picture; never loaded for a client
    // session or the as-client preview.
    isAdmin && !viewingAsClient ? getEngagementHistory(funder.ein, funder.name).catch(() => []) : Promise.resolve([]),
    // 990 phase two (patch 45): the latest ingested grant list. Survives a missing 0092.
    getFunderGrants(funder.ein).catch(() => null),
  ]);
  // The funder's own channels (patch 63): the first visit after the links go
  // stale reads the funder's site AFTER this page is sent, so nobody waits on
  // someone else's website. The links show from the next visit, for every
  // client, because the profile is shared. Best-effort by design.
  if (funder.website && linksStale(profile?.fields.links_checked_at, new Date(), profile?.fields.links_failed_at)) {
    const { ein, funder_id, website, name } = funder;
    after(async () => {
      try { await lookupFunderLinks({ ein, funderId: funder_id, website, name }); }
      catch (e) { console.error("[funder-links] lookup failed", e instanceof Error ? e.message : e); }
    });
  }
  const known = knownFunderMatch(funder.name, setup?.answers.known_funders ?? []);

  return (
    <FunderDossierView funder={funder} shadow={shadow} contacts={contacts}
      profile={isAdmin && !viewingAsClient ? profile : forClient(profile)} history={history} filingGrants={filingGrants}
      isAdmin={isAdmin} viewingAsClient={viewingAsClient}
      knownAs={known ? RELATIONSHIP_LABEL[known.relationship] : null} />
  );
}
