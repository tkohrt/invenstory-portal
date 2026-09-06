import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getCachedMatches, getCachedFunders } from "@/lib/server/matching";
import { ledgerConfigured, ledgerHealth } from "@/lib/server/ledger";
import { getContactsForEins } from "@/lib/server/funder-contacts";
import { getEligibilityProfile } from "@/lib/server/eligibility";
import { getSearchProfile } from "@/lib/server/search-profile-read";
import { getLastRunQueries } from "@/lib/server/matching";
import FunderMatchesView from "@/components/FunderMatchesView";

export default async function FunderMatchesPage() {
  const session = await getSession();
  if (!session) redirect("/");
  // Hidden for every client by default (workspace.ts, defaultVisible:false);
  // admins always pass so For Granted can run matches on a client's behalf.
  await gateFeature(session.role, session.tenantId, "funder_matches");

  const configured = ledgerConfigured();
  const [tenant, matches, funders, eligibility, health] = await Promise.all([
    getTenant(session.tenantId),
    getCachedMatches(session.tenantId),
    getCachedFunders(session.tenantId),
    getEligibilityProfile(session.tenantId).catch(() => null),
    configured ? ledgerHealth() : Promise.resolve({ ok: false, detail: "Not configured." }),
  ]);

  // Contacts are For Granted's own working knowledge and never reach a client
  // screen, so they are fetched only for an admin session. A client's page does
  // not merely hide them; it never loads them.
  const isAdmin = session.role === "admin";
  // The Search Profile and the query text are For Granted's working view. A
  // client session never loads them rather than loading and hiding them.
  const [contacts, profile, lastQueries] = isAdmin
    ? await Promise.all([
        getContactsForEins(funders.map(f => f.ein ?? "").filter(Boolean)),
        getSearchProfile(session.tenantId).catch(() => null),
        getLastRunQueries(session.tenantId).catch(() => []),
      ])
    : [{}, null, []];

  return (
    <FunderMatchesView
      matches={matches}
      funders={funders}
      orgName={tenant?.name ?? "this organization"}
      configured={configured}
      health={health}
      contacts={contacts}
      eligibility={eligibility}
      profile={profile}
      lastQueries={lastQueries}
      isAdmin={isAdmin}
    />
  );
}
