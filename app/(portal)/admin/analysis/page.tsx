// Inven(s)tory Analysis (trial) for the client being viewed. Admin only: Phase A
// runs beside the current reads and changes nothing a client sees.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant } from "@/lib/server/data";
import { getAnalysisTrial } from "@/lib/server/analysis-read";
import { getAnalysisComparison } from "@/lib/server/analysis-compare";
import { latestJob } from "@/lib/server/jobs";
import AnalysisTrialView from "@/components/AnalysisTrialView";
import ReadinessAuditView from "@/components/ReadinessAuditView";
import AdminTabs from "@/components/AdminTabs";
import { tenantIsBrain } from "@/lib/server/brain";
import DocTextPanel from "@/components/DocTextPanel";
import { docTextStatus } from "@/lib/server/doc-text-backfill";
import { previewSwitch } from "@/lib/server/analysis-switch";
import { switchStatus } from "@/lib/server/analysis-source";
import { switchGate, PROVING_TENANT_ID } from "@/lib/analysis-switch";

export default async function AnalysisTrialPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");

  // Patch 36 (admin audit): the Readiness audit moved in here as a tab, so
  // Analysis & readiness is one nav item. Brain tenants have no readiness
  // checklist, so they get no readiness tab.
  const sp = await searchParams;
  const brain = await tenantIsBrain(session.tenantId).catch(() => false);
  const tabs = (active: string) => (
    <AdminTabs active={active} tabs={[
      { key: "trial", href: "/admin/analysis", label: "Analysis (trial)" },
      ...(brain ? [] : [{ key: "readiness", href: "/admin/analysis?tab=readiness", label: "Readiness audit" }]),
    ]} />
  );
  if (sp.tab === "readiness" && !brain) {
    const t = await getTenant(session.tenantId);
    return <div className="rq-page">
      {tabs("readiness")}
      <ReadinessAuditView tenantName={t?.name ?? "this client"} tenantId={session.tenantId} />
    </div>;
  }
  const [tenant, data, job, compare] = await Promise.all([
    getTenant(session.tenantId),
    getAnalysisTrial(session.tenantId),
    latestJob(session.tenantId, "analysis"),
    // Phase B. A failure here never takes the trial page down with it.
    getAnalysisComparison(session.tenantId).then(c => ({ ok: true as const, c })).catch((e: unknown) => ({
      ok: false as const, error: e instanceof Error ? e.message : "The comparison could not be worked out.",
    })),
  ]);
  // Phase D: the switch-over. The gate is worked out from what this page already
  // loaded; the switch action checks it again on the server.
  const [status, preview] = await Promise.all([
    switchStatus(session.tenantId).catch(() => null),
    previewSwitch(session.tenantId).then(p => ({ ok: true as const, p })).catch((e: unknown) => ({
      ok: false as const, error: e instanceof Error ? e.message : "The preview could not be worked out.",
    })),
  ]);
  const proving = session.tenantId === PROVING_TENANT_ID;
  // Document Reader, Phase 0: storing every client's document text. Never takes the page down.
  const docText = await docTextStatus().catch(() => null);
  const gate = status && preview.ok ? switchGate({
    tenantId: session.tenantId, pendingDocs: preview.p.pendingDocs, analysedDocs: preview.p.analysedDocs, proofAt: status.proofAt,
    ...(proving ? {
      review: { passes: data.tally.passes, reviewed: data.tally.reviewed, target: data.tally.target, supportedPct: data.tally.supportedPct },
      compare: compare.ok ? compare.c.readiness.gate : undefined,
    } : {}),
  }) : null;
  return <>
    {tabs("trial")}
    {docText && <DocTextPanel status={docText} />}
    <AnalysisTrialView orgName={tenant?.name ?? "this client"} data={data} job={job} compare={compare}
    switchInfo={{ status, preview, gate, proving }} />
  </>;
}
