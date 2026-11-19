/** Source scorecards and automatic expiry (patch 69), against an in-memory database. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "../helpers/fake-db";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/server/llm", () => ({ chatComplete: vi.fn() }));
vi.mock("@/lib/server/eligibility", () => ({ getEligibilityProfile: vi.fn() }));
vi.mock("@/lib/server/read-url", () => ({ readUrl: vi.fn(), readHtml: vi.fn(), fetchChecked: vi.fn() }));
vi.mock("@/lib/server/session", () => ({ getSession: vi.fn(async () => ({ role: "admin", user: { id: "u1" }, tenantId: "t1" })) }));
const holder = { db: new FakeDb() };
vi.mock("@/lib/server/db", () => ({ db: { from: (t: string) => holder.db.from(t) } }));

import { scoreSource, sourceScorecards } from "@/lib/server/signals";
import { expireSignalEntries } from "@/lib/server/curated";
import { rejectOverlayAction } from "@/lib/server/overlay-actions";
import type { SourceRow } from "@/lib/signals";

const src = (o: Row = {}): Row => ({ id: "s1", kind: "page", address: "https://funder.example/grants", label: "Funder: grants", category: "funder", active: true, origin: "manual", trust: "first_party", trust_set_at: null, demoted_at: null, demoted_note: null, ...o });
const decided = (n: number, status: string, day: number, o: Row = {}): Row => ({ id: `e${n}`, kind: "grant", status, signal_source_id: "s1", reviewed_at: `2026-11-${String(day).padStart(2, "0")}T12:00:00Z`, title: `E${n}`, fields: {}, ...o });
const source = () => holder.db.rows("signal_source")[0];

beforeEach(() => { holder.db = new FakeDb(); holder.db.seed("audit_log", []); });

describe("scoreSource", () => {
  it("sends a first-party source back to review at three rejections, and says why", async () => {
    holder.db.seed("signal_source", [src()]).seed("ledger_overlay", [decided(1, "rejected", 1), decided(2, "rejected", 2), decided(3, "approved", 3), decided(4, "rejected", 4)]);
    expect(await scoreSource("s1", "u1")).toBe("Moved to review automatically: 3 of its last 4 decided leads were rejected.");
    expect(source()).toMatchObject({ trust: "review", demoted_note: "Moved to review automatically: 3 of its last 4 decided leads were rejected." });
    expect(typeof source().demoted_at).toBe("string");
    expect(holder.db.rows("audit_log")[0]).toMatchObject({ action: "source_demoted", actor_user_id: "u1" });
  });
  it("leaves a source alone at two rejections", async () => {
    holder.db.seed("signal_source", [src()]).seed("ledger_overlay", [decided(1, "rejected", 1), decided(2, "rejected", 2), decided(3, "approved", 3)]);
    expect(await scoreSource("s1", "u1")).toBeNull();
    expect(source().trust).toBe("first_party");
  });
  it("does not count decisions from before a person last chose the tier", async () => {
    holder.db.seed("signal_source", [src({ trust_set_at: "2026-11-10T00:00:00Z" })]).seed("ledger_overlay", [decided(1, "rejected", 1), decided(2, "rejected", 2), decided(3, "rejected", 3), decided(4, "rejected", 12)]);
    expect(await scoreSource("s1", "u1")).toBeNull();
  });
  it("does not count funder records, entries closed automatically, or another source's entries", async () => {
    holder.db.seed("signal_source", [src()]).seed("ledger_overlay", [
      decided(1, "rejected", 1), decided(2, "rejected", 2), decided(3, "rejected", 3, { kind: "funder" }),
      decided(4, "superseded", 4), decided(5, "rejected", 5, { signal_source_id: "other" }),
    ]);
    expect(await scoreSource("s1", "u1")).toBeNull();
  });
  it("never touches a source that already waits for review", async () => {
    holder.db.seed("signal_source", [src({ trust: "review" })]).seed("ledger_overlay", [decided(1, "rejected", 1), decided(2, "rejected", 2), decided(3, "rejected", 3)]);
    expect(await scoreSource("s1", "u1")).toBeNull();
    expect(source().demoted_at).toBeNull();
  });
  it("gives each source its record for the Sources tab", async () => {
    holder.db.seed("signal_source", [src()]).seed("ledger_overlay", [decided(1, "approved", 1), decided(2, "rejected", 2), decided(3, "approved", 3, { signal_source_id: "other" })]);
    const cards = await sourceScorecards([source() as unknown as SourceRow, { ...src({ id: "none" }) } as unknown as SourceRow]);
    expect(cards.s1).toEqual({ approved: 1, rejected: 1, considered: 2, demote: false });
    expect(cards.none.considered).toBe(0);
  });
});

describe("rejecting a published lead", () => {
  it("counts against its source and demotes it on the third", async () => {
    holder.db.seed("signal_source", [src()]).seed("ledger_overlay", [
      decided(1, "rejected", 1), decided(2, "rejected", 2),
      { id: "e3", kind: "grant", status: "proposed", signal_source_id: "s1", published_at: "2026-11-19T12:00:00Z", title: "E3", fields: {} },
    ]);
    await rejectOverlayAction("e3", "Not a real opportunity");
    expect(holder.db.rows("ledger_overlay")[2].status).toBe("rejected");
    expect(source().trust).toBe("review");
  });
  it("does nothing to sources when the entry came in another way", async () => {
    holder.db.seed("signal_source", [src()]).seed("ledger_overlay", [{ id: "m1", kind: "grant", status: "proposed", signal_source_id: null, title: "M", fields: {} }]);
    await rejectOverlayAction("m1", "Duplicate");
    expect(source().trust).toBe("first_party");
    expect(holder.db.rows("audit_log").map(a => a.action)).toEqual(["overlay_reject"]);
  });
});

describe("expireSignalEntries", () => {
  const now = new Date("2026-11-20T15:00:00Z");
  const waiting = (id: string, close: string | null, o: Row = {}): Row => ({ id, kind: "grant", status: "proposed", signal_source_id: "s1", fields: { close_date: close }, ...o });
  it("closes waiting source entries whose deadline has passed, with the reason, and no others", async () => {
    holder.db.seed("ledger_overlay", [
      waiting("past", "2026-11-18"), waiting("today", "2026-11-20"), waiting("future", "2027-01-01"), waiting("undated", null),
      waiting("approved", "2026-11-18", { status: "approved" }), waiting("rejected", "2026-11-18", { status: "rejected" }),
      waiting("by-hand", "2026-11-18", { signal_source_id: null }), waiting("funder", "2026-11-18", { kind: "funder" }),
    ]);
    expect(await expireSignalEntries(now)).toBe(1);
    const by = Object.fromEntries(holder.db.rows("ledger_overlay").map(r => [r.id, r]));
    expect(by.past).toMatchObject({ status: "superseded", review_note: "Closed automatically: its deadline (2026-11-18) has passed." });
    for (const id of ["today", "future", "undated", "by-hand", "funder"]) expect(by[id].status).toBe("proposed");
    expect(by.approved.status).toBe("approved");
    expect(by.rejected.status).toBe("rejected");
  });
  it("does not count as a rejection on the source's record", async () => {
    holder.db.seed("signal_source", [src()]).seed("ledger_overlay", [waiting("a", "2026-11-01"), waiting("b", "2026-11-02"), waiting("c", "2026-11-03")]);
    expect(await expireSignalEntries(now)).toBe(3);
    expect(await scoreSource("s1", null)).toBeNull();
    expect(source().trust).toBe("first_party");
  });
});
