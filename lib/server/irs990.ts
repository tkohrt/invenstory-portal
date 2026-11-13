import "server-only";
// The 990 importer (patch 42): one HTTP call to ProPublica's Nonprofit
// Explorer API (free, keyed by EIN, built on IRS e-file data). No AI spend.
// "none" (no such EIN on file) is a different answer from "error" (the service
// could not be reached), because the UI promises different things for each:
// none offers the manual upload or a skip; error offers a retry.
import { parseProPublica, type Org990 } from "@/lib/irs990";

export type Fetch990Result = { status: "found"; org: Org990 } | { status: "none" } | { status: "error" };

export async function fetch990(ein: string): Promise<Fetch990Result> {
  try {
    const res = await fetch(`https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (res.status === 404) return { status: "none" };
    if (!res.ok) return { status: "error" };
    const org = parseProPublica(await res.json(), ein);
    return org ? { status: "found", org } : { status: "none" };
  } catch {
    return { status: "error" };
  }
}
