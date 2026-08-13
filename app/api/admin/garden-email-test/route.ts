// Admin-only: sends SAMPLE growth + milestone emails to info@forgranted.com for
// review. Real client sending stays disabled until GROWTH_EMAILS_ENABLED=true.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { sendTestGrowthEmails, GROWTH_EMAILS_ENABLED } from "@/lib/server/garden-email";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });
  const r = await sendTestGrowthEmails(session.tenantId);
  return NextResponse.json({ ...r, clientSendingEnabled: GROWTH_EMAILS_ENABLED, note: "Samples sent to info@forgranted.com only." });
}
