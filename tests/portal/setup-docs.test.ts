// Fixing a document after it has arrived, from the setup list (patch 60).
import { describe, expect, it } from "vitest";
import { canRemoveInSetup, looksLikeDocId, removeQuestion } from "@/lib/setup-docs";

describe("canRemoveInSetup", () => {
  it("lets a client remove what their own organization added", () => {
    expect(canRemoveInSetup({ source: "client", status: "ready" })).toEqual({ ok: true });
    expect(canRemoveInSetup({ source: "client", status: "failed" }).ok).toBe(true);
    expect(canRemoveInSetup({ source: "client", status: "pending" }).ok).toBe(true);
  });

  it("never offers For Granted's documents", () => {
    const v = canRemoveInSetup({ source: "for_granted", status: "ready" });
    expect(v.ok).toBe(false);
    expect(v.why).toContain("For Granted added this document");
  });

  it("treats an unknown source as not the client's", () => {
    expect(canRemoveInSetup({ source: null, status: "ready" }).ok).toBe(false);
    expect(canRemoveInSetup({ source: undefined, status: "ready" }).ok).toBe(false);
    expect(canRemoveInSetup({ source: "someone", status: "ready" }).ok).toBe(false);
  });

  it("waits while a document is being read", () => {
    const v = canRemoveInSetup({ source: "client", status: "processing" });
    expect(v.ok).toBe(false);
    expect(v.why).toContain("being read");
  });
});

describe("the words and the id check", () => {
  it("names the document and says removal cannot be undone", () => {
    const q = removeQuestion("Annual report.pdf");
    expect(q).toContain("Annual report.pdf");
    expect(q).toContain("cannot be undone");
  });
  it("accepts a database id and nothing else", () => {
    expect(looksLikeDocId("3f2b6c1e-9a4d-4e2b-8c1f-0a1b2c3d4e5f")).toBe(true);
    expect(looksLikeDocId("3f2b6c1e")).toBe(false);
    expect(looksLikeDocId("x'; drop table document; --")).toBe(false);
    expect(looksLikeDocId(null)).toBe(false);
    expect(looksLikeDocId(42)).toBe(false);
  });
});
