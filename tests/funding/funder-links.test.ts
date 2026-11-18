/** The funder's own channels (patch 63): what counts as a funder's account, and what the site check keeps. */
import { describe, expect, it } from "vitest";
import { classifyLink, extractSiteLinks, domainHandle, linksStale } from "@/lib/funder-links";
import { mergeProfile, FACT_FIELDS, PROFILE_FIELDS, provenanceLine, type FieldProvenance } from "@/lib/funder-profile";

describe("which links are a funder's own account", () => {
  it("keeps the account page and tidies it", () => {
    expect(classifyLink("https://www.linkedin.com/company/the-kresge-foundation/?trk=x")).toEqual({ key: "linkedin_url", url: "https://www.linkedin.com/company/the-kresge-foundation" });
    expect(classifyLink("http://twitter.com/kresgefdn")).toEqual({ key: "x_url", url: "https://x.com/kresgefdn" });
    expect(classifyLink("https://x.com/KnightFdn?lang=en")).toEqual({ key: "x_url", url: "https://x.com/KnightFdn" });
    expect(classifyLink("https://bsky.app/profile/kresge.org")).toEqual({ key: "bluesky_url", url: "https://bsky.app/profile/kresge.org" });
    expect(classifyLink("https://www.facebook.com/TheKresgeFoundation/")).toEqual({ key: "facebook_url", url: "https://www.facebook.com/TheKresgeFoundation" });
    expect(classifyLink("https://www.instagram.com/kresgefdn/")).toEqual({ key: "instagram_url", url: "https://www.instagram.com/kresgefdn" });
    expect(classifyLink("https://www.youtube.com/@KresgeFoundation/videos")).toEqual({ key: "youtube_url", url: "https://www.youtube.com/@KresgeFoundation" });
    expect(classifyLink("https://www.youtube.com/channel/UCabc123")).toEqual({ key: "youtube_url", url: "https://www.youtube.com/channel/UCabc123" });
    expect(classifyLink("https://www.facebook.com/profile.php?id=100064")).toEqual({ key: "facebook_url", url: "https://www.facebook.com/profile.php?id=100064" });
  });
  it("refuses share buttons, single posts and personal profiles", () => {
    for (const u of [
      "https://twitter.com/intent/tweet?text=hi", "https://x.com/share?url=x", "https://x.com/kresgefdn/status/123",
      "https://www.facebook.com/sharer/sharer.php?u=x", "https://www.facebook.com/sharer.php?u=x", "https://www.facebook.com/dialog/share",
      "https://www.linkedin.com/shareArticle?mini=true", "https://www.linkedin.com/in/some-person", "https://www.linkedin.com/",
      "https://www.instagram.com/p/Cabc/", "https://www.instagram.com/reel/abc", "https://www.youtube.com/watch?v=abc",
      "https://bsky.app/profile/kresge.org/post/3abc", "https://bsky.app/", "mailto:info@x.org", "javascript:void(0)", "not a url",
      "https://example.org/linkedin.com/company/x",
    ]) expect(classifyLink(u), u).toBeNull();
  });
});

describe("reading a funder's page", () => {
  const PAGE = `<html><head>
    <link rel="alternate" type="application/rss+xml" title="News" href="/feed/">
    <link rel="alternate" type="application/rss+xml" href="/comments/feed/">
    </head><body>
    <article><a href="https://twitter.com/SomeGrantee">a grantee we love</a>
      <a href="https://twitter.com/intent/tweet?url=x">Share</a></article>
    <a href="/newsletter">Sign up for our newsletter</a>
    <a href="/login">Log in to the grantee portal</a>
    <a href="/about/subscribe?unsub=1">Unsubscribe</a>
    <footer>
      <a href="https://twitter.com/ourfdn" aria-label="Twitter"><svg></svg></a>
      <a href="https://x.com/ourfdn"><i class="icon"></i></a>
      <a href='https://www.linkedin.com/company/our-foundation'>LinkedIn</a>
      <a href="https://www.facebook.com/ourfdn">Facebook</a>
      <a href=https://www.instagram.com/ourfdn>Instagram</a>
    </footer></body></html>`;
  const got = extractSiteLinks(PAGE, "https://www.ourfdn.org/about/");
  it("finds each platform's account, the newsletter and the declared feed", () => {
    expect(got).toEqual({
      x_url: "https://x.com/ourfdn",
      linkedin_url: "https://www.linkedin.com/company/our-foundation",
      facebook_url: "https://www.facebook.com/ourfdn",
      instagram_url: "https://www.instagram.com/ourfdn",
      newsletter_url: "https://www.ourfdn.org/newsletter",
      rss_url: "https://www.ourfdn.org/feed/",
    });
  });
  it("the account linked most often wins over one mentioned once in a story", () => {
    expect(got.x_url).toBe("https://x.com/ourfdn");
  });
  it("a hosted sign-up form counts as the newsletter; a login, a donation or an unsubscribe never does", () => {
    const p = `<a href="https://ourfdn.us1.list-manage.com/subscribe?u=1&amp;id=2">Get updates</a><a href="/donate">Donate and subscribe</a><a href="/signin">Sign in</a>`;
    expect(extractSiteLinks(p, "https://ourfdn.org")).toEqual({ newsletter_url: "https://ourfdn.us1.list-manage.com/subscribe?u=1&id=2" });
  });
  it("a page with no recognisable links, or a bad base address, gives nothing", () => {
    expect(extractSiteLinks("<p>Hello</p><a href='/grants'>Grants</a>", "https://ourfdn.org")).toEqual({});
    expect(extractSiteLinks(PAGE, "nope")).toEqual({});
  });
  it("reads the accounts a page declares in its structured data, escaped or not", () => {
    const p = `<script type="application/ld+json">{"@type":"Organization","sameAs":["https:\\/\\/x.com\\/knightfdn","https:\\/\\/bsky.app\\/profile\\/knightfoundation.org","https://www.tiktok.com/@knightfdn","https://www.linkedin.com/company/knight-foundation"]}</script>`;
    expect(extractSiteLinks(p, "https://knightfoundation.org/")).toEqual({
      x_url: "https://x.com/knightfdn", bluesky_url: "https://bsky.app/profile/knightfoundation.org",
      linkedin_url: "https://www.linkedin.com/company/knight-foundation",
    });
  });
  it("another site's newsletter page is not this funder's", () => {
    expect(extractSiteLinks(`<a href="https://other.org/newsletter">Their newsletter</a>`, "https://ourfdn.org")).toEqual({});
  });
});

describe("the Bluesky domain check", () => {
  it("tries the funder's own domain", () => {
    expect(domainHandle("https://www.kresge.org/grants")).toBe("kresge.org");
    expect(domainHandle("fordfoundation.org")).toBe("fordfoundation.org");
  });
  it("never a shared platform, an address, or nonsense", () => {
    for (const w of ["https://www.facebook.com/ourfdn", "https://ourfdn.wordpress.com", "https://sites.google.com/view/x", "http://localhost", "http://10.0.0.1", ""]) expect(domainHandle(w), w).toBeNull();
  });
});

describe("when the site is read again", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  it("never checked, unreadable stamp, or older than 90 days: stale", () => {
    expect(linksStale(undefined, now)).toBe(true);
    expect(linksStale("soon", now)).toBe(true);
    expect(linksStale("2026-08-01T00:00:00Z", now)).toBe(true);
  });
  it("checked within 90 days: left alone", () => {
    expect(linksStale("2026-10-01T00:00:00Z", now)).toBe(false);
  });
});

describe("links on the shared funder profile", () => {
  const prov: FieldProvenance = { how: "funder_site", source_url: "https://ourfdn.org/", at: "2026-11-18T12:00:00.000Z" };
  it("a link files with the site as its source, and a non-address is refused", () => {
    const r = mergeProfile({}, {}, { linkedin_url: "https://www.linkedin.com/company/x", x_url: "javascript:alert(1)", bluesky_url: 7, links_checked_at: prov.at }, prov);
    expect(r.fields).toEqual({ linkedin_url: "https://www.linkedin.com/company/x", links_checked_at: prov.at });
    expect(r.meta.linkedin_url).toEqual(prov);
    expect(provenanceLine(prov)).toContain("From the funder's own website");
  });
  it("a later read that finds less never blanks a link already on file", () => {
    const r = mergeProfile({ x_url: "https://x.com/ourfdn" }, {}, { links_checked_at: "2027-01-01T00:00:00.000Z" }, prov);
    expect(r.fields.x_url).toBe("https://x.com/ourfdn");
  });
  it("links and bookkeeping stay out of the dossier's fact rows", () => {
    expect(FACT_FIELDS.some(f => f.kind === "url" || f.key === "links_checked_at")).toBe(false);
    expect(FACT_FIELDS.length).toBe(PROFILE_FIELDS.length - 9);
  });
});
