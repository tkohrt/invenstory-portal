import "server-only";
// Client for the Funder Ledger service.
//
// The Ledger is its own read-only service the portal CALLS; it never lives in
// the portal database. The deployed app exposes a single POST /api/tool
// endpoint that proxies a fixed set of MCP tools, so this module speaks that
// shape rather than inventing endpoints the service doesn't have.
//
// Two env vars, both optional. With FUNDER_LEDGER_URL unset the whole feature
// reports "not configured" and every caller degrades gracefully — the portal
// must build and deploy fine with no Ledger behind it.
//   FUNDER_LEDGER_URL  e.g. https://funder-ledger.example.com  (no trailing slash)
//   FUNDER_LEDGER_KEY  the shared secret; sent as the x-ledger-key header

import type { FunderCard, GrantCard, LedgerEnvelope } from "@/lib/ledger-types";
export { LEDGER_AS_OF } from "@/lib/ledger-types";
export type { FunderCard, GrantCard, LedgerEnvelope } from "@/lib/ledger-types";

// The service naps when idle and loads models on the first query after a cold
// start; its own upstream timeout is 150s, so anything shorter here would time
// out on exactly the request we most want to succeed.
const TIMEOUT_MS = 150_000;

export type LedgerTool =
  | "find_funders" | "find_grants" | "funders_who_fund_orgs_like_mine"
  | "get_funder" | "similar_funders" | "lookup_funder";

export function ledgerConfigured(): boolean {
  return !!process.env.FUNDER_LEDGER_URL;
}

export class LedgerUnavailable extends Error {}

async function callTool<T>(tool: LedgerTool, args: Record<string, unknown>): Promise<LedgerEnvelope<T>> {
  const base = process.env.FUNDER_LEDGER_URL;
  if (!base) throw new LedgerUnavailable("FUNDER_LEDGER_URL is not set");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env.FUNDER_LEDGER_KEY;
  if (key) headers["x-ledger-key"] = key;

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/api/tool`, {
      method: "POST", headers, body: JSON.stringify({ tool, args }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    // A napping free-tier host looks exactly like this on the first hit.
    throw new LedgerUnavailable(
      e instanceof Error && e.name === "TimeoutError"
        ? "The Ledger did not answer in time. It may have been asleep; try again."
        : "Could not reach the Ledger service.",
    );
  }

  if (res.status === 401) throw new LedgerUnavailable("The Ledger rejected our key (check FUNDER_LEDGER_KEY).");
  if (!res.ok) throw new LedgerUnavailable(`The Ledger returned HTTP ${res.status}.`);

  const body = await res.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: string } | null;
  if (!body || body.ok === false) throw new LedgerUnavailable(body?.error || "The Ledger returned an unusable response.");

  const data = body.data;
  // The tools return either a bare array or an envelope with `results`.
  if (Array.isArray(data)) return { results: data as T[] };
  const env = (data ?? {}) as Record<string, unknown>;
  const results = (env.results ?? env.funders ?? env.grants ?? []) as T[];
  return {
    results: Array.isArray(results) ? results : [],
    as_of: env.as_of as string | undefined,
    verify: env.verify as string | undefined,
    note: env.note as string | undefined,
    suggestions: env.suggestions as string[] | undefined,
  };
}

export function findGrants(args: {
  need: string; open_only?: boolean; deadline_before?: string;
  min_award?: number; max_award?: number; limit?: number;
}) { return callTool<GrantCard>("find_grants", { open_only: true, limit: 15, ...args }); }

export function findFunders(args: {
  need: string; location?: string; grant_size?: number;
  funder_type?: string; grantmakers_only?: boolean; limit?: number;
}) { return callTool<FunderCard>("find_funders", { grantmakers_only: true, limit: 12, ...args }); }

/** The graph differentiator: funders already writing checks to orgs like this one. */
export function fundersLikeMine(args: {
  org_description?: string; peer_orgs?: string[]; location?: string; limit?: number;
}) { return callTool<FunderCard>("funders_who_fund_orgs_like_mine", { limit: 10, ...args }); }

export function getFunder(ein: string) { return callTool<FunderCard>("get_funder", { ein }); }

/** Liveness probe for the admin panel. Cheap and safe to call on page load. */
export async function ledgerHealth(): Promise<{ ok: boolean; detail: string }> {
  const base = process.env.FUNDER_LEDGER_URL;
  if (!base) return { ok: false, detail: "No FUNDER_LEDGER_URL configured." };
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/health`, {
      signal: AbortSignal.timeout(8_000), cache: "no-store",
    });
    if (!res.ok) return { ok: false, detail: `Health check returned HTTP ${res.status}.` };
    return { ok: true, detail: "Reachable." };
  } catch {
    // Not fatal: the free tier sleeps, and the first real query wakes it.
    return { ok: false, detail: "No answer yet — the service may be asleep. A search will wake it." };
  }
}
