import { describe, it, expect } from "vitest";
import { mergeFacts, MAX_PER_FACET, type ProfileFact } from "@/lib/search-profile";

const fact = (facet: ProfileFact["facet"], layer: "I" | "II" | "III", n: number): ProfileFact => ({
  facet, text: `${layer}-${facet}-${n}`, quote: `q${n}`, subject: "organization",
  documentId: `d-${layer}`, documentTitle: `doc ${layer}`, layer,
});

const layersOf = (out: ProfileFact[]) => out.map(f => f.layer);

describe("mergeFacts takes from every layer", () => {
  /**
   * The regression. On RE-Assist 445 facts were extracted and 48 kept, all of
   * them Layer II: eight Layer II documents filled every facet to the cap
   * before a single transcript or public-story fact was considered.
   */
  it("does not let one layer fill a facet on its own", () => {
    const all = [
      ...Array.from({ length: 20 }, (_, i) => fact("work", "II", i)),
      ...Array.from({ length: 20 }, (_, i) => fact("work", "III", i)),
      ...Array.from({ length: 20 }, (_, i) => fact("work", "I", i)),
    ];
    const out = mergeFacts(all);
    expect(out).toHaveLength(MAX_PER_FACET);
    expect(layersOf(out).filter(l => l === "II").length).toBeGreaterThan(0);
    expect(layersOf(out).filter(l => l === "III").length).toBeGreaterThan(0);
    expect(layersOf(out).filter(l => l === "I").length).toBeGreaterThan(0);
  });

  it("splits an eight-slot facet evenly when all three layers are rich", () => {
    const all = [
      ...Array.from({ length: 10 }, (_, i) => fact("work", "II", i)),
      ...Array.from({ length: 10 }, (_, i) => fact("work", "III", i)),
      ...Array.from({ length: 10 }, (_, i) => fact("work", "I", i)),
    ];
    const counts = layersOf(mergeFacts(all)).reduce<Record<string, number>>(
      (a, l) => ({ ...a, [l ?? "?"]: (a[l ?? "?"] ?? 0) + 1 }), {});
    // Eight slots over three layers: nobody gets fewer than two, and the extra
    // pair goes to the higher ranks rather than anywhere.
    expect(counts.II).toBeGreaterThanOrEqual(2);
    expect(counts.III).toBeGreaterThanOrEqual(2);
    expect(counts.I).toBeGreaterThanOrEqual(2);
    expect(counts.II).toBeGreaterThanOrEqual(counts.I);
  });

  it("still puts the strongest layer first", () => {
    const all = [fact("work", "I", 1), fact("work", "III", 1), fact("work", "II", 1)];
    expect(layersOf(mergeFacts(all))).toEqual(["II", "III", "I"]);
  });

  it("does not shorten a profile for a client with only one layer", () => {
    const all = Array.from({ length: 20 }, (_, i) => fact("work", "II", i));
    // A client with no transcripts and no public story still gets a full facet:
    // the empty layers do not take their turn, they do not reserve a slot.
    expect(mergeFacts(all)).toHaveLength(MAX_PER_FACET);
  });

  it("keeps the stronger layer's copy of a fact stated twice", () => {
    const a = fact("work", "I", 1);
    const b = { ...fact("work", "III", 1), text: a.text };
    const out = mergeFacts([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].layer).toBe("III");
  });

  it("caps each facet independently", () => {
    const all = [
      ...Array.from({ length: 20 }, (_, i) => fact("work", "II", i)),
      ...Array.from({ length: 20 }, (_, i) => fact("need", "III", i)),
    ];
    const out = mergeFacts(all);
    expect(out.filter(f => f.facet === "work")).toHaveLength(MAX_PER_FACET);
    expect(out.filter(f => f.facet === "need")).toHaveLength(MAX_PER_FACET);
  });
});
