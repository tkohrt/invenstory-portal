// AI usage now lives with each client's activity (Admin, All Clients). Kept as a
// redirect so links in earlier emails and Slack messages still land somewhere.
import { redirect } from "next/navigation";

export default function AdminUsagePage() {
  redirect("/admin/clients");
}
