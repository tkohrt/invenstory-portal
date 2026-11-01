import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getDocumentsWithTags, getPrimaryContact, getTenant } from "@/lib/server/data";
import InvenstoryView from "@/components/InvenstoryView";
import { getGaps } from "@/lib/server/eligibility";
import { asksForClient } from "@/lib/server/asks";
import ClientAsks from "@/components/ClientAsks";
import { tenantIsBrain } from "@/lib/server/brain";
import { startSteps as buildStartSteps, showStart } from "@/lib/living-voice";

export default async function InvenstoryPage({ searchParams }: { searchParams: Promise<{ item?: string; brain?: string }> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/");
  // The Brain (Auto-Draft patch 3) has documents only: no readiness, contact or asks.
  const brain = await tenantIsBrain(session.tenantId);
  const [tenant, docs, contact, gapData, asks] = await Promise.all([
    getTenant(session.tenantId),
    getDocumentsWithTags(session.tenantId, session.role !== "admin"),
    brain ? Promise.resolve(null) : getPrimaryContact(session.tenantId),
    brain ? Promise.resolve(null) : getGaps(session.tenantId),
    brain ? Promise.resolve([]) : asksForClient(session.tenantId),
  ]);
  if (!tenant) redirect("/");
  // Getting started (1 Nov 2026): worked out from what is already here, so it
  // costs no reads beyond the page's own. Hidden once done, or by the person.
  const steps = gapData && !brain ? buildStartSteps({
    criticalGaps: gapData.gaps.filter(g => g.tier === "critical").length,
    layerCounts: {
      I: docs.filter(d => d.layer === "I").length,
      II: docs.filter(d => d.layer === "II").length,
      III: docs.filter(d => d.layer === "III").length,
    },
    readinessRun: !!gapData.computedAt,
  }) : null;
  const hidden = (session.user.ui_prefs as { hide_getting_started?: boolean } | null)?.hide_getting_started === true;
  return (
    <InvenstoryView
      tenantId={tenant.id}
      tenantName={tenant.name}
      orgType={tenant.org_type}
      website={tenant.website}
      contactName={contact}
      docs={docs}
      readiness={gapData ? gapData.readiness : undefined}
      readinessComputedAt={gapData ? gapData.computedAt : null}
      isAdmin={session.role === "admin"}
      openItem={sp.item ?? null}
      brain={brain ? { closedPage: sp.brain === "closed" } : null}
      startSteps={steps && showStart(steps, hidden) ? steps : null}
      asks={asks.length ? <ClientAsks asks={asks} isAdmin={session.role === "admin"} tenantName={tenant.name} /> : null}
    />
  );
}
