// The forgranted.com Interest Cart (website intake, 0067). A visitor's name,
// organization, email and the cards they chose: stored, then sent to Slack and
// info@forgranted.com. The site posts text/plain JSON (no CORS preflight) and
// reads only whether it worked.
import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { notifySiteInterest } from "@/lib/server/notify";
import { SITE_CARDS, clip, corsHeaders, looksLikeEmail } from "@/lib/site-intake";

export const dynamic = "force-dynamic";

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  const headers = corsHeaders(req);
  const answer = (status: number, ok: boolean) => NextResponse.json({ ok }, { status, headers });
  try {
    const text = await req.text();
    if (text.length > 6000) return answer(413, false);
    const body = JSON.parse(text);

    // The hidden "website" field is only ever filled in by bots. Say yes, keep nothing.
    if (clip(body?.website, 200)) return answer(200, true);

    const name = clip(body?.name, 120);
    const org = clip(body?.org, 160);
    const email = clip(body?.email, 200).toLowerCase();
    const cards = Array.isArray(body?.cards)
      ? [...new Set((body.cards as unknown[]).filter((c): c is string => typeof c === "string" && c in SITE_CARDS))].slice(0, 12)
      : [];
    if (!name || !org || !looksLikeEmail(email) || cards.length === 0) return answer(400, false);

    // The same email sending again within ten minutes is a double click, not a new lead.
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: recent } = await db.from("site_interest").select("id") // tenant-safe: website intake, not client data
      .eq("email", email).gte("created_at", since).limit(1);
    if ((recent ?? []).length > 0) return answer(200, true);

    const visit = clip(body?.vid, 64) || null;
    const { error } = await db.from("site_interest").insert({ visit_id: visit, name, org, email, cards }); // tenant-safe: website intake, not client data
    if (error) return answer(500, false);

    if (visit) {
      await db.from("site_event").insert({ visit_id: visit, name: "cart_submit", props: { cards: cards.length } }); // tenant-safe: website log, not client data
    }
    await notifySiteInterest({ name, org, email, cards: cards.map(c => SITE_CARDS[c]) });
    return answer(200, true);
  } catch {
    return answer(400, false);
  }
}
