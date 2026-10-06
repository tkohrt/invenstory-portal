import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { gatherDigest, APP_URL } from "@/lib/server/digest";
import { renderDigest, weekLabel } from "@/lib/digest";
import DigestPreview from "@/components/DigestPreview";

export const dynamic = "force-dynamic";

// Admin, All Clients, Monday digest: what Monday's email and Slack message say
// right now, when it was last sent, and a button to send it now.
export default async function DigestPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const data = await gatherDigest(new Date());
  const { subject, html, slack } = renderDigest(data, APP_URL);
  const { data: sends } = await db.from("audit_log").select("detail, created_at").eq("action", "weekly_digest").order("created_at", { ascending: false }).limit(8);  // tenant-safe: For Granted's own digest record, not client data
  return (
    <DigestPreview
      week={weekLabel(data.weekStart, data.weekEnd)} subject={subject} html={html} slack={slack}
      ready={{ email: !!process.env.RESEND_API_KEY, slack: !!process.env.SLACK_ADMIN_WEBHOOK_URL, schedule: !!process.env.CRON_SECRET }}
      sends={((sends ?? []) as { detail: string; created_at: string }[]).map(r => ({
        at: r.created_at, manual: r.detail.includes(" manual"),
        email: r.detail.includes("email=true"), slack: r.detail.includes("slack=true"),
      }))}
    />
  );
}
