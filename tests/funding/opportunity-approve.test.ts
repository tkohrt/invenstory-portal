/** One opportunity, one entry (patch 68): approving an update writes onto the approved entry and never makes a second live one. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, type Row } from "../helpers/fake-db";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const session: { role: string } = { role: "admin" };
vi.mock("@/lib/server/session", () => ({ getSession: vi.fn(async () => ({ role: session.role, user: { id: "u1" }, tenantId: "t1" })) }));
vi.mock("@/lib/server/funder-profile", () => ({ mergeIntoFunderProfile: vi.fn() }));
const holder = { db: new FakeDb() };
vi.mock("@/lib/server/db", () => ({ db: { from: (t: string) => holder.db.from(t) } }));

import { approveOverlayAction } from "@/lib/server/overlay-actions";

const rows = () => holder.db.rows("ledger_overlay");
const seed = (origStatus = "approved") => holder.db.seed("ledger_overlay", [
  { id: "orig", kind: "grant", status: origStatus, title: "Collections Stewardship", source_url: "https://www.neh.gov/a", provenance: "curated_list",
    fields: { title: "Collections Stewardship", close_date: "2027-01-14", max_award: 50000, notes: "reviewed note" } },
  { id: "up", kind: "grant", status: "proposed", title: "Collections Stewardship", source_url: "https://www.neh.gov/a", provenance: "curated_list", update_of: "orig",
    fields: { title: "Reader's other wording", close_date: "2027-02-20", notes: "reader note" } },
] as Row[]).seed("audit_log", []);

beforeEach(() => { holder.db = new FakeDb(); session.role = "admin"; });

describe("approving an update", () => {
  it("writes only the changed facts onto the approved entry and retires the update row", async () => {
    seed();
    await approveOverlayAction("up");
    const [orig, up] = rows();
    expect(orig.status).toBe("approved");
    expect(orig.fields).toEqual({ title: "Collections Stewardship", close_date: "2027-02-20", max_award: 50000, notes: "reviewed note" });
    expect(up.status).toBe("superseded");
    expect(String(up.review_note)).toContain("Deadline was 2027-01-14, now 2027-02-20");
    expect(rows().filter(r => r.status === "approved")).toHaveLength(1);
    expect(holder.db.rows("audit_log")[0]).toMatchObject({ action: "overlay_update_applied" });
  });
  it("uses the reviewer's edited fields when given", async () => {
    seed();
    await approveOverlayAction("up", { fields: { close_date: "2027-03-01" } });
    expect((rows()[0].fields as Row).close_date).toBe("2027-03-01");
  });
  it("refuses when the entry it would update is no longer live, and changes nothing", async () => {
    seed("rejected");
    await expect(approveOverlayAction("up")).rejects.toThrow(/no longer live/);
    expect(rows()[1].status).toBe("proposed");
    expect((rows()[0].fields as Row).close_date).toBe("2027-01-14");
  });
  it("stops, and approves nothing, when it cannot check what the row updates", async () => {
    seed();
    holder.db.failOn = q => q.op === "select" && q.cols === "update_of" ? { message: "connection reset" } : undefined;
    await expect(approveOverlayAction("up")).rejects.toThrow(/Nothing was changed/);
    expect(rows().filter(r => r.status === "approved")).toHaveLength(1);
    expect(rows()[1].status).toBe("proposed");
  });
  it("approves as before on a database without the update column", async () => {
    holder.db.seed("ledger_overlay", [{ id: "x", kind: "grant", status: "proposed", title: "T", source_url: "https://a.example/x", provenance: "manual", fields: {} }] as Row[]).seed("audit_log", []);
    holder.db.failOn = q => q.cols === "update_of" ? { message: "column ledger_overlay.update_of does not exist" } : undefined;
    await approveOverlayAction("x");
    expect(rows()[0].status).toBe("approved");
  });
  it("is admin only", async () => {
    seed(); session.role = "client";
    await expect(approveOverlayAction("up")).rejects.toThrow(/admin/);
    expect(rows()[1].status).toBe("proposed");
  });
  it("approves an ordinary entry exactly as before", async () => {
    holder.db.seed("ledger_overlay", [{ id: "x", kind: "grant", status: "proposed", title: "T", source_url: "https://a.example/x", provenance: "manual", fields: {} }] as Row[]).seed("audit_log", []);
    await approveOverlayAction("x");
    expect(rows()[0].status).toBe("approved");
    expect(holder.db.rows("audit_log")[0]).toMatchObject({ action: "overlay_approve" });
  });
});
