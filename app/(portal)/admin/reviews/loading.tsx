import { TableSkeleton } from "@/components/Busy";

export default function Loading() {
  return (
    <div>
      <div className="page-head"><div><h2>Review queues</h2></div></div>
      <TableSkeleton rows={5} />
    </div>
  );
}
