import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { gateFeature } from "@/lib/server/gate";
import { getTenant } from "@/lib/server/data";
import { getCachedMatches } from "@/lib/server/matching";
import { ledgerConfigured, ledgerHealth } from "@/lib/server/ledger";
import FunderMatchesView from "@/components/FunderMatchesView";

export default async function FunderMatchesPage() {
  const session = await getSession();
  if (!session) redirect("/");
  // Hidden for every client by default (workspace.ts, defaultVisible:false);
  // admins always pass so For Granted can run matches on a client's behalf.
  await gateFeature(session.role, session.tenantId, "funder_matches");

  const configured = ledgerConfigured();
  const [tenant, matches, health] = await Promise.all([
    getTenant(session.tenantId),
    getCachedMatches(session.tenantId),
    configured ? ledgerHealth() : Promise.resolve({ ok: false, detail: "Not configured." }),
  ]);

  return (
    <FunderMatchesView
      matches={matches}
      orgName={tenant?.name ?? "this organization"}
      configured={configured}
      health={health}
      isAdmin={session.role === "admin"}
    />
  );
}
