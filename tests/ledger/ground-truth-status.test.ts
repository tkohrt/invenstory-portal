/**
 * Which state a base record is in, as shown on every row of the picker.
 *
 * The third state (a correction already pending) is the one that earns its
 * keep: without it two people file competing corrections and the unique partial
 * index rejects the second at approve time, which is late and confusing.
 */
import { describe, expect, test } from "vitest";
import { resolveGroundTruthStatus, type StatusRow } from "@/lib/ledger-status";

const row = (o: Partial<StatusRow>): StatusRow => ({
  id: "r1", base_id: null, ein: null, status: "proposed", reviewed_at: null, ...o,
});

describe("resolveGroundTruthStatus", () => {
  test("an EIN with no rows is base only", () => {
    expect(resolveGroundTruthStatus(["340714588"], [])["340714588"].state).toBe("base");
  });

  test("an approved correction reads as verified, with who and when", () => {
    const s = resolveGroundTruthStatus(["340714588"], [
      row({ ein: "340714588", status: "approved", reviewed_at: "2026-08-12T00:00:00Z", reviewer_name: "Shane" }),
    ]);
    expect(s["340714588"].state).toBe("verified");
    expect(s["340714588"].verified_by).toBe("Shane");
    expect(s["340714588"].verified_at).toBe("2026-08-12T00:00:00Z");
  });

  test("a proposal in the queue reads as pending, and carries its id", () => {
    const s = resolveGroundTruthStatus(["1"], [row({ id: "p9", ein: "1", status: "proposed" })]);
    expect(s["1"].state).toBe("pending");
    expect(s["1"].pending_id).toBe("p9");
  });

  test("in_review counts as pending too", () => {
    expect(resolveGroundTruthStatus(["1"], [row({ ein: "1", status: "in_review" })])["1"].state).toBe("pending");
  });

  test("approved outranks pending, because that is what matching is using", () => {
    const s = resolveGroundTruthStatus(["1"], [
      row({ id: "p1", ein: "1", status: "proposed" }),
      row({ id: "a1", ein: "1", status: "approved", reviewed_at: "2026-08-01T00:00:00Z" }),
    ]);
    expect(s["1"].state).toBe("verified");
    expect(s["1"].pending_id).toBe("p1");   // still surfaced, so the UI can mention it
  });

  test("rejected and superseded rows say nothing about the current state", () => {
    const s = resolveGroundTruthStatus(["1"], [
      row({ ein: "1", status: "rejected" }),
      row({ ein: "1", status: "superseded" }),
    ]);
    expect(s["1"].state).toBe("base");
  });

  test("matches on base_id as well as ein, so a correction is never invisible", () => {
    expect(resolveGroundTruthStatus(["1"], [row({ base_id: "1", status: "approved" })])["1"].state).toBe("verified");
  });

  test("resolves each candidate independently in a mixed batch", () => {
    const s = resolveGroundTruthStatus(["a", "b", "c"], [
      row({ ein: "a", status: "approved", reviewed_at: "2026-08-01T00:00:00Z" }),
      row({ ein: "b", status: "proposed" }),
    ]);
    expect([s.a.state, s.b.state, s.c.state]).toEqual(["verified", "pending", "base"]);
  });

  test("the newest approval wins if there are somehow two", () => {
    const s = resolveGroundTruthStatus(["1"], [
      row({ ein: "1", status: "approved", reviewed_at: "2026-07-01T00:00:00Z", reviewer_name: "Old" }),
      row({ ein: "1", status: "approved", reviewed_at: "2026-08-01T00:00:00Z", reviewer_name: "New" }),
    ]);
    expect(s["1"].verified_by).toBe("New");
  });

  test("rows for other records never leak into a candidate's status", () => {
    expect(resolveGroundTruthStatus(["1"], [row({ ein: "999", status: "approved" })])["1"].state).toBe("base");
  });
});
