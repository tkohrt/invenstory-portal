// The signals run (patch 64). Mondays and Thursdays at 12:00 UTC. Vercel calls
// this with "Authorization: Bearer <CRON_SECRET>"; without that secret, or
// with the wrong one, nothing runs. Each run: finish any approved mail left
// unread, re-read every watched page that is due (weekly per page), then read
// the Bluesky accounts (patch 65). One
// shared budget of model calls and time covers the whole run; whatever does
// not fit waits for the next one, and says so in the log.
import { NextResponse } from "next/server";
import { runPageWatch, runBluesky, pendingEmail, readHeldEmail, type Budget } from "@/lib/server/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PARSES = 25;
const STOP_AFTER_MS = 240_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const budget: Budget = { parses: MAX_PARSES, stopAt: Date.now() + STOP_AFTER_MS };
  const out: Record<string, unknown> = {};
  try {
    let mail = 0;
    for (const id of await pendingEmail()) {
      if (Date.now() > budget.stopAt || budget.parses <= 0) break;
      await readHeldEmail(id, budget).catch(e => console.error("[signals] pending mail failed", e));
      mail += 1;
    }
    out.mail = mail;
    out.pages = await runPageWatch(budget);
    // Bluesky (patch 65): bring in @forgranted.com's follows, then read each account that is due.
    out.bluesky = await runBluesky(budget);
  } catch (e) {
    // Most likely migration 0098 has not been applied yet.
    console.error("[signals] run failed", e);
    return NextResponse.json({ error: "signals run failed", ...out }, { status: 500 });
  }
  if (budget.parses <= 0) console.error("[signals] the run used its whole parse budget; anything unread waits for the next run");
  return NextResponse.json({ ok: true, parsesLeft: budget.parses, ...out });
}
