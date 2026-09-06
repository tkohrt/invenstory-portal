// The parent loading.tsx would otherwise cover this route, showing a list
// skeleton where a single draft is about to render.
import { TableSkeleton } from "@/components/Busy";

export default function Loading() {
  return (
    <div>
      <div className="page-head"><div><h2>Opening draft</h2></div></div>
      <TableSkeleton rows={3} cols={1} />
    </div>
  );
}
