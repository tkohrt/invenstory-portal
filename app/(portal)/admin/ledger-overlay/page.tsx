// Ground Truth review moved into the Review queues page (patch 36, admin
// audit). Kept as a redirect so links in earlier Slack messages and build
// notes still land somewhere, same pattern as /admin/usage.
import { redirect } from "next/navigation";

export default function LedgerOverlayPage() {
  redirect("/admin/reviews?tab=ground-truth");
}
