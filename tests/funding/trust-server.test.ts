/**
 * The server reads that decide what a client sees of the sources' leads
 * (patches 67 and 68), run against an in-memory database: what the Funding
 * page lists, what a client may act on, what the Following list says, and who
 * the screen writes matches for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "../helpers/fake-db";
import { EMPTY_PROFILE } from "@/lib/eligibility-fields";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/llm", () => ({ chatComplete: vi.fn() }));
const profiles: Record<string, unknown> = {};
vi.mock("@/lib/server/eligibility", () => ({ getEligibilityProfile: vi.fn(async (id: string) => profiles[id] ?? null) }));
const holder = { db: new FakeDb() };
vi.mock("@/lib/server/db", () => ({ db: { from: (t: string) => holder.db.from(t) } }));

import { getCuratedMatches, visibleEntry, followedStandings, sweepSignalEntries } from "@/lib/server/curated";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const FUTURE = "2099-01-01";
const entry = (n: number, o: Row = {}): Row => ({
  id: uuid(n), kind: "grant", status: "proposed", published_at: null, signal_source_id: "src", curated_list_id: "list1",
  created_at: new Date().toISOString(), source_url: `https://funder.example/${n}`,
  fields: { title: `Opportunity ${n}`, agency: "Funder", eligibility: "501(c)(3) nonprofit organizations", close_date: FUTURE, website: `https://funder.example/${n}`, notes: "internal note", money_kind: "grants" },
  ...o,
});
const match = (tenant: string, n: number, at = "2026-11-19T12:00:00Z"): Row => ({ tenant_id: tenant, list_id: "list1", overlay_id: uuid(n), verdict: "eligible", swept_at: at });
const lists = [{ id: "list1", name: "Signals, week of 16 Nov", context_note: "A note from For Granted" }];
const PUB = "2026-11-19T12:00:00Z";

beforeEach(() => {
  holder.db = new FakeDb();
  for (const k of Object.keys(profiles)) delete profiles[k];
});

describe("getCuratedMatches", () => {
  it("lists approved and published entries, and nothing still waiting unseen, rejected or superseded", async () => {
    holder.db.seed("ledger_overlay", [
      entry(1, { status: "approved" }), entry(2, { published_at: PUB }), entry(3),
      entry(4, { status: "rejected", published_at: PUB }), entry(5, { status: "superseded", published_at: PUB }),
    ]).seed("curated_list", lists).seed("curated_match", [1, 2, 3, 4, 5].map(n => match(A, n)));
    const out = await getCuratedMatches(A);
    expect(out.map(r => [r.title, r.reviewed])).toEqual([["Opportunity 1", true], ["Opportunity 2", false]]);
  });
  it("ships For Granted's notes, list name and list note only with an entry it reviewed", async () => {
    holder.db.seed("ledger_overlay", [entry(1, { status: "approved" }), entry(2, { published_at: PUB })])
      .seed("curated_list", lists).seed("curated_match", [match(A, 1), match(A, 2)]);
    const [reviewed, unreviewed] = await getCuratedMatches(A);
    expect(reviewed).toMatchObject({ notes: "internal note", list_name: "Signals, week of 16 Nov", context_note: "A note from For Granted" });
    expect(unreviewed).toMatchObject({ notes: null, list_name: "", context_note: null });
  });
  it("never ships the reader's own check-the-link reminder", async () => {
    const e = entry(1, { status: "approved" });
    (e.fields as Row).notes = "The exact page was not among the search results: check the link.";
    holder.db.seed("ledger_overlay", [e]).seed("curated_list", lists).seed("curated_match", [match(A, 1)]);
    expect((await getCuratedMatches(A))[0].notes).toBeNull();
  });
  it("is not emptied by a crowd of matches on entries the client cannot see yet", async () => {
    const hidden = Array.from({ length: 120 }, (_, i) => entry(100 + i));
    holder.db.seed("ledger_overlay", [...hidden, entry(1, { status: "approved" }), entry(2, { published_at: PUB })])
      .seed("curated_list", lists)
      // The visible ones are the OLDEST matches: a short window taken first would miss them.
      .seed("curated_match", [...hidden.map((_, i) => match(A, 100 + i, "2026-11-19T12:00:00Z")), match(A, 1, "2026-11-01T00:00:00Z"), match(A, 2, "2026-11-01T00:00:00Z")]);
    expect((await getCuratedMatches(A)).map(r => r.title).sort()).toEqual(["Opportunity 1", "Opportunity 2"]);
  });
  it("shows a client only its own matches", async () => {
    holder.db.seed("ledger_overlay", [entry(1, { status: "approved" }), entry(2, { status: "approved" })])
      .seed("curated_list", lists).seed("curated_match", [match(A, 1), match(B, 2)]);
    expect((await getCuratedMatches(A)).map(r => r.title)).toEqual(["Opportunity 1"]);
    expect((await getCuratedMatches(B)).map(r => r.title)).toEqual(["Opportunity 2"]);
    for (const q of holder.db.log.filter(l => l.table === "curated_match")) expect(q.filters).toContain("eq:tenant_id");
  });
  it("drops a closed entry", async () => {
    const e = entry(1, { status: "approved" }); (e.fields as Row).close_date = "2020-01-01";
    holder.db.seed("ledger_overlay", [e]).seed("curated_list", lists).seed("curated_match", [match(A, 1)]);
    expect(await getCuratedMatches(A)).toEqual([]);
  });
});

describe("visibleEntry", () => {
  beforeEach(() => {
    holder.db.seed("ledger_overlay", [entry(1, { status: "approved" }), entry(2, { published_at: PUB }), entry(3), entry(4, { status: "rejected", published_at: PUB })])
      .seed("curated_match", [1, 2, 3, 4].map(n => match(A, n)));
  });
  it("lets a client act on an approved or published entry on its own list", async () => {
    expect((await visibleEntry(A, uuid(1)))?.reviewed).toBe(true);
    expect((await visibleEntry(A, uuid(2)))?.reviewed).toBe(false);
  });
  it("refuses an entry still waiting unseen, or rejected, even though a match is on file", async () => {
    expect(await visibleEntry(A, uuid(3))).toBeNull();
    expect(await visibleEntry(A, uuid(4))).toBeNull();
  });
  it("refuses another client's entry and an unknown id", async () => {
    expect(await visibleEntry(B, uuid(1))).toBeNull();
    expect(await visibleEntry(A, uuid(99))).toBeNull();
  });
});

describe("followedStandings", () => {
  it("says unreviewed or withdrawn for the client's own followed entries, and nothing for an approved one", async () => {
    holder.db.seed("ledger_overlay", [entry(1, { status: "approved" }), entry(2, { published_at: PUB }), entry(3, { status: "rejected", published_at: PUB })])
      .seed("curated_match", [1, 2, 3].map(n => match(A, n)));
    expect(await followedStandings(A, [uuid(1), uuid(2), uuid(3), "not-a-uuid", "grant-123"])).toEqual({ [uuid(2)]: "unreviewed", [uuid(3)]: "withdrawn" });
  });
  it("answers nothing about an entry that is not on this client's own match list", async () => {
    holder.db.seed("ledger_overlay", [entry(2, { published_at: PUB })]).seed("curated_match", [match(B, 2)]);
    expect(await followedStandings(A, [uuid(2)])).toEqual({});
  });
});

describe("sweepSignalEntries", () => {
  const nonprofit = { ...EMPTY_PROFILE, org_type: "nonprofit" as const, tax_status: "501c3" as const };
  const seed = (entries: Row[], on: string[], tenants: Row[] = [{ id: A, is_brain: false }, { id: B, is_brain: false }]) => {
    holder.db.seed("ledger_overlay", entries).seed("tenant", tenants)
      .seed("feature_visibility", on.map(t => ({ tenant_id: t, feature_key: "funder_matches", visible: true }))).seed("curated_match", []);
    profiles[A] = nonprofit; profiles[B] = nonprofit;
  };
  it("screens every client with Funding on, community member or not, and nobody else", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    const r = await sweepSignalEntries();
    expect(r).toMatchObject({ ok: true, entries: 1, tenants: 1, matches: 1 });
    expect(holder.db.rows("curated_match").map(m => m.tenant_id)).toEqual([A]);
  });
  it("leaves the Brain out", async () => {
    seed([entry(1, { published_at: PUB })], [A, B], [{ id: A, is_brain: true }, { id: B, is_brain: false }]);
    await sweepSignalEntries();
    expect(holder.db.rows("curated_match").map(m => m.tenant_id)).toEqual([B]);
  });
  it("matches waiting entries too (to order the queue), and they stay hidden from the client", async () => {
    seed([entry(1)], [A]);
    holder.db.seed("curated_list", lists);
    await sweepSignalEntries();
    expect(holder.db.rows("curated_match")).toHaveLength(1);
    expect(await getCuratedMatches(A)).toEqual([]);
  });
  it("writes only new matches, so a match's date never moves", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    holder.db.rows("curated_match").push({ ...match(A, 1, "2026-11-01T00:00:00Z"), id: "old" });
    const r = await sweepSignalEntries();
    expect(r).toMatchObject({ ok: true, matches: 0 });
    expect(holder.db.rows("curated_match")).toHaveLength(1);
    expect(holder.db.rows("curated_match")[0].swept_at).toBe("2026-11-01T00:00:00Z");
  });
  it("skips closed entries, rejected ones, funder records, updates, and anything that did not come from a source", async () => {
    const closed = entry(1, { published_at: PUB }); (closed.fields as Row).close_date = "2020-01-01";
    seed([closed, entry(2, { status: "rejected" }), entry(3, { kind: "funder" }), entry(4, { signal_source_id: null }), entry(5, { signal_source_id: null, update_of: uuid(9) })], [A]);
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, entries: 0, matches: 0 });
  });
  it("skips a client with no eligibility profile", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    delete profiles[A];
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, tenants: 1, matches: 0 });
  });
  it("stops when its time is up and says so", async () => {
    seed([entry(1, { published_at: PUB })], [A, B]);
    expect(await sweepSignalEntries(Date.now() - 1)).toMatchObject({ ok: true, unfinished: true, matches: 0 });
  });
});
