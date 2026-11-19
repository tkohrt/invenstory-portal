/**
 * One opportunity, one entry (patch 68): what filing does with a second
 * sighting of an opportunity already on file at another address.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "../helpers/fake-db";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/llm", () => ({ chatComplete: vi.fn() }));
vi.mock("@/lib/server/eligibility", () => ({ getEligibilityProfile: vi.fn() }));
const holder = { db: new FakeDb() };
vi.mock("@/lib/server/db", () => ({ db: { from: (t: string) => holder.db.from(t) } }));

import { fileLeads } from "@/lib/server/curated";
import { curatedLeads } from "@/lib/curated";

const lead = (o: { title: string; url: string; deadline?: string; amount?: string; funder?: string }) =>
  curatedLeads([{ kind: "opportunity", money_kind: "grants", title: o.title, url: o.url, funder: o.funder ?? "National Endowment for the Humanities", deadline: o.deadline, amount: o.amount }], "2026-11-19");
const own = { id: "src-own", kind: "page", trust: "first_party" as const, label: "NEH: grants" };
const news = { id: "src-news", kind: "bluesky", trust: "review" as const, label: "Inside Philanthropy" };
const rows = () => holder.db.rows("ledger_overlay");
const A = "https://www.neh.gov/program/collections-stewardship";
const B = "https://www.neh.gov/grants#collections-stewardship-2027-01-14";
const NEWS = "https://insidephilanthropy.com/wire/neh-collections";

beforeEach(() => { holder.db = new FakeDb(); });

describe("a second sighting at another address", () => {
  it("is one entry, with the other address recorded", async () => {
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own)).toBe(1);
    expect(await fileLeads("l", lead({ title: "Collections Stewardship grant program", url: B, deadline: "2027-01-14" }), null, own)).toBe(0);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].also_seen).toEqual([expect.objectContaining({ url: B, source: "NEH: grants" })]);
  });
  it("files the keys a later sighting is matched by", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A }), null, own);
    expect(rows()[0]).toMatchObject({ opp_host: "neh.gov", opp_funder: "nationalendowmentforthehumanities" });
  });
  it("joins a news item to the funder's own entry by the funder's name", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A }), null, own);
    expect(await fileLeads("l", lead({ title: "Collections Stewardship grants", url: NEWS }), null, news)).toBe(0);
    expect(rows()).toHaveLength(1);
    expect((rows()[0].also_seen as Row[])[0]).toMatchObject({ url: NEWS, source: "Inside Philanthropy" });
  });
  it("keeps next year's round, another programme, and another funder as entries of their own", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own);
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: `${A}-2028`, deadline: "2028-01-14" }), null, own)).toBe(1);
    expect(await fileLeads("l", lead({ title: "Public Humanities Projects", url: "https://www.neh.gov/program/public-humanities" }), null, own)).toBe(1);
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: "https://other.example/x", funder: "Someone Else" }), null, news)).toBe(1);
    expect(rows()).toHaveLength(4);
  });
});

describe("a sighting of something a person rejected", () => {
  it("is not filed again under a new address or a reworded title", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A }), null, own);
    rows()[0].status = "rejected";
    expect(await fileLeads("l", lead({ title: "Collections Stewardship grant program", url: B }), null, own)).toBe(0);
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: NEWS }), null, news)).toBe(0);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].status).toBe("rejected");
  });
});

describe("a sighting of something already approved", () => {
  const approve = async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own);
    Object.assign(rows()[0], { status: "approved", id: "orig" });
  };
  it("records the address and files nothing when the facts agree", async () => {
    await approve();
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: B, deadline: "2027-01-14" }), null, own)).toBe(0);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].also_seen).toHaveLength(1);
  });
  it("proposes changed facts as an update to that entry, never published and never a second live entry", async () => {
    await approve();
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: B, deadline: "2027-02-20" }), null, own)).toBe(1);
    expect(rows()).toHaveLength(2);
    const up = rows()[1];
    expect(up).toMatchObject({ update_of: "orig", status: "proposed", kind: "grant" });
    expect(up.published_at ?? null).toBeNull();
    expect(up.signal_source_id ?? null).toBeNull();
    expect((up.fields as Row).close_date).toBe("2027-02-20");
    expect((rows()[0].fields as Row).close_date).toBe("2027-01-14");
  });
  it("refreshes the waiting update when the facts move again, and does not stack a second one", async () => {
    await approve();
    await fileLeads("l", lead({ title: "Collections Stewardship", url: B, deadline: "2027-02-20" }), null, own);
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: `${B}-b`, deadline: "2027-03-01" }), null, own)).toBe(0);
    expect(rows().filter(r => r.update_of === "orig")).toHaveLength(1);
    expect((rows().find(r => r.update_of === "orig")!.fields as Row).close_date).toBe("2027-03-01");
  });
  it("does not treat an update row as an opportunity to match against", async () => {
    await approve();
    await fileLeads("l", lead({ title: "Collections Stewardship", url: B, deadline: "2027-02-20" }), null, own);
    rows()[0].status = "superseded";
    // With the original gone, the update row alone must not swallow a fresh sighting.
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: `${A}?x=1`, deadline: "2027-02-20" }), null, own)).toBe(1);
  });
});

describe("a sighting of something still waiting", () => {
  it("publishes a waiting signals entry when the funder's own source states it, in the funder's words", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship grants", url: NEWS }), null, news);
    expect(rows()[0].published_at ?? null).toBeNull();
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own)).toBe(0);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ signal_source_id: "src-own", title: "Collections Stewardship" });
    expect(typeof rows()[0].published_at).toBe("string");
  });
  it("does not publish a waiting entry because a review source repeats it", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship grants", url: NEWS }), null, news);
    await fileLeads("l", lead({ title: "Collections Stewardship", url: `${NEWS}-2` }), null, news);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].published_at ?? null).toBeNull();
  });
  it("leaves a waiting entry that came in by hand unpublished, and still records the sighting", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: NEWS }), "user1");
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A }), null, own);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].published_at ?? null).toBeNull();
    expect(rows()[0].also_seen).toHaveLength(1);
  });
  it("keeps a live, unreviewed entry current when the funder's own source moves a fact", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own);
    await fileLeads("l", lead({ title: "Collections Stewardship", url: B, deadline: "2027-02-20" }), null, own);
    expect(rows()).toHaveLength(1);
    expect((rows()[0].fields as Row).close_date).toBe("2027-02-20");
  });
  it("does not let a review source rewrite a live entry's facts", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own);
    await fileLeads("l", lead({ title: "Collections Stewardship", url: NEWS, deadline: "2027-02-20" }), null, news);
    expect((rows()[0].fields as Row).close_date).toBe("2027-01-14");
  });
});

describe("before migration 0101", () => {
  it("files by address alone, as it did", async () => {
    holder.db.failOn = q => /opp_host|opp_funder|also_seen|update_of/.test(`${q.cols},${q.filters.join(",")}`) ? { message: "column ledger_overlay.opp_host does not exist" } : undefined;
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: A }), null, own)).toBe(1);
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: B }), null, own)).toBe(1);
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: A }), null, own)).toBe(0);
    expect(rows()).toHaveLength(2);
    expect("opp_host" in rows()[0]).toBe(false);
  });
});

describe("the same address, read again with a changed fact", () => {
  it("proposes an update to an approved entry, once", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own);
    Object.assign(rows()[0], { status: "approved", id: "orig" });
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-02-20" }), null, own)).toBe(1);
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-02-20" }), null, own)).toBe(0);
    expect(rows()).toHaveLength(2);
    expect(rows()[1]).toMatchObject({ update_of: "orig", status: "proposed" });
    expect((rows()[0].fields as Row).close_date).toBe("2027-01-14");
  });
  it("files nothing when an approved entry is read again unchanged", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own);
    rows()[0].status = "approved";
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own)).toBe(0);
    expect(rows()).toHaveLength(1);
  });
  it("keeps a live, unreviewed entry current, and only from the funder's own source", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own);
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-03-01" }), null, news);
    expect((rows()[0].fields as Row).close_date).toBe("2027-01-14");
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-02-20" }), null, own);
    expect((rows()[0].fields as Row).close_date).toBe("2027-02-20");
    expect(rows()).toHaveLength(1);
  });
  it("never proposes an update to a rejected entry", async () => {
    await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-01-14" }), null, own);
    rows()[0].status = "rejected";
    expect(await fileLeads("l", lead({ title: "Collections Stewardship", url: A, deadline: "2027-02-20" }), null, own)).toBe(0);
    expect(rows()).toHaveLength(1);
  });
});
