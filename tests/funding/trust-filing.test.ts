/**
 * Trust tiers (patch 67): what fileLeads writes. A first-party source's
 * opportunity is published as it is filed; everything else waits; a decision
 * a person already made is never undone by a re-read; and a database without
 * migration 0100 files as it always did.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/llm", () => ({ chatComplete: vi.fn() }));
vi.mock("@/lib/server/eligibility", () => ({ getEligibilityProfile: vi.fn() }));

import { FakeDb, overlayComputed, type Row } from "../helpers/fake-db";
const holder = { db: new FakeDb() };
vi.mock("@/lib/server/db", () => ({ db: { from: (t: string) => holder.db.from(t) } }));
// The switches the tests flip: which migrations the database has, and a dropped connection on the dedupe read.
const state = { has0100: true, has0101: true, failRead: false, get rows(): Row[] { return holder.db.rows("ledger_overlay"); } };
const COLS_0100 = ["published_at", "signal_source_id"], COLS_0101 = ["opp_host", "opp_funder", "also_seen", "update_of"];
const arm = () => {
  holder.db.failOn = q => {
    const text = `${q.cols},${q.filters.join(",")}`;
    if (!state.has0101 && COLS_0101.some(c => text.includes(c))) return { message: "column ledger_overlay.opp_host does not exist" };
    if (!state.has0100 && COLS_0100.some(c => text.includes(c))) return { message: "column ledger_overlay.published_at does not exist" };
    if (state.failRead && q.op === "select" && q.filters.includes("eq:source_url")) return { message: "connection reset" };
    return undefined;
  };
};

import { fileLeads } from "@/lib/server/curated";
import { curatedLeads } from "@/lib/curated";

const leads = (items: { title: string; url: string; kind?: string }[]) =>
  curatedLeads(items.map(i => ({ kind: i.kind ?? "opportunity", money_kind: "grants", title: i.title, url: i.url, funder: "NEH" })), "2026-11-19");
const own = { id: "src-own", kind: "page", trust: "first_party" as const };
const news = { id: "src-news", kind: "bluesky", trust: "review" as const };

beforeEach(() => { holder.db = new FakeDb(); holder.db.computed.ledger_overlay = overlayComputed; state.has0100 = true; state.has0101 = true; state.failRead = false; arm(); });

describe("fileLeads and the trust tier", () => {
  it("publishes a first-party source's opportunity as it files it, still waiting for review", async () => {
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(1);
    const r = state.rows[0];
    expect(r.status).toBe("proposed");
    expect(r.signal_source_id).toBe("src-own");
    expect(typeof r.published_at).toBe("string");
  });
  it("files a review source's opportunity unpublished, under its source", async () => {
    await fileLeads("list1", leads([{ title: "A roundup item", url: "https://news.example/a" }]), null, news);
    expect(state.rows[0].published_at).toBeNull();
    expect(state.rows[0].signal_source_id).toBe("src-news");
  });
  it("files a pasted list exactly as before: no source, nothing published", async () => {
    await fileLeads("list1", leads([{ title: "Pasted", url: "https://funder.example/a" }]), "user1");
    expect(state.rows[0].published_at).toBeNull();
    expect(state.rows[0].signal_source_id).toBeNull();
    expect(state.rows[0].proposed_by).toBe("user1");
  });
  it("never publishes a funder record, even from a first-party source", async () => {
    await fileLeads("list1", leads([{ title: "Cleveland Foundation", url: "https://www.clevelandfoundation.org/grants", kind: "funder" }]), null, own);
    expect(state.rows[0].kind).toBe("funder");
    expect(state.rows[0].published_at).toBeNull();
  });
  it("publishes a waiting signals entry when a first-party source later states it too, in the first-party source's own words", async () => {
    await fileLeads("list1", leads([{ title: "Fellowship (as the roundup put it)", url: "https://kresge.org/f" }]), null, news);
    expect(await fileLeads("list1", leads([{ title: "Kresge Artist Fellowships", url: "https://kresge.org/f" }]), null, own)).toBe(0);
    expect(state.rows).toHaveLength(1);
    expect(typeof state.rows[0].published_at).toBe("string");
    expect(state.rows[0].signal_source_id).toBe("src-own");
    expect(state.rows[0].title).toBe("Kresge Artist Fellowships");
    expect((state.rows[0].fields as { title: string }).title).toBe("Kresge Artist Fellowships");
  });
  it.each(["web_discovery", "manual", "curated_list"])("leaves a waiting entry that came in another way (%s, no source) exactly as it was", async provenance => {
    state.rows.push({ id: "old", kind: "grant", status: "proposed", provenance, curated_list_id: "list0", published_at: null, signal_source_id: null, title: "Theirs", source_url: "https://www.neh.gov/a" });
    await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].published_at).toBeNull();
    expect(state.rows[0].signal_source_id).toBeNull();
    expect(state.rows[0].title).toBe("Theirs");
  });
  it("holds a new entry on a page where this source had the same title rejected under another address", async () => {
    state.rows.push({ id: "old", kind: "grant", status: "rejected", curated_list_id: "list0", published_at: "2026-11-01T00:00:00Z", signal_source_id: "src-own", created_at: new Date().toISOString(),
      title: "Techstars Boulder", fields: { title: "Techstars Boulder" }, source_url: "https://www.techstars.com/accelerators#techstars-boulder-2026-12-01" });
    // Two calls: the parser's own dedupe keys on the page, and it is the filing rule under test here.
    // Since patch 68 the reworded entry is recognised as the rejected one and not filed at all.
    expect(await fileLeads("list1", leads([{ title: "Techstars Boulder Accelerator", url: "https://www.techstars.com/accelerators#techstars-boulder-accelerator-2027-01-15" }]), null, own)).toBe(0);
    expect(await fileLeads("list1", leads([{ title: "Techstars Chicago", url: "https://www.techstars.com/accelerators#techstars-chicago" }]), null, own)).toBe(1);
    expect(state.rows.find(r => r.title === "Techstars Boulder Accelerator")).toBeUndefined();
    const chicago = state.rows.find(r => r.title === "Techstars Chicago")!;
    expect(typeof chicago.published_at).toBe("string");
  });
  it("a rejection binds whichever source the rejected entry came from", async () => {
    state.rows.push({ id: "old", kind: "grant", status: "rejected", curated_list_id: "list0", published_at: null, signal_source_id: "src-news", created_at: new Date().toISOString(),
      title: "Techstars Boulder", fields: { title: "Techstars Boulder" }, source_url: "https://www.techstars.com/accelerators#techstars-boulder" });
    expect(await fileLeads("list1", leads([{ title: "Techstars Boulder Accelerator", url: "https://www.techstars.com/accelerators#techstars-boulder-accelerator" }]), null, own)).toBe(0);
    expect(state.rows).toHaveLength(1);
  });
  it("does not publish a waiting entry because a review source repeats it", async () => {
    await fileLeads("list1", leads([{ title: "Fellowship", url: "https://kresge.org/f" }]), null, news);
    await fileLeads("list1", leads([{ title: "Fellowship", url: "https://kresge.org/f" }]), null, news);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].published_at).toBeNull();
  });
  it.each(["rejected", "approved"])("never touches an entry a person already decided (%s)", async status => {
    state.rows.push({ id: "old", kind: "grant", status, curated_list_id: "list0", published_at: null, signal_source_id: null, source_url: "https://www.neh.gov/a" });
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(0);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].published_at).toBeNull();
    expect(state.rows[0].status).toBe(status);
  });
  it("does not re-stamp an entry that is already published", async () => {
    state.rows.push({ id: "old", kind: "grant", status: "proposed", curated_list_id: "list0", published_at: "2026-11-01T00:00:00Z", signal_source_id: "src-own", source_url: "https://www.neh.gov/a" });
    await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own);
    expect(state.rows[0].published_at).toBe("2026-11-01T00:00:00Z");
  });
  it("files nothing twice when the lookup fails: a failed read is not 'not known'", async () => {
    state.failRead = true;
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(0);
    expect(state.rows).toHaveLength(0);
  });
  it("before migration 0100, files as it always did and publishes nothing", async () => {
    state.has0100 = false; state.has0101 = false;
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(1);
    expect(state.rows).toHaveLength(1);
    expect("published_at" in state.rows[0]).toBe(false);
    // And a second read does not duplicate it.
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(0);
    expect(state.rows).toHaveLength(1);
  });
});
