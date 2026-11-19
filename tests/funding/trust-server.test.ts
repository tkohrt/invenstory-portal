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
// The model's reply to a mission-fit request, set per test. Default: every lead fits.
const model: { reply: ((user: string) => string | null) } = { reply: () => null };
const calls: string[] = [];
const allFit = (user: string) => { const n = Number(/Judge each of the (\d+) opportunities/.exec(user)?.[1] ?? 0); return Array.from({ length: n }, (_, i) => `${i + 1}: fit`).join("\n"); };
vi.mock("@/lib/server/llm", () => ({ chatComplete: vi.fn(async (o: { user: string }) => { calls.push(o.user); const t = model.reply(o.user); return t === null ? null : { text: t, provider: "test" }; }) }));
// The client's matching profile, by tenant. Absent: no profile to judge by.
const briefs: Record<string, unknown> = {};
vi.mock("@/lib/server/search-profile-read", () => ({ getSearchProfile: vi.fn(async (id: string) => briefs[id] ?? null) }));
const profiles: Record<string, unknown> = {};
// As the real one behaves: read as the signed-in person unless told to use the service role. The scheduled run has nobody signed in, so a read without `asService` comes back empty.
const signedIn = { value: false };
const eligibilityCalls: [string, boolean][] = [];
vi.mock("@/lib/server/eligibility", () => ({ getEligibilityProfile: vi.fn(async (id: string, asService = false) => { eligibilityCalls.push([id, asService]); return asService || signedIn.value ? profiles[id] ?? null : { org_type: null }; }) }));
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
const match = (tenant: string, n: number, at = "2026-11-19T12:00:00Z", fit: boolean | null = true): Row => ({ tenant_id: tenant, list_id: "list1", overlay_id: uuid(n), verdict: "eligible", swept_at: at, mission_fit: fit });
const lists = [{ id: "list1", name: "Signals, week of 16 Nov", context_note: "A note from For Granted" }];
const PUB = "2026-11-19T12:00:00Z";

const fact = (facet: string, text: string) => ({ facet, text, quote: text, documentId: "d", documentTitle: "D", layer: "I", subject: "organization" });
const richProfile = { facts: [fact("identity", "A youth engineering mentorship nonprofit"), fact("work", "After-school robotics studios"), fact("need", "Funding for a second site")] };
beforeEach(() => {
  holder.db = new FakeDb();
  for (const k of Object.keys(profiles)) delete profiles[k];
  for (const k of Object.keys(briefs)) delete briefs[k];
  calls.length = 0; eligibilityCalls.length = 0; signedIn.value = false;
  model.reply = allFit;
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
    briefs[A] = richProfile; briefs[B] = richProfile;
  };
  it("screens every client with Funding on, community member or not, and nobody else", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    // B has the switch OFF explicitly, and another feature on: neither makes it a recipient.
    holder.db.rows("feature_visibility").push({ tenant_id: B, feature_key: "funder_matches", visible: false }, { tenant_id: B, feature_key: "funder_compass", visible: true });
    const r = await sweepSignalEntries();
    expect(r).toMatchObject({ ok: true, entries: 1, tenants: 1, matches: 1 });
    expect(holder.db.rows("curated_match").map(m => m.tenant_id)).toEqual([A]);
  });
  it("leaves the Brain out", async () => {
    seed([entry(1, { published_at: PUB })], [A, B], [{ id: A, is_brain: true }, { id: B, is_brain: false }]);
    await sweepSignalEntries();
    expect(holder.db.rows("curated_match").map(m => m.tenant_id)).toEqual([B]);
  });
  it("judges waiting entries too (to order the queue), and they stay hidden from the client", async () => {
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
    holder.db.rows("feature_visibility").push({ tenant_id: B, feature_key: "funder_matches", visible: false }, { tenant_id: B, feature_key: "funder_compass", visible: true });
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, entries: 0, matches: 0 });
  });
  it("shows a client only the leads judged to suit its work, and keeps the rest on file unseen", async () => {
    seed([entry(1, { published_at: PUB }), entry(2, { published_at: PUB }), entry(3, { published_at: PUB })], [A]);
    holder.db.seed("curated_list", lists);
    model.reply = () => "1: fit\n2: not\n3: fit";
    const r = await sweepSignalEntries();
    expect(r).toMatchObject({ ok: true, matches: 2, judged: 3, off: 1 });
    expect(holder.db.rows("curated_match").map(m => m.mission_fit)).toEqual([true, false, true]);
    expect((await getCuratedMatches(A)).map(x => x.title).sort()).toEqual(["Opportunity 1", "Opportunity 3"]);
    expect(await visibleEntry(A, uuid(2))).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("After-school robotics studios");
  });
  it("judges a lead once: a second run asks the model nothing", async () => {
    seed([entry(1, { published_at: PUB }), entry(2, { published_at: PUB })], [A]);
    model.reply = () => "1: fit\n2: not";
    await sweepSignalEntries();
    await sweepSignalEntries();
    expect(calls).toHaveLength(1);
    expect(holder.db.rows("curated_match")).toHaveLength(2);
  });
  it("shows nothing from a source to a client whose profile is too thin to judge by, and asks no model", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    holder.db.seed("curated_list", lists);
    delete briefs[A];
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, matches: 0, judged: 0 });
    expect(calls).toHaveLength(0);
    expect(holder.db.rows("curated_match")[0].mission_fit).toBeNull();
    expect(await getCuratedMatches(A)).toEqual([]);
    // Once the Inven(s)tory can say what it does, the lead is judged and appears.
    briefs[A] = richProfile;
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, matches: 1, judged: 1 });
    expect((await getCuratedMatches(A)).map(x => x.title)).toEqual(["Opportunity 1"]);
  });
  it("leaves leads unjudged and unseen when the model is unavailable or answers in prose", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    holder.db.seed("curated_list", lists);
    model.reply = () => null;
    await sweepSignalEntries();
    model.reply = () => "These all look great.";
    await sweepSignalEntries();
    expect(holder.db.rows("curated_match")[0].mission_fit).toBeNull();
    expect(await getCuratedMatches(A)).toEqual([]);
  });
  it("judges the matches written before the patch, so the leads already on clients' pages are re-checked", async () => {
    seed([entry(1, { published_at: PUB }), entry(2, { published_at: PUB })], [A]);
    holder.db.seed("curated_list", lists);
    holder.db.rows("curated_match").push({ ...match(A, 1, "2026-11-19T23:30:00Z", null), id: "m1" }, { ...match(A, 2, "2026-11-19T23:30:00Z", null), id: "m2" });
    expect(await getCuratedMatches(A)).toEqual([]); // off the page until judged
    model.reply = () => "1: not\n2: fit";
    await sweepSignalEntries();
    expect((await getCuratedMatches(A)).map(x => x.title)).toEqual(["Opportunity 2"]);
  });
  it("cannot be talked into a verdict for a lead it was not asked about", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    model.reply = () => "1: not\n2: fit\n99: fit";
    await sweepSignalEntries();
    expect(holder.db.rows("curated_match").map(m => m.mission_fit)).toEqual([false]);
  });
  it("judges per client, from that client's own description, and writes each verdict to that client's row only", async () => {
    seed([entry(1, { published_at: PUB })], [A, B]);
    holder.db.seed("curated_list", lists);
    // Both clients were matched before the patch: the same lead waits unjudged for each.
    holder.db.rows("curated_match").push({ ...match(A, 1, PUB, null), id: "ma" }, { ...match(B, 1, PUB, null), id: "mb" });
    briefs[A] = { facts: [fact("identity", "ALPHA robotics mentoring"), fact("work", "ALPHA studios"), fact("need", "ALPHA second site")] };
    briefs[B] = { facts: [fact("identity", "BRAVO river conservation"), fact("work", "BRAVO stream surveys"), fact("need", "BRAVO field staff")] };
    model.reply = user => (user.includes("ALPHA") ? "1: fit" : "1: not");
    await sweepSignalEntries();
    expect(calls).toHaveLength(2);
    expect(calls.find(c => c.includes("ALPHA"))).not.toContain("BRAVO");
    expect(calls.find(c => c.includes("BRAVO"))).not.toContain("ALPHA");
    const by = Object.fromEntries(holder.db.rows("curated_match").map(m => [m.tenant_id, m.mission_fit]));
    expect(by).toEqual({ [A]: true, [B]: false });
    expect((await getCuratedMatches(A)).map(x => x.title)).toEqual(["Opportunity 1"]);
    expect(await getCuratedMatches(B)).toEqual([]);
    for (const q of holder.db.log.filter(l => l.table === "curated_match" && l.op === "update")) expect(q.filters).toContain("eq:tenant_id");
  });
  it("reads each client's eligibility with the service role, so the scheduled run (nobody signed in) screens them at all", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, matches: 1 });
    expect(eligibilityCalls).toEqual([[A, true]]);
  });
  it("judges nothing from a profile that has facts but too few to say what the client does", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    briefs[A] = { facts: [fact("identity", "A nonprofit"), fact("geography", "Ohio"), fact("beneficiaries", "Teenagers")] };
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, judged: 0 });
    expect(calls).toHaveLength(0);
  });
  it("leaves the date alone on a lead judged off mission and moves it once on one that becomes visible", async () => {
    seed([entry(1, { published_at: PUB }), entry(2, { published_at: PUB })], [A]);
    holder.db.rows("curated_match").push({ ...match(A, 1, "2026-11-01T00:00:00Z", null), id: "m1" }, { ...match(A, 2, "2026-11-01T00:00:00Z", null), id: "m2" });
    model.reply = () => "1: fit\n2: not";
    await sweepSignalEntries();
    const [one, two] = holder.db.rows("curated_match");
    expect(one.swept_at).not.toBe("2026-11-01T00:00:00Z");
    expect(two.swept_at).toBe("2026-11-01T00:00:00Z");
  });
  it("keeps the eligibility matches when the model throws, and asks it only once for that client", async () => {
    seed([entry(1, { published_at: PUB }), entry(2, { published_at: PUB })], [A]);
    model.reply = () => { throw new Error("bedrock timeout"); };
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, matches: 0, judged: 0 });
    expect(holder.db.rows("curated_match").map(m => m.mission_fit)).toEqual([null, null]);
    expect(calls).toHaveLength(1);
  });
  it("starts no model call with too little time left, and still keeps the eligibility matches", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    expect(await sweepSignalEntries(Date.now() + 5_000)).toMatchObject({ ok: true, unfinished: true, judged: 0 });
    expect(calls).toHaveLength(0);
    expect(holder.db.rows("curated_match")).toHaveLength(1);
  });
  it("saves each batch as it returns, and judges at most three batches for one client in one run", async () => {
    seed(Array.from({ length: 100 }, (_, i) => entry(200 + i, { published_at: PUB })), [A]);
    await sweepSignalEntries();
    expect(calls).toHaveLength(3);
    const fits = holder.db.rows("curated_match").map(m => m.mission_fit);
    expect(fits.filter(f => f === true)).toHaveLength(90);
    expect(fits.filter(f => f === null)).toHaveLength(10);
    // The ten left over are judged by the next run, and nothing is asked twice.
    await sweepSignalEntries();
    expect(calls).toHaveLength(4);
    expect(holder.db.rows("curated_match").every(m => m.mission_fit === true)).toBe(true);
  });
  it("before migration 0103, matches as it did: no verdict, no model call, everything eligible shown", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    holder.db.seed("curated_list", lists);
    holder.db.failOn = q => q.table === "curated_match" && (q.cols.includes("mission_fit") || q.filters.some(f => f.includes("mission_fit"))) ? { message: "column curated_match.mission_fit does not exist" } : undefined;
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, matches: 1, judged: 0 });
    expect(calls).toHaveLength(0);
    expect("mission_fit" in holder.db.rows("curated_match")[0]).toBe(false);
    expect((await getCuratedMatches(A)).map(x => x.title)).toEqual(["Opportunity 1"]);
    expect(await visibleEntry(A, uuid(1))).not.toBeNull();
  });
  it("does not let rows judged off mission crowd a client's visible entries out of the page", async () => {
    const off = Array.from({ length: 700 }, (_, i) => entry(1000 + i, { published_at: PUB }));
    holder.db.seed("ledger_overlay", [...off, entry(1, { status: "approved", signal_source_id: null })]).seed("curated_list", lists)
      .seed("curated_match", [...off.map((_, i) => match(A, 1000 + i, "2026-11-19T12:00:00Z", false)), match(A, 1, "2026-01-01T00:00:00Z", null)]);
    expect((await getCuratedMatches(A)).map(x => x.title)).toEqual(["Opportunity 1"]);
  });
  it("skips a client with no eligibility profile", async () => {
    seed([entry(1, { published_at: PUB })], [A]);
    delete profiles[A];
    expect(await sweepSignalEntries()).toMatchObject({ ok: true, tenants: 1, matches: 0 });
    expect(calls).toHaveLength(0);
  });
  it("stops when its time is up and says so", async () => {
    seed([entry(1, { published_at: PUB })], [A, B]);
    expect(await sweepSignalEntries(Date.now() - 1)).toMatchObject({ ok: true, unfinished: true, matches: 0 });
  });
});

describe("hand-curated entries are untouched by mission fit", () => {
  it("shows a pasted-list entry with no verdict, as it always was", async () => {
    holder.db.seed("ledger_overlay", [entry(1, { status: "approved", signal_source_id: null })]).seed("curated_list", lists).seed("curated_match", [match(A, 1, PUB, null)]);
    expect((await getCuratedMatches(A)).map(r => r.title)).toEqual(["Opportunity 1"]);
    expect(await visibleEntry(A, uuid(1))).not.toBeNull();
  });
  it("before migration 0103, shows what it showed", async () => {
    holder.db.seed("ledger_overlay", [entry(2, { published_at: PUB })]).seed("curated_list", lists).seed("curated_match", [match(A, 2, PUB, null)]);
    holder.db.failOn = q => q.table === "curated_match" && q.cols.includes("mission_fit") ? { message: "column curated_match.mission_fit does not exist" } : undefined;
    // The fake returns every stored key, so strip the column the real database would not have.
    for (const m of holder.db.rows("curated_match")) delete m.mission_fit;
    expect((await getCuratedMatches(A)).map(r => r.title)).toEqual(["Opportunity 2"]);
  });
});
