// The signals run (patch 64). Mondays and Thursdays at 12:00 UTC. Vercel calls
// this with "Authorization: Bearer <CRON_SECRET>"; without that secret, or
// with the wrong one, nothing runs. Each run: finish any approved mail left
// unread, re-read every watched page that is due (weekly per page), then read
// the Bluesky accounts (patch 65). One
// shared budget of model calls and time covers the whole run; whatever does
// not fit waits for the next one, and says so in the log. Last, since patch
// 67, every client with Funding on is screened against what was filed.
import { NextResponse } from "next/server";
import { runPageWatch, runBluesky, pendingEmail, readHeldEmail, type Budget } from "@/lib/server/signals";
import { sweepSignalEntries, expireSignalEntries } from "@/lib/server/curated";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PARSES = 25;
const STOP_AFTER_MS = 240_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const started = Date.now();
  const budget: Budget = { parses: MAX_PARSES, stopAt: started + STOP_AFTER_MS };
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
    // What earlier runs filed is still screened for clients, so one bad read does not also cost a run's matching.
    out.matched = await sweepSignalEntries(started + 285_000).catch(() => null);
    return NextResponse.json({ error: "signals run failed", ...out }, { status: 500 });
  }
  if (budget.parses <= 0) console.error("[signals] the run used its whole parse budget; anything unread waits for the next run");
  // Patch 67, widened in 68: screen every client with Funding on against what the sources produced (no
  // model calls), so a published opportunity reaches the clients it fits and
  // the review queue knows which waiting entries a client is waiting on. Runs
  // in the time left before the function's limit; what does not fit is
  // finished by the next run. A failure here never fails the read above.
  // Patch 69: waiting entries whose deadline has passed close themselves first.
  out.closed = await expireSignalEntries().catch(e => { console.error("[signals] expiry failed", e); return null; });
  out.matched = await sweepSignalEntries(started + 285_000).catch(e => { console.error("[signals] client screen failed", e); return null; });
  return NextResponse.json({ ok: true, parsesLeft: budget.parses, ...out });
}
