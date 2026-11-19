/** Who is waiting on a queue entry (patches 67 and 70): counts per entry, and what "suits a client" means for a lead from a source. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../helpers/fake-db";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/supabase", () => ({ userClient: vi.fn() }));
const holder = { db: new FakeDb() };
vi.mock("@/lib/server/db", () => ({ db: { from: (t: string) => holder.db.from(t) } }));
import { getQueueDemand } from "@/lib/server/ledger-overlay";

beforeEach(() => { holder.db = new FakeDb(); });

describe("getQueueDemand", () => {
  it("counts a lead from a source as suiting only the clients it was judged on mission for", async () => {
    holder.db.seed("curated_match", [
      { overlay_id: "s1", tenant_id: "A", mission_fit: true }, { overlay_id: "s1", tenant_id: "B", mission_fit: false }, { overlay_id: "s1", tenant_id: "C", mission_fit: null },
      { overlay_id: "h1", tenant_id: "A", mission_fit: null }, { overlay_id: "h1", tenant_id: "B", mission_fit: null },
    ]).seed("saved_item", []).seed("client_request", []);
    const d = await getQueueDemand([{ id: "s1", signal_source_id: "src" }, { id: "h1", signal_source_id: null }]);
    expect(d.s1.matched).toBe(1);
    // A hand-curated entry counts every match, as before.
    expect(d.h1.matched).toBe(2);
  });
  it("counts each client once for follows and open draft requests, and ignores closed requests and other kinds", async () => {
    holder.db.seed("curated_match", []).seed("saved_item", [
      { kind: "grant", target_id: "s1", tenant_id: "A" }, { kind: "grant", target_id: "s1", tenant_id: "B" }, { kind: "funder", target_id: "s1", tenant_id: "C" },
    ]).seed("client_request", [
      { source_key: "draft:s1", tenant_id: "A", status: "open" }, { source_key: "draft:s1", tenant_id: "A", status: "open" }, { source_key: "draft:s1", tenant_id: "B", status: "done" },
    ]);
    const d = await getQueueDemand([{ id: "s1", signal_source_id: "src" }]);
    expect(d.s1).toEqual({ matched: 0, followed: 2, asked: 1 });
  });
  it("counts every match before migration 0103", async () => {
    holder.db.seed("curated_match", [{ overlay_id: "s1", tenant_id: "A" }, { overlay_id: "s1", tenant_id: "B" }]).seed("saved_item", []).seed("client_request", []);
    holder.db.failOn = q => q.table === "curated_match" && q.cols.includes("mission_fit") ? { message: "column curated_match.mission_fit does not exist" } : undefined;
    expect((await getQueueDemand([{ id: "s1", signal_source_id: "src" }])).s1.matched).toBe(2);
  });
  it("answers nothing for an empty queue", async () => {
    expect(await getQueueDemand([])).toEqual({});
  });
});
