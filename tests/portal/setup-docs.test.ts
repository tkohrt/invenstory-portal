// Fixing a document after it has arrived, from the setup list (patch 60).
import { describe, expect, it } from "vitest";
import { NOT_SURE_LABEL, analysedLine, canRemoveInSetup, looksLikeDocId, removeQuestion, suggestionFor } from "@/lib/setup-docs";

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


describe("the suggestion offered on a row (patch 61)", () => {
  const known = (k: string) => ["irs_990", "pitch_deck", "other"].includes(k);
  it("offers the analysis's type when nobody has typed the document", () => {
    expect(suggestionFor(null, "irs_990", known)).toBe("irs_990");
    expect(suggestionFor("", "irs_990", known)).toBe("irs_990");
  });
  it("offers nothing once a person has typed it", () => {
    expect(suggestionFor("pitch_deck", "irs_990", known)).toBeNull();
  });
  it("treats Other, nothing, and a type the portal does not know as no suggestion", () => {
    expect(suggestionFor(null, "other", known)).toBeNull();
    expect(suggestionFor(null, null, known)).toBeNull();
    expect(suggestionFor(null, "made_up_type", known)).toBeNull();
  });
  it("no longer promises to set a type by itself", () => {
    expect(NOT_SURE_LABEL).toContain("for you to confirm");
  });
});

describe("the completion screen's analysed line (patch 61)", () => {
  it("says how far the analysis has got", () => {
    expect(analysedLine(12, 14)).toBe("We’ve analysed 12 of your 14 documents so far. The rest are being read now and finish on their own.");
  });
  it("says when everything is analysed", () => {
    expect(analysedLine(14, 14)).toBe("We’ve analysed all 14 of your documents.");
    expect(analysedLine(1, 1)).toBe("We’ve analysed your document.");
  });
  it("never claims more than there are, and says nothing with no documents", () => {
    expect(analysedLine(20, 14)).toBe("We’ve analysed all 14 of your documents.");
    expect(analysedLine(0, 0)).toBeNull();
    expect(analysedLine(-3, 5)).toContain("0 of your 5");
  });
});
