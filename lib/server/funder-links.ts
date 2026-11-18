import "server-only";
// A funder's own channels (patch 63): read the funder's website once, keep the
// social, newsletter and feed links it publishes on the SHARED funder profile,
// so one read serves every client's dossier. Rules in lib/funder-links.ts.
import { readHtml, Plain } from "./read-url";
import { applyProfileFields, getFunderProfile } from "./funder-profile";
import { extractSiteLinks, domainHandle, withoutHumanSet, type SiteLinks } from "@/lib/funder-links";

/**
 * Does the funder's own domain answer as a Bluesky handle? A fixed public
 * address (Bluesky's own directory), read without signing in. A domain handle
 * is proof of identity on Bluesky: only whoever controls the domain can set it.
 */
async function blueskyByDomain(website: string): Promise<string | null> {
  const handle = domainHandle(website);
  if (!handle) return null;
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
      { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json() as { did?: unknown };
    return typeof j.did === "string" && j.did.startsWith("did:") ? `https://bsky.app/profile/${handle}` : null;
  } catch { return null; }
}

export type LinksLookup =
  | { ok: true; found: SiteLinks; changed: string[] }
  | { ok: false; error: string };

/**
 * Read the funder's site and file what it links to. Always stamps
 * links_checked_at when the site answered, found or not, so a site with no
 * links is not re-read on every visit; a site that could not be read is left
 * unstamped and tried again next time.
 */
export async function lookupFunderLinks(a: { ein: string | null | undefined; funderId: string; website: string; name?: string | null }): Promise<LinksLookup> {
  let page: { html: string; url: string };
  try {
    page = await readHtml(a.website, "Add the links by hand.");
  } catch (e) {
    // Remember the failure, so the dossier does not fetch an unreadable site on every visit.
    const failedAt = new Date().toISOString();
    await applyProfileFields({ ein: a.ein, funderId: a.funderId, incoming: { links_failed_at: failedAt }, prov: { how: "funder_site", source_url: a.website, at: failedAt } });
    return { ok: false, error: e instanceof Plain ? e.message : "The funder's website could not be read." };
  }
  const found = extractSiteLinks(page.html, page.url);
  if (!found.bluesky_url) {
    const b = await blueskyByDomain(page.url);
    if (b) found.bluesky_url = b;
  }
  const at = new Date().toISOString();
  const changed = await applyProfileFields({
    ein: a.ein, funderId: a.funderId,
    // A link a person set by hand or confirmed is never overwritten by a site read.
    incoming: { ...withoutHumanSet(found, ((await getFunderProfile(a.ein, a.funderId).catch(() => null))?.meta ?? {}) as Record<string, { how?: string }>), links_checked_at: at },
    prov: { how: "funder_site", source_url: page.url, at },
  });
  // Patch 65: a funder found to be on Bluesky becomes a source the portal
  // reads, and a suggested follow for @forgranted.com. Best-effort: a missing
  // 0098 or a refused write never costs the dossier its links.
  if (found.bluesky_url) {
    try {
      const { upsertSource } = await import("./signals");
      const { profileKey } = await import("@/lib/funder-profile");
      await upsertSource({
        kind: "bluesky", address: found.bluesky_url, label: (a.name ?? "").trim() || found.bluesky_url.replace(/^.*\/profile\//, ""),
        category: "funder", origin: "dossier", funderKey: profileKey(a.ein, a.funderId),
      });
    } catch (e) { console.error("[funder-links] bluesky source not recorded", e instanceof Error ? e.message : e); }
  }
  return { ok: true, found, changed: changed.filter(k => !k.startsWith("links_")) };
}
