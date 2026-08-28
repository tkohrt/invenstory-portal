import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getOverlayQueue, getOverlayDecided, getLastScoutRun } from "@/lib/server/ledger-overlay";
import AdminLedgerOverlayView from "@/components/AdminLedgerOverlayView";

export default async function LedgerOverlayPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");

  const [queue, decided, lastRun] = await Promise.all([
    getOverlayQueue(), getOverlayDecided(), getLastScoutRun(),
  ]);

  // `base` stays empty until the Ledger service client lands (step 2 of the
  // build order: lib/server/ledger.ts + GET /funder|/grant). Corrections then
  // render as a real side-by-side diff instead of proposed values alone.
  return <AdminLedgerOverlayView queue={queue} decided={decided} lastRun={lastRun} base={{}} />;
}
