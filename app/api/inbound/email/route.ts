// The signals inbox (patch 64): Resend Inbound calls this when mail arrives at
// the signals address. The request must carry Resend's webhook signature
// (RESEND_INBOUND_SECRET); anything unsigned, stale or mis-signed is refused
// before a byte of it is used. The webhook carries metadata only: the body is
// fetched from Resend by id. Mail from a sender For Granted has not approved
// is held unread. See lib/server/signals.ts.
import { NextResponse } from "next/server";
import { verifyWebhook, ingestEmail } from "@/lib/server/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) return NextResponse.json({ error: "The signals inbox is not set up." }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 200_000) return NextResponse.json({ error: "Too large." }, { status: 413 });
  const ok = verifyWebhook(secret, {
    id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature"),
  }, raw);
  if (!ok) return NextResponse.json({ error: "Not allowed." }, { status: 401 });

  let event: { type?: unknown; data?: { email_id?: unknown } };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Not JSON." }, { status: 400 }); }
  // Other event types (delivery receipts for the portal's own mail) are not ours: accept and ignore.
  if (event.type !== "email.received" || typeof event.data?.email_id !== "string") return NextResponse.json({ ok: true, ignored: true });

  try {
    // One model call at most per email, and a short clock: the service retries a slow answer.
    const r = await ingestEmail(event.data.email_id, { parses: 1, stopAt: Date.now() + 90_000 });
    // A fetch that failed is answered 500 so the service delivers it again.
    if (!r.ok) return NextResponse.json({ error: r.reason ?? "could not take the email in" }, { status: 500 });
    return NextResponse.json({ ok: true, status: r.status ?? null, note: r.reason ?? null });
  } catch (e) {
    console.error("[signals] inbound failed", e);
    return NextResponse.json({ error: "could not take the email in" }, { status: 500 });
  }
}
