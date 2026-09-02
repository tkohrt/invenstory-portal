"use server";
// Attaching a verification to a grant.
//
// Grants have no name lookup. find_grants is semantic search over an index, not
// resolution: asking it for "Community Recovery Fund" returns things that read
// like that phrase, not that record. A search box pretending otherwise would
// invite exactly the mis-attachment the picker exists to prevent.
//
// So the grant path offers the two things that actually resolve to a real id:
// the client's own recent match results, and the source URL. Both are read from
// our database rather than the Ledger service, which means this path keeps
// working while the service is asleep.
import { getSession } from "./session";
import { db } from "./db";
import { resolveGroundTruthStatus, type GroundTruthStatus, type StatusRow } from "@/lib/ledger-status";
import { GRANT_ID_MAX } from "@/lib/grant-screen";

async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

export interface GrantPickerResult {
  /** The merge key: the id qualifyGrantIds assigned before the merge, cached
   *  verbatim as eligible_grant.grant_id. base_id must be exactly this. */
  base_id: string;
  title: string | null;
  funder: string | null;
  url: string | null;
  /** This client's verdict. Absent on the paste-a-URL path, where there is no
   *  client to have a verdict — see resolveGrantUrlAction. */
  verdict: string | null;
  close_date: string | null;
  matched_at: string | null;
  status: GroundTruthStatus;
  /**
   * Whether we recognise this record at all. False on the paste path when the
   * URL matches nothing we have matched: attaching is still legitimate (most
   * grants a person reads about have never been through a run), but the UI must
   * say so rather than showing a confident-looking attachment to nothing.
   */
  known: boolean;
}

/** A client's most recent match results, newest first. */
export async function listTenantMatchesAction(tenantId: string): Promise<GrantPickerResult[]> {
  await requireAdmin();
  if (!tenantId) return [];

  const { data, error } = await db.from("eligible_grant")
    .select("grant_id, title, funder, url, verdict, close_date, matched_at")
    .eq("tenant_id", tenantId)                       // tenant-scoped by grant_id's owner
    .order("matched_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`match read failed: ${error.message}`);

  const rows = (data ?? []) as {
    grant_id: string; title: string | null; funder: string | null; url: string | null;
    verdict: string; close_date: string | null; matched_at: string;
  }[];
  if (!rows.length) return [];

  const keys = rows.map(r => r.grant_id);
  const statuses = await statusFor(keys);

  return rows.map(r => ({
    base_id: r.grant_id,
    title: r.title, funder: r.funder, url: r.url,
    verdict: r.verdict, close_date: r.close_date, matched_at: r.matched_at,
    status: statuses[r.grant_id] ?? { state: "base" },
    known: true,
  }));
}

/**
 * The paste-a-URL path, for a grant that never came through matching — which is
 * most of them, since a person reading a funder's site is ahead of the index.
 * Returns the same shape so the form treats both paths identically.
 */
export async function resolveGrantUrlAction(url: string): Promise<GrantPickerResult | null> {
  await requireAdmin();
  const u = url.trim().slice(0, GRANT_ID_MAX);
  if (!u) return null;

  // The URL may already be a cached match; if so, name the opportunity rather
  // than showing the reviewer a bare link.
  //
  // Deliberately NOT tenant-filtered: an admin pasting a URL has not chosen a
  // client, and requiring one to identify a public grant page would be a worse
  // form for no privacy gain. So the select names only fields that describe the
  // opportunity itself — title, funder, url. Notably NOT verdict or matched_at:
  // those are per-tenant judgments (verdict is screenGrant's output against one
  // client's eligibility profile), and with no ordering this query returns an
  // arbitrary row, so surfacing them would present one client's assessment as a
  // property of the grant.
  // tenant-safe: admin-only read of opportunity fields; no tenant data returned.
  const { data } = await db.from("eligible_grant")
    .select("grant_id, title, funder, url")
    .eq("grant_id", u).limit(1);

  const hit = (data ?? [])[0] as {
    grant_id: string; title: string | null; funder: string | null; url: string | null;
  } | undefined;

  const statuses = await statusFor([u]);
  return {
    base_id: u,
    title: hit?.title ?? null,
    funder: hit?.funder ?? null,
    url: hit?.url ?? u,
    verdict: null,
    close_date: null,
    matched_at: null,
    status: statuses[u] ?? { state: "base" },
    known: !!hit,
  };
}

/** Ground Truth state for a set of grant keys. */
async function statusFor(keys: string[]): Promise<Record<string, GroundTruthStatus>> {
  // Deliberately NOT filtered by key in the query. Grant keys are source URLs,
  // and PostgREST's in.(a,b,c) / or() filters are comma- and paren-delimited:
  // a URL containing either silently truncates the filter, which would make a
  // pending correction invisible in the one place it must appear. The overlay
  // is For Granted's own curation layer and small by construction, so reading
  // the open and approved grant rows and matching in memory is both safe and
  // cheap.
  //
  // tenant-safe: ledger_overlay is admin-only For Granted IP with no tenant_id
  // (see 0019_ledger_overlay.sql); every caller here is gated by requireAdmin.
  const { data, error } = await db.from("ledger_overlay")
    .select("id, base_id, ein, opportunity_number, status, reviewed_at, app_user:reviewed_by(full_name)")
    .eq("kind", "grant")
    .in("status", ["proposed", "in_review", "approved"])
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw new Error(`overlay status read failed: ${error.message}`);

  const rows: StatusRow[] = ((data ?? []) as unknown as (StatusRow & { app_user: { full_name: string } | null })[])
    .map(r => ({ ...r, reviewer_name: r.app_user?.full_name ?? null }));
  return resolveGroundTruthStatus(keys, rows);
}
