// Review queues (patch 36): the admin's approve/reject queues on one page.
// Story Intelligence reviews and Ground Truth review were separate nav items
// doing the same kind of job; merged per the 12 Nov admin audit. The coming
// client-requests inbox joins as a third tab. Old /admin/ledger-overlay links
// redirect here.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getPendingReviews, getTenants } from "@/lib/server/data";
import { getOverlayQueue, getOverlayDecided, getLastScoutRun } from "@/lib/server/ledger-overlay";
import { clientTenants } from "@/lib/brain";
import AdminReviewsView from "@/components/AdminReviewsView";
import AdminLedgerOverlayView from "@/components/AdminLedgerOverlayView";
import AdminTabs from "@/components/AdminTabs";
import AdminRequestsView from "@/components/AdminRequestsView";
import { getRequests, openRequestCount } from "@/lib/server/requests";
import { getCuratedLists, getCommunityMembers } from "@/lib/server/curated";
import AdminCuratedLists from "@/components/AdminCuratedLists";

export default async function ReviewQueuesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const sp = await searchParams;
  const tab = sp.tab === "ground-truth" ? "ground-truth" : sp.tab === "requests" ? "requests" : "story";

  // All three counts load regardless of tab, so each pill wears its own badge.
  const [pending, queue, reqOpen] = await Promise.all([getPendingReviews(), getOverlayQueue(), openRequestCount()]);

  const tabs = (
    <AdminTabs active={tab} tabs={[
      { key: "story", href: "/admin/reviews", label: "Story Intelligence", badge: pending.length },
      { key: "ground-truth", href: "/admin/reviews?tab=ground-truth", label: "Ground Truth", badge: queue.length },
      { key: "requests", href: "/admin/reviews?tab=requests", label: "Client requests", badge: reqOpen },
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
        <AdminLedgerOverlayView queue={queue} decided={decided} lastRun={lastRun} tenants={clientTenants(tenants)} base={{}} />
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
