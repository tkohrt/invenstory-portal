/** Signals (patch 64): sources, their health, the funding gate and the inbox's signature check. */
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/db", () => ({ db: {} }));
vi.mock("@/lib/server/read-url", () => ({ readUrl: vi.fn(), Plain: class extends Error {} }));
vi.mock("@/lib/server/curated", () => ({ parseListText: vi.fn(), fileLeads: vi.fn() }));
import { createHmac } from "node:crypto";
import {
  normalizeAddress, emailSender, textForFingerprint, looksLikeFunding, linksIn, pageDue, sourceHealth, weekListName, freshTimestamp,
  blueskyDue, postSignal, suggestedFollows,
  type SourceRow,
} from "@/lib/signals";
import { verifyWebhook } from "@/lib/server/signals";

const NOW = new Date("2026-11-18T12:00:00Z");
const src = (o: Partial<SourceRow>): SourceRow => ({
  id: "s1", kind: "page", address: "https://x.org/apply", label: "X", category: "funder", active: true, origin: "manual", funder_key: null,
  last_checked_at: null, last_ok_at: null, last_error: null, last_hash: null, last_changed_at: null, last_signal_at: null,
  created_at: "2026-11-10T00:00:00Z", ...o,
});

describe("a source's address", () => {
  it("a page: a real web address, without its fragment", () => {
    expect(normalizeAddress("page", " www.ycombinator.com/apply#top ")).toBe("https://www.ycombinator.com/apply");
    expect(normalizeAddress("page", "https://kresge.org/grants?open=1")).toBe("https://kresge.org/grants?open=1");
    for (const bad of ["", "ftp://x.org", "http://localhost/x", "http://10.0.0.1/", "not an address", "javascript:alert(1)"]) expect(normalizeAddress("page", bad), bad).toBeNull();
  });
  it("a Bluesky account: the handle, however it was pasted", () => {
    expect(normalizeAddress("bluesky", "@Kresge.org")).toBe("kresge.org");
    expect(normalizeAddress("bluesky", "https://bsky.app/profile/nehgov.bsky.social/post/3abc")).toBe("nehgov.bsky.social");
    expect(normalizeAddress("bluesky", "just a name")).toBeNull();
    expect(normalizeAddress("bluesky", "did:plc:abc")).toBeNull();
  });
  it("an email sender: the address inside the From line", () => {
    expect(emailSender('"Knight Foundation" <News@KnightFoundation.org>')).toEqual({ address: "news@knightfoundation.org", name: "Knight Foundation" });
    expect(emailSender("updates@fund.org")).toEqual({ address: "updates@fund.org", name: "fund.org" });
    expect(emailSender("nobody")).toBeNull();
  });
});

describe("has a watched page changed", () => {
  it("clock times, relative dates, the copyright year and spacing do not count as a change", () => {
    const a = textForFingerprint("Applications open   until 5 March.\nUpdated 10:42 AM, 3 days ago. © 2026 The Fund");
    const b = textForFingerprint("Applications open until 5 March. Updated 9:07 PM, 12 hours ago. © 2027 The Fund");
    expect(a).toBe(b);
  });
  it("a moved deadline does", () => {
    expect(textForFingerprint("Applications open until 5 March.")).not.toBe(textForFingerprint("Applications open until 19 March."));
  });
  it("a page is due weekly, and only while it is on", () => {
    expect(pageDue(src({}), NOW)).toBe(true);
    expect(pageDue(src({ last_checked_at: "2026-11-16T12:00:00Z" }), NOW)).toBe(false);
    expect(pageDue(src({ last_checked_at: "2026-11-11T12:00:00Z" }), NOW)).toBe(true);
    expect(pageDue(src({ active: false }), NOW)).toBe(false);
    expect(pageDue(src({ kind: "bluesky" }), NOW)).toBe(false);
  });
});

describe("the funding gate before a model call", () => {
  it("passes funding news", () => {
    for (const t of ["Applications are open for our 2027 cohort", "RFP: youth mentoring evaluation", "Letters of inquiry due March 3", "New grants announced for rural clinics", "We invest up to $150,000 in each startup", "Request for Proposals"]) expect(looksLikeFunding(t), t).toBe(true);
  });
  it("stops everything else", () => {
    for (const t of ["Meet our new board chair", "Our office is closed Thursday", "", "Thanks for subscribing! Please confirm your email."]) expect(looksLikeFunding(t), t).toBe(false);
  });
});

describe("links kept from held mail", () => {
  it("each link once, tidied, capped", () => {
    expect(linksIn("Confirm: https://fund.org/confirm?t=abc. Or (https://fund.org/confirm?t=abc) and http://x.org/a, ok")).toEqual(["https://fund.org/confirm?t=abc", "http://x.org/a"]);
    expect(linksIn(Array.from({ length: 20 }, (_, i) => `https://x.org/${i}`).join(" "))).toHaveLength(8);
    expect(linksIn("no links here")).toEqual([]);
  });
});

describe("source health", () => {
  it("never read: new", () => {
    expect(sourceHealth(src({}), NOW).state).toBe("new");
  });
  it("the last read got no answer: failing, with the reason", () => {
    const h = sourceHealth(src({ last_checked_at: "2026-11-16T12:00:00Z", last_ok_at: "2026-11-09T12:00:00Z", last_error: "That page answered with an error (404)." }), NOW);
    expect(h).toEqual({ state: "failing", why: "That page answered with an error (404)." });
    expect(sourceHealth(src({ last_checked_at: "2026-11-16T12:00:00Z" }), NOW).state).toBe("failing");
  });
  it("answering and recently productive: healthy", () => {
    expect(sourceHealth(src({ last_checked_at: "2026-11-16T12:00:00Z", last_ok_at: "2026-11-16T12:00:00Z", last_signal_at: "2026-11-16T12:00:00Z" }), NOW).state).toBe("ok");
  });
  it("answering but nothing for 45 days: gone quiet", () => {
    const h = sourceHealth(src({ created_at: "2026-08-01T00:00:00Z", last_checked_at: "2026-11-16T12:00:00Z", last_ok_at: "2026-11-16T12:00:00Z", last_signal_at: "2026-09-20T00:00:00Z" }), NOW);
    expect(h.state).toBe("quiet");
    expect(h.why).toContain("59 days");
  });
  it("a newsletter that stopped arriving goes quiet; a new sender is off until approved", () => {
    expect(sourceHealth(src({ kind: "email", origin: "inbox", created_at: "2026-08-01T00:00:00Z", last_signal_at: "2026-09-01T00:00:00Z" }), NOW).state).toBe("quiet");
    const waiting = sourceHealth(src({ kind: "email", origin: "inbox", active: false }), NOW);
    expect(waiting).toEqual({ state: "off", why: "A new sender, waiting for approval." });
  });
});

describe("the week's list", () => {
  it("is named for the Monday of the week, whatever day the signal arrived", () => {
    expect(weekListName(new Date("2026-11-18T12:00:00Z"))).toBe("Signals, week of 16 Nov 2026");
    expect(weekListName(new Date("2026-11-16T00:00:00Z"))).toBe("Signals, week of 16 Nov 2026");
    expect(weekListName(new Date("2026-11-22T23:59:00Z"))).toBe("Signals, week of 16 Nov 2026");
    expect(weekListName(new Date("2026-11-23T00:00:00Z"))).toBe("Signals, week of 23 Nov 2026");
  });
});

describe("the inbox's signature check", () => {
  const key = Buffer.from("a-test-signing-key-32-bytes-long!");
  const secret = `whsec_${key.toString("base64")}`;
  const body = JSON.stringify({ type: "email.received", data: { email_id: "abc-123" } });
  const ts = "1795000000", id = "msg_1";
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  const now = 1795000100;
  it("accepts a correctly signed, fresh delivery, also when several signatures are listed", () => {
    expect(verifyWebhook(secret, { id, timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(true);
    expect(verifyWebhook(secret, { id, timestamp: ts, signature: `v1,AAAA v1,${sig}` }, body, now)).toBe(true);
  });
  it("refuses a changed body, a wrong key, a missing header, or a stale delivery", () => {
    expect(verifyWebhook(secret, { id, timestamp: ts, signature: `v1,${sig}` }, body + " ", now)).toBe(false);
    expect(verifyWebhook(`whsec_${Buffer.from("another-key").toString("base64")}`, { id, timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(verifyWebhook(secret, { id: null, timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(verifyWebhook(secret, { id, timestamp: ts, signature: null }, body, now)).toBe(false);
    expect(verifyWebhook(secret, { id, timestamp: ts, signature: `v1,${sig}` }, body, now + 301)).toBe(false);
    expect(verifyWebhook("", { id, timestamp: ts, signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(verifyWebhook(secret, { id, timestamp: ts, signature: `v2,${sig}` }, body, now)).toBe(false);
  });
  it("a timestamp must be a plain number of seconds", () => {
    expect(freshTimestamp("1795000000", 1795000000)).toBe(true);
    expect(freshTimestamp("soon", 1795000000)).toBe(false);
    expect(freshTimestamp("1795000000.5", 1795000000)).toBe(false);
  });
});

// Patch 65 (18 Nov 2026): the Bluesky reader.
describe("which posts are signals", () => {
  const since = new Date("2026-11-10T00:00:00Z");
  const post = (o: Record<string, unknown> = {}, rec: Record<string, unknown> = {}) => ({
    post: { uri: "at://did:plc:abc/app.bsky.feed.post/3lxyzabc123", author: { handle: "kresge.org" },
      record: { text: "Applications open Dec. 1 for artist fellowships. kresge.org/news", createdAt: "2026-11-17T15:00:00.000Z", ...rec }, ...o },
  });
  it("the account's own new post, with the page its link card points to", () => {
    const p = postSignal(post({ embed: { external: { uri: "https://kresge.org/news-views/fellowships/" } } }), "kresge.org", since);
    expect(p).toEqual({
      uri: "at://did:plc:abc/app.bsky.feed.post/3lxyzabc123", postUrl: "https://bsky.app/profile/kresge.org/post/3lxyzabc123",
      text: "Applications open Dec. 1 for artist fellowships. kresge.org/news", at: "2026-11-17T15:00:00.000Z", link: "https://kresge.org/news-views/fellowships/",
    });
  });
  it("falls back to a link facet, then to an address in the text; a link to another post is not a page", () => {
    expect(postSignal(post({}, { facets: [{ features: [{ $type: "app.bsky.richtext.facet#mention", did: "did:plc:x" }] }, { features: [{ uri: "https://kresge.org/apply" }] }] }), "kresge.org", since)?.link).toBe("https://kresge.org/apply");
    expect(postSignal(post({}, { text: "Apply: https://kresge.org/a." }), "kresge.org", since)?.link).toBe("https://kresge.org/a");
    expect(postSignal(post({ embed: { external: { uri: "https://bsky.app/profile/x.org/post/3abc" } } }, { text: "see thread" }), "kresge.org", since)?.link).toBeNull();
    expect(postSignal(post({}, { text: "no link at all" }), "kresge.org", since)?.link).toBeNull();
  });
  it("a repost, a reply, an older post, or someone else's post is not this account announcing something", () => {
    expect(postSignal({ ...post(), reason: { $type: "app.bsky.feed.defs#reasonRepost" } }, "kresge.org", since)).toBeNull();
    expect(postSignal({ ...post(), reply: { parent: {} } }, "kresge.org", since)).toBeNull();
    expect(postSignal(post({}, { reply: { parent: {} } }), "kresge.org", since)).toBeNull();
    expect(postSignal(post({}, { createdAt: "2026-11-09T00:00:00.000Z" }), "kresge.org", since)).toBeNull();
    expect(postSignal(post({ author: { handle: "someone.else" } }), "kresge.org", since)).toBeNull();
    expect(postSignal(null, "kresge.org", since)).toBeNull();
    expect(postSignal({ post: { uri: "at://x/y/../../etc", record: { createdAt: "2026-11-17T15:00:00.000Z" } } }, "kresge.org", since)).toBeNull();
  });
});

describe("Bluesky sources", () => {
  it("an account is read about twice a week, while it is on", () => {
    expect(blueskyDue(src({ kind: "bluesky" }), NOW)).toBe(true);
    expect(blueskyDue(src({ kind: "bluesky", last_checked_at: "2026-11-16T12:00:00Z" }), NOW)).toBe(false);
    expect(blueskyDue(src({ kind: "bluesky", last_checked_at: "2026-11-15T12:00:00Z" }), NOW)).toBe(true);
    expect(blueskyDue(src({ kind: "bluesky", active: false }), NOW)).toBe(false);
    expect(blueskyDue(src({}), NOW)).toBe(false);
  });
  it("suggested follows: accounts the portal reads that the account does not follow yet, newest first", () => {
    const list = [
      src({ id: "a", kind: "bluesky", address: "kresge.org", origin: "follows" }),
      src({ id: "b", kind: "bluesky", address: "gund.org", origin: "dossier", created_at: "2026-11-12T00:00:00Z" }),
      src({ id: "c", kind: "bluesky", address: "x.org", origin: "manual", created_at: "2026-11-15T00:00:00Z" }),
      src({ id: "d", kind: "bluesky", address: "off.org", origin: "dossier", active: false }),
      src({ id: "e", kind: "page", origin: "manual" }),
    ];
    expect(suggestedFollows(list).map(s => s.id)).toEqual(["c", "b"]);
  });
});
