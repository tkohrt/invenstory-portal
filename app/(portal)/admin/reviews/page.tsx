// Review queues (patch 36): the admin's approve/reject queues on one page.
// Story Intelligence reviews and Ground Truth review were separate nav items
// doing the same kind of job; merged per the 12 Nov admin audit. The coming
// client-requests inbox joins as a third tab. Old /admin/ledger-overlay links
// redirect here.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getPendingReviews, getTenants } from "@/lib/server/data";
import { getOverlayQueue, getOverlayDecided, getLastScoutRun, getQueueDemand } from "@/lib/server/ledger-overlay";
import { needsReviewNow } from "@/lib/trust";
import { clientTenants } from "@/lib/brain";
import AdminReviewsView from "@/components/AdminReviewsView";
import AdminLedgerOverlayView from "@/components/AdminLedgerOverlayView";
import AdminTabs from "@/components/AdminTabs";
import AdminRequestsView from "@/components/AdminRequestsView";
import { getRequests, openRequestCount } from "@/lib/server/requests";
import { getCuratedLists, getCommunityMembers } from "@/lib/server/curated";
import AdminCuratedLists from "@/components/AdminCuratedLists";
import AdminSignals from "@/components/AdminSignals";
import { listSources, recentSignals, heldSignals, sourceScorecards } from "@/lib/server/signals";
import { sourceHealth, awaitingApproval } from "@/lib/signals";

export default async function ReviewQueuesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const sp = await searchParams;
  const tab = sp.tab === "ground-truth" ? "ground-truth" : sp.tab === "requests" ? "requests" : sp.tab === "sources" ? "sources" : "story";

  // All three counts load regardless of tab, so each pill wears its own badge.
  // Sources (patch 64): null when migration 0098 is not applied yet, so the
  // other tabs keep working either way.
  const [pending, queue, reqOpen, sources] = await Promise.all([
    getPendingReviews(), getOverlayQueue(), openRequestCount(), listSources().catch(() => null),
  ]);
  // The badge counts what needs a person: a failing or silent source, or a new sender waiting for approval.
  // Patch 67: who is waiting on each queue entry. The Ground Truth badge
  // counts what needs a person now; a source's entry that no client is
  // waiting on is in the queue and not in the count.
  const demand = await getQueueDemand(queue.map(q => q.id)).catch(() => ({}));
  const sourcesNeed = (sources ?? []).filter(s => {
    const h = sourceHealth(s).state;
    return h === "failing" || h === "quiet" || awaitingApproval(s);
  }).length;

  const tabs = (
    <AdminTabs active={tab} tabs={[
      { key: "story", href: "/admin/reviews", label: "Story Intelligence", badge: pending.length },
      { key: "ground-truth", href: "/admin/reviews?tab=ground-truth", label: "Ground Truth", badge: needsReviewNow(queue, demand) },
      { key: "requests", href: "/admin/reviews?tab=requests", label: "Client requests", badge: reqOpen },
      { key: "sources", href: "/admin/reviews?tab=sources", label: "Sources", badge: sourcesNeed },
    ]} />
  );

  // The Requests inbox (patch 37): the system of record behind the Slack
  // pings. Open items are work; FYIs and the handled list ride beneath.
  if (tab === "requests") {
    const { open, recent } = await getRequests();
    return (
      <div className="rq-page">
        <div className="page-head"><div><h2>Review queues</h2><p>What needs a For Granted decision, in one place.</p></div></div>
        {tabs}
        <AdminRequestsView open={open} recent={recent} />
      </div>
    );
  }

  if (tab === "sources") {
    const [recent, held] = sources ? await Promise.all([recentSignals().catch(() => []), heldSignals().catch(() => [])]) : [[], []];
    const scores = sources ? await sourceScorecards(sources).catch(() => ({})) : {};
    return (
      <div className="rq-page">
        <div className="page-head"><div><h2>Review queues</h2><p>What needs a For Granted decision, in one place.</p></div></div>
        {tabs}
        <AdminSignals sources={sources ?? []} recent={recent} held={held} ready={sources !== null} scores={scores}
          inbox={{ address: process.env.SIGNALS_INBOX?.trim() || null, configured: !!process.env.RESEND_INBOUND_SECRET && !!process.env.SIGNALS_INBOX?.trim() }} />
      </div>
    );
  }

  if (tab === "ground-truth") {
    const [decided, lastRun, tenants, curated, communityClients] = await Promise.all([
      getOverlayDecided(), getLastScoutRun(), getTenants(),
      // Curated list sweeps (P2.5, patch 39). Both reads survive a missing 0087.
      getCuratedLists().catch(() => []), getCommunityMembers().catch(() => []),
    ]);
    // `base` stays empty until the Ledger service client lands (step 2 of the
    // build order): corrections then render as a real side-by-side diff.
    return (
      <div className="rq-page">
        <div className="page-head"><div><h2>Review queues</h2><p>What needs a For Granted decision, in one place.</p></div></div>
        {tabs}
        <AdminCuratedLists lists={curated} clients={communityClients} />
        <AdminLedgerOverlayView queue={queue} decided={decided} lastRun={lastRun} tenants={clientTenants(tenants)} base={{}} demand={demand} />
      </div>
    );
  }

  return (
    <div className="rq-page">
      <div className="page-head"><div><h2>Review queues</h2><p>What needs a For Granted decision, in one place.</p></div></div>
      {tabs}
      <AdminReviewsView pending={pending} />
    </div>
  );
}
