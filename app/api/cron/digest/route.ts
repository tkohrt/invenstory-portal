// The Monday digest, sent by the weekly schedule in vercel.json (client
// activity, patch 3). Vercel calls this with "Authorization: Bearer
// <CRON_SECRET>"; without that secret set, or with the wrong one, nothing is
// sent. The schedule runs twice on Monday morning: the second run sends only
// if the first did not get through.
import { NextResponse } from "next/server";
import { gatherDigest, sendDigest } from "@/lib/server/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const sent = await sendDigest(await gatherDigest(new Date()), { once: true });
  return NextResponse.json(sent);
}
