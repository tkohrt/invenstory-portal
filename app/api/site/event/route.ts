// Anonymous interaction log for forgranted.com (website intake, 0067). The site
// sends events with navigator.sendBeacon as text/plain, so there is no CORS
// preflight and no answer to read. Always 204: this must never get in a
// visitor's way, and a bad request learns nothing.
import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { SITE_EVENTS, cleanProps, clip, corsHeaders } from "@/lib/site-intake";

export const dynamic = "force-dynamic";

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  const headers = corsHeaders(req);
  try {
    const text = await req.text();
    if (text.length > 4000) return new NextResponse(null, { status: 204, headers });
    const body = JSON.parse(text);
    const name = clip(body?.name, 40);
    const visit = clip(body?.vid, 64);
    if (SITE_EVENTS.has(name) && visit.length >= 4) {
      await db.from("site_event").insert({ // tenant-safe: website log, not client data; no tenant_id column
        visit_id: visit,
        name,
        props: cleanProps(body?.props),
        path: clip(body?.path, 200) || null,
        country: req.headers.get("x-vercel-ip-country")?.slice(0, 4) ?? null,
      });
    }
  } catch { /* never in anyone's way */ }
  return new NextResponse(null, { status: 204, headers });
}
