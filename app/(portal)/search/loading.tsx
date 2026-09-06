// Shown while this page's data loads, so a slow first paint reads as working
// rather than as an empty screen.
//
// The heading is the page's real one. A generic "Loading…" that is replaced by
// a different title on paint makes the page appear to change identity.
import { TableSkeleton } from "@/components/Busy";

export default function Loading() {
  return (
    <div>
      <div className="page-head"><div><h2>Search</h2></div></div>
      <TableSkeleton rows={6} />
    </div>
  );
}
