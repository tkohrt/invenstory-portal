// Company setup on first sign-in (patch 14, onboarding build, 3 November 2026).
// Outside the (portal) group on purpose: no sidebar, so the steps have the page.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getEligibilityProfile } from "@/lib/server/eligibility";
import { claimSetup, setupDocs } from "@/lib/server/setup";
import { tenantIsBrain } from "@/lib/server/brain";
import { setupGate } from "@/lib/setup";
import SetupFlow from "@/components/SetupFlow";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "client" || await tenantIsBrain(session.tenantId)) redirect("/invenstory");
  const state = await claimSetup(session.tenantId, session.user.id);
  if (setupGate(state, session.user).kind !== "run" || !state) redirect("/invenstory");
  const [tenant, profile, docs] = await Promise.all([
    getTenant(session.tenantId), getEligibilityProfile(session.tenantId), setupDocs(session.tenantId),
  ]);
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
    />
  );
}
