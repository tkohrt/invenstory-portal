// Company setup on first sign-in (patch 14, onboarding build, 3 November 2026).
// Outside the (portal) group on purpose: no sidebar, so the steps have the page.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant, getWorkspaceVisibility } from "@/lib/server/data";
import { getEligibilityProfile } from "@/lib/server/eligibility";
import { claimSetup, setupDocs } from "@/lib/server/setup";
import { getContentCoverage } from "@/lib/server/gap-agent";
import { checklistFor } from "@/lib/checklist";
import { tenantIsBrain } from "@/lib/server/brain";
import { setupGate, goalsOn } from "@/lib/setup";
import SetupFlow from "@/components/SetupFlow";

export const dynamic = "force-dynamic";
// Step 1 and the link boxes read a web page and index it inside the action.
export const maxDuration = 300;

export default async function SetupPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "client" || await tenantIsBrain(session.tenantId)) redirect("/invenstory");
  const state = await claimSetup(session.tenantId, session.user.id);
  if (setupGate(state, session.user).kind !== "run" || !state) redirect("/invenstory");
  const [tenant, profile, docs, vis, coverage] = await Promise.all([
    getTenant(session.tenantId), getEligibilityProfile(session.tenantId), setupDocs(session.tenantId),
    getWorkspaceVisibility(session.tenantId).catch(() => ({} as Record<string, boolean>)),
    getContentCoverage(session.tenantId).catch((): Awaited<ReturnType<typeof getContentCoverage>> => ({ cov: {}, computedAt: null })),
  ]);
  // The grocery list (P1, patch 29): what funders ask for, with the live state
  // per item. Documents are read as they arrive, so the page's 6-second
  // refresh while anything is processing turns these green during onboarding.
  const grocery = checklistFor(profile.org_type).map(i => ({
    key: i.key, label: i.label, tier: i.tier,
    state: (coverage.cov[i.key]?.state ?? "missing") as "covered" | "thin" | "missing",
  }));
  return (
    <SetupFlow
      tenantName={tenant?.name ?? "your organization"}
      orgType={tenant?.org_type ?? null}
      website={tenant?.website ?? null}
      fullName={session.user.full_name ?? ""}
      email={session.user.email}
      state={state}
      profile={profile}
      docs={docs}
      grocery={grocery}
      goals={goalsOn(vis)}
      tools={{ chat: vis.chat !== false, funder_matches: vis.funder_matches !== false, drafts: vis.drafts !== false }}
    />
  );
}
