// The Readiness audit moved into the Analysis page as a tab (patch 36, admin
// audit). Kept as a redirect so old links still land somewhere.
import { redirect } from "next/navigation";

export default function ReadinessAuditPage() {
  redirect("/admin/analysis?tab=readiness");
}
