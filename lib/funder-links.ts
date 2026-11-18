// A funder's own channels (patch 63, 18 Nov 2026): the social, newsletter and
// feed links its OWN website publishes. Pure; tested in
// tests/funding/funder-links.test.ts.
//
// Why the funder's site and not a search of each platform by name: the site's
// links are the funder's own statement of which accounts are theirs. A name
// search matches the wrong account often enough to be worse than nothing (the
// 18 Nov Bluesky survey matched the Kellogg Foundation to an unrelated
// organisation on its first pass).

export type LinkKey =
  | "linkedin_url" | "x_url" | "bluesky_url" | "facebook_url" | "instagram_url" | "youtube_url"
  | "newsletter_url" | "rss_url";

export const LINK_LABEL: Record<LinkKey, string> = {
  linkedin_url: "LinkedIn", x_url: "X", bluesky_url: "Bluesky", facebook_url: "Facebook",
  instagram_url: "Instagram", youtube_url: "YouTube", newsletter_url: "Newsletter sign-up", rss_url: "News feed (RSS)",
};

/** Shown to clients, in this order. The feed is a machine address: For Granted's eyes only. */
export const CLIENT_LINKS: LinkKey[] = ["linkedin_url", "x_url", "bluesky_url", "facebook_url", "instagram_url", "youtube_url", "newsletter_url"];
export const ALL_LINKS: LinkKey[] = [...CLIENT_LINKS, "rss_url"];

export type SiteLinks = Partial<Record<LinkKey, string>>;

const decode = (s: string) => s.replace(/&amp;/gi, "&").replace(/&#x2f;/gi, "/").replace(/&#47;/g, "/").replace(/&quot;/gi, '"').replace(/&#39;/g, "'").trim();

/** A path's first segment, lowercased, or "" for the bare host. */
function seg(u: URL, i = 0): string { return (u.pathname.split("/").filter(Boolean)[i] ?? "").toLowerCase(); }

const X_NOT_A_HANDLE = new Set(["intent", "share", "home", "hashtag", "search", "i", "login", "signup", "explore", "settings", "privacy", "tos", "about", "compose", "messages", "notifications"]);
const FB_NOT_A_PAGE = new Set(["sharer", "sharer.php", "share.php", "share", "dialog", "plugins", "tr", "login", "login.php", "help", "policies", "privacy", "events", "groups", "watch", "hashtag", "l.php", "photo.php", "story.php", "permalink.php", "people"]);
const IG_NOT_A_HANDLE = new Set(["p", "reel", "reels", "explore", "accounts", "stories", "tv", "share", "about", "developer", "legal"]);

/**
 * Which platform an address belongs to, and its tidy form: the account's own
 * page, never a share button, a single post, or a personal profile.
 */
export function classifyLink(raw: string): { key: LinkKey; url: string } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, "");
  const first = seg(u), second = seg(u, 1);
  const path = (n: number) => u.pathname.split("/").filter(Boolean).slice(0, n).join("/");
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    // A company, school or showcase page. A person's profile (/in/) is not the funder's channel.
    if ((first === "company" || first === "school" || first === "showcase") && second) return { key: "linkedin_url", url: `https://www.linkedin.com/${path(2)}` };
    return null;
  }
  if (host === "x.com" || host === "twitter.com") {
    if (!first || X_NOT_A_HANDLE.has(first) || !/^[a-z0-9_]{1,15}$/.test(first) || second === "status") return null;
    return { key: "x_url", url: `https://x.com/${path(1)}` };
  }
  if (host === "bsky.app") {
    if (first !== "profile" || !second || seg(u, 2)) return null;
    return { key: "bluesky_url", url: `https://bsky.app/profile/${second}` };
  }
  if (host === "facebook.com" || host === "fb.com") {
    if (!first || FB_NOT_A_PAGE.has(first)) return null;
    if (first === "profile.php") {
      const id = u.searchParams.get("id");
      return id && /^\d+$/.test(id) ? { key: "facebook_url", url: `https://www.facebook.com/profile.php?id=${id}` } : null;
    }
    if (first === "pages" || first === "p") return second ? { key: "facebook_url", url: `https://www.facebook.com/${path(3)}` } : null;
    return { key: "facebook_url", url: `https://www.facebook.com/${path(1)}` };
  }
  if (host === "instagram.com") {
    if (!first || IG_NOT_A_HANDLE.has(first) || !/^[a-z0-9._]{1,30}$/.test(first)) return null;
    return { key: "instagram_url", url: `https://www.instagram.com/${path(1)}` };
  }
  if (host === "youtube.com") {
    if (first.startsWith("@")) return { key: "youtube_url", url: `https://www.youtube.com/${path(1)}` };
    if ((first === "channel" || first === "c" || first === "user") && second) return { key: "youtube_url", url: `https://www.youtube.com/${path(2)}` };
    return null;
  }
  return null;
}

const NEWSLETTER_WORDS = /\b(newsletter|e-?news|subscribe|mailing list|email (updates|list|sign-?up)|sign up for (our |the )?(e-?mail|updates|news)|join our (mailing|email) list|stay (informed|connected|in touch|up to date))\b/i;
const NEWSLETTER_HOSTS = /(^|\.)(list-manage\.com|mailchi\.mp|eepurl\.com|constantcontact\.com|campaign-archive\.com|substack\.com|activehosted\.com|hubspotpagebuilder\.com|salsalabs\.org|e2ma\.net|campaignmonitor\.com|createsend\.com|beehiiv\.com)$/i;
const NOT_A_SIGNUP = /\b(unsubscribe|log ?in|sign ?in|donate|rss)\b/i;

/**
 * The channels a funder's own page links to. `baseUrl` is the page that was
 * read, so relative newsletter and feed links resolve. Each platform keeps the
 * account linked MOST often on the page (a footer link beats one mention in a
 * news item), first seen on a tie.
 */
export function extractSiteLinks(html: string, baseUrl: string): SiteLinks {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return {}; }
  const siteHost = base.hostname.toLowerCase().replace(/^www\./, "");
  const page = html.slice(0, 2_000_000);
  const tally = new Map<string, { key: LinkKey; url: string; n: number; at: number }>();
  const note = (key: LinkKey, url: string, weight = 1) => {
    const k = `${key} ${url.toLowerCase()}`;
    const cur = tally.get(k);
    if (cur) cur.n += weight; else tally.set(k, { key, url, n: weight, at: tally.size });
  };
  const abs = (href: string): URL | null => { try { const u = new URL(decode(href), base); return u.protocol === "https:" || u.protocol === "http:" ? u : null; } catch { return null; } };

  // The page's own declared feed.
  for (const m of page.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?[^"'>]*alternate/i.test(tag) || !/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const u = href && abs(href[1] ?? href[2] ?? href[3] ?? "");
    if (u && !/\/comments\/feed\/?$/i.test(u.pathname)) note("rss_url", u.href.slice(0, 300), 3);
  }

  // The page's structured data: "sameAs" is the site's own declaration of its
  // accounts, and often the only place they appear when the footer is drawn
  // by script. Weighted like three links.
  for (const m of page.matchAll(/"sameAs"\s*:\s*(\[[^\]]{0,4000}\]|"[^"]{0,400}")/gi)) {
    for (const raw of m[1].replace(/\\\//g, "/").matchAll(/https?:\/\/[^"\s\\]+/gi)) {
      const social = classifyLink(raw[0]);
      if (social) note(social.key, social.url, 3);
    }
  }

  for (const m of page.matchAll(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi)) {
    const attrs = m[1];
    const href = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) continue;
    const u = abs(href[1] ?? href[2] ?? href[3] ?? "");
    if (!u) continue;
    const social = classifyLink(u.href);
    if (social) { note(social.key, social.url); continue; }
    const label = `${m[2].replace(/<[^>]+>/g, " ")} ${(attrs.match(/(?:aria-label|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/i) ?? []).slice(1).join(" ")}`.replace(/\s+/g, " ").trim();
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const sameSite = host === siteHost || host.endsWith(`.${siteHost}`);
    if (NOT_A_SIGNUP.test(label)) continue;
    if (NEWSLETTER_HOSTS.test(host) || (sameSite && (NEWSLETTER_WORDS.test(label) || /\/(newsletter|subscribe|e-?news|sign-?up|signup|mailing-list|email-updates|stay-connected)(\/|$|\?)/i.test(u.pathname)))) {
      // A fragment on the page that was read is a form further down it, still a real place to send someone.
      note("newsletter_url", u.href.slice(0, 300), NEWSLETTER_WORDS.test(label) ? 2 : 1);
    }
  }

  const out: SiteLinks = {};
  for (const t of [...tally.values()].sort((a, b) => b.n - a.n || a.at - b.at)) if (!out[t.key]) out[t.key] = t.url;
  return out;
}

/**
 * The name to try as a Bluesky handle: the funder's own domain. A funder that
 * proves its identity on Bluesky does it by using its domain as its handle,
 * so this finds accounts the site does not link yet. Null for a host that is
 * not a funder's own (a page on a shared platform).
 */
export function domainHandle(website: string): string | null {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  // A real name with a lettered ending: never a bare address or a single label.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) return null;
  if (/(^|\.)(facebook\.com|linkedin\.com|x\.com|twitter\.com|instagram\.com|youtube\.com|bsky\.app|bsky\.social|wordpress\.com|wixsite\.com|squarespace\.com|weebly\.com|blogspot\.com|google\.com|github\.io|notion\.site|linktr\.ee|sites\.google\.com)$/.test(host)) return null;
  return host;
}

/** How long a site check stands before the dossier looks again. */
export const LINKS_FRESH_DAYS = 90;

export function linksStale(checkedAt: unknown, now = new Date()): boolean {
  if (typeof checkedAt !== "string") return true;
  const t = Date.parse(checkedAt);
  return !Number.isFinite(t) || now.getTime() - t > LINKS_FRESH_DAYS * 86_400_000;
}
