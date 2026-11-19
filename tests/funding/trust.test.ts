/** Trust tiers (patch 67): who publishes with a label, what a client may see, and the queue's order. */
import { describe, expect, it } from "vitest";
import {
  defaultTrust, canBeFirstParty, publishes, standing, followStanding, band, bandQueue, demandLine, demandScore,
  needsReviewNow, isTrust, NO_DEMAND, type Demand,
} from "@/lib/trust";
import { followRow } from "@/lib/following";

const fp = { trust: "first_party", kind: "page" };
const grant = { kind: "grant", title: "Collections Stewardship", source_url: "https://www.neh.gov/program/x" };

describe("defaultTrust", () => {
  it("starts a hand-added funder or accelerator page as first-party", () => {
    expect(defaultTrust({ kind: "page", category: "funder", origin: "manual" })).toBe("first_party");
    expect(defaultTrust({ kind: "page", category: "accelerator", origin: "manual" })).toBe("first_party");
  });
  it("starts every Bluesky account in review, however it arrived: a person says whose it is", () => {
    expect(defaultTrust({ kind: "bluesky", category: "funder", origin: "dossier" })).toBe("review");
    expect(defaultTrust({ kind: "bluesky", category: "funder", origin: "follows" })).toBe("review");
    expect(defaultTrust({ kind: "bluesky", category: "funder", origin: "manual" })).toBe("review");
    expect(defaultTrust({ kind: "page", category: "funder", origin: "dossier" })).toBe("review");
  });
  it("never starts mail, an aggregator or a procurement portal as first-party", () => {
    expect(defaultTrust({ kind: "email", category: "funder", origin: "inbox" })).toBe("review");
    expect(defaultTrust({ kind: "page", category: "aggregator", origin: "manual" })).toBe("review");
    expect(defaultTrust({ kind: "page", category: "rfp", origin: "manual" })).toBe("review");
  });
  it("knows what can be first-party at all", () => {
    expect(canBeFirstParty("page")).toBe(true);
    expect(canBeFirstParty("bluesky")).toBe(true);
    expect(canBeFirstParty("email")).toBe(false);
    expect(canBeFirstParty("page", "funder")).toBe(true);
    expect(canBeFirstParty("bluesky", "accelerator")).toBe(true);
    expect(canBeFirstParty("bluesky", "aggregator")).toBe(false);
    expect(canBeFirstParty("page", "rfp")).toBe(false);
    expect(isTrust("first_party")).toBe(true);
    expect(isTrust("trusted")).toBe(false);
  });
});

describe("publishes", () => {
  it("publishes an opportunity with a title and a link from a first-party page or account", () => {
    expect(publishes(fp, grant)).toBe(true);
    expect(publishes({ trust: "first_party", kind: "bluesky" }, grant)).toBe(true);
  });
  it("holds everything from a review source, an unknown tier, or no source", () => {
    expect(publishes({ trust: "review", kind: "page" }, grant)).toBe(false);
    expect(publishes({ trust: null, kind: "page" }, grant)).toBe(false);
    expect(publishes({ kind: "page" }, grant)).toBe(false);
    expect(publishes(null, grant)).toBe(false);
  });
  it("never publishes mail, even when the sender's row says first-party", () => {
    expect(publishes({ trust: "first_party", kind: "email" }, grant)).toBe(false);
  });
  it("holds a funder record: it changes the shared funder profile", () => {
    expect(publishes(fp, { ...grant, kind: "funder" })).toBe(false);
  });
  it("holds an entry with no title or no real link", () => {
    expect(publishes(fp, { ...grant, title: "  " })).toBe(false);
    expect(publishes(fp, { ...grant, source_url: "" })).toBe(false);
    expect(publishes(fp, { ...grant, source_url: "curated:abc:1:0" })).toBe(false);
    expect(publishes(fp, { ...grant, source_url: "javascript:alert(1)" })).toBe(false);
  });
});

describe("standing", () => {
  const at = "2026-11-19T12:00:00Z";
  it("shows an approved entry as reviewed, published or not", () => {
    expect(standing({ status: "approved" })).toBe("reviewed");
    expect(standing({ status: "approved", published_at: at })).toBe("reviewed");
  });
  it("shows a waiting entry only when published, and then as unreviewed", () => {
    expect(standing({ status: "proposed", published_at: at })).toBe("unreviewed");
    expect(standing({ status: "in_review", published_at: at })).toBe("unreviewed");
    expect(standing({ status: "proposed", published_at: null })).toBe("hidden");
    expect(standing({ status: "proposed" })).toBe("hidden");
  });
  it("hides a rejected or superseded entry even though it was published", () => {
    expect(standing({ status: "rejected", published_at: at })).toBe("hidden");
    expect(standing({ status: "superseded", published_at: at })).toBe("hidden");
  });
  it("tells a follower where a kept entry stands", () => {
    expect(followStanding({ status: "proposed", published_at: at })).toBe("unreviewed");
    expect(followStanding({ status: "rejected", published_at: at })).toBe("withdrawn");
    expect(followStanding({ status: "approved", published_at: at })).toBeNull();
    expect(followStanding(null)).toBeNull();
  });
  it("puts the standing on a followed grant's row and on nothing else", () => {
    const base = { target_id: "x", title: "T", detail: {}, saved_at: at };
    expect(followRow({ ...base, kind: "grant", standing: "unreviewed" }).standing).toBe("unreviewed");
    expect(followRow({ ...base, kind: "grant" }).standing).toBeNull();
    expect(followRow({ ...base, kind: "funder", standing: "unreviewed" }).standing).toBeNull();
    expect(followRow({ ...base, kind: "rfp", standing: "withdrawn" }).standing).toBeNull();
  });
});

describe("the queue by who is waiting", () => {
  const d = (p: Partial<Demand>): Demand => ({ ...NO_DEMAND, ...p });
  const row = (id: string, o: { src?: boolean; pub?: boolean; at?: string } = {}) => ({
    id, created_at: o.at ?? "2026-11-19T12:00:00Z", signal_source_id: o.src ? "s1" : null, published_at: o.pub ? "2026-11-19T12:00:00Z" : null,
  });
  it("keeps everything that did not come from a source in the ordinary band", () => {
    expect(band(row("a"))).toBe("standard");
  });
  it("puts a source's entry nobody is waiting on in a folded band", () => {
    expect(band(row("a", { src: true }))).toBe("quiet");
    expect(band(row("a", { src: true, pub: true }))).toBe("live");
  });
  it("moves any entry a client is waiting on to the top", () => {
    expect(band(row("a", { src: true }), d({ matched: 1 }))).toBe("wanted");
    expect(band(row("a", { src: true, pub: true }), d({ followed: 1 }))).toBe("wanted");
    expect(band(row("a"), d({ asked: 1 }))).toBe("wanted");
  });
  it("ranks asked above followed above matched", () => {
    expect(demandScore(d({ asked: 1 }))).toBeGreaterThan(demandScore(d({ followed: 9 })));
    expect(demandScore(d({ followed: 1 }))).toBeGreaterThan(demandScore(d({ matched: 9 })));
  });
  it("orders the bands and the rows inside them", () => {
    const rows = [row("quiet", { src: true }), row("std-old", { at: "2026-11-01T00:00:00Z" }), row("std-new"), row("live", { src: true, pub: true }),
      row("fits", { src: true }), row("asked", { src: true, pub: true })];
    const q = bandQueue(rows, { fits: d({ matched: 2 }), asked: d({ asked: 1 }) });
    expect(q.map(b => b.band)).toEqual(["wanted", "standard", "live", "quiet"]);
    expect(q[0].rows.map(r => r.id)).toEqual(["asked", "fits"]);
    expect(q[1].rows.map(r => r.id)).toEqual(["std-new", "std-old"]);
  });
  it("leaves out empty bands", () => {
    expect(bandQueue([row("a")], {}).map(b => b.band)).toEqual(["standard"]);
    expect(bandQueue([], {})).toEqual([]);
  });
  it("counts for the badge only what needs a person now", () => {
    const rows = [row("quiet", { src: true }), row("std"), row("live", { src: true, pub: true }), row("fits", { src: true })];
    expect(needsReviewNow(rows, { fits: d({ matched: 1 }) })).toBe(2);
    expect(needsReviewNow(rows, {})).toBe(1);
  });
  it("says who is waiting in a sentence", () => {
    expect(demandLine(NO_DEMAND)).toBeNull();
    expect(demandLine(d({ matched: 1 }))).toBe("fits 1 client");
    expect(demandLine(d({ asked: 1, followed: 2, matched: 3 }))).toBe("1 client asked for a draft, 2 clients follow it, fits 3 clients");
  });
});
