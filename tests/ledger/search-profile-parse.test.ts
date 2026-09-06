/**
 * Turning a model's answer into facts.
 *
 * The rule these exist to enforce: no verbatim quote, no fact. That is exactly
 * the failure the readiness engine spent two iterations eliminating, a
 * plausible sentence sourced to nothing that reads as evidence. Here it would
 * silently become search text and send a client after the wrong money.
 */
import { describe, expect, test } from "vitest";
import { parseFacts, mergeFacts, documentFingerprint, MAX_PER_FACET } from "@/lib/search-profile";
import type { ProfileFact } from "@/lib/search-profile";

const src = { documentId: "d1", documentTitle: "Strategic Plan", layer: "II" as const };
const json = (o: unknown) => JSON.stringify(o);

describe("parseFacts", () => {
  test("reads a well-formed answer", () => {
    const out = parseFacts(json([
      { facet: "need", text: "two more case managers", quote: "We need two more case managers.", subject: "organization" },
    ]), src);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      facet: "need", text: "two more case managers", documentId: "d1", layer: "II", subject: "organization",
    });
  });

  test("a fact with no quote is dropped", () => {
    const out = parseFacts(json([{ facet: "need", text: "expanding capacity", quote: "", subject: "organization" }]), src);
    expect(out).toEqual([]);
  });

  test("a quote with no text is dropped", () => {
    expect(parseFacts(json([{ facet: "work", text: "", quote: "We run a food bank." }]), src)).toEqual([]);
  });

  test("an unknown facet is dropped rather than guessed at", () => {
    expect(parseFacts(json([{ facet: "vibes", text: "good", quote: "good" }]), src)).toEqual([]);
  });

  test("the subject is carried through", () => {
    const out = parseFacts(json([
      { facet: "work", text: "a rival platform", quote: "Acme also does this.", subject: "competitor" },
    ]), src);
    expect(out[0].subject).toBe("competitor");
  });

  test("an omitted subject defaults to organization, like doc-extract", () => {
    const out = parseFacts(json([{ facet: "work", text: "job training", quote: "We run job training." }]), src);
    expect(out[0].subject).toBe("organization");
  });

  test("a nonsense subject falls back rather than being stored", () => {
    const out = parseFacts(json([{ facet: "work", text: "x", quote: "y", subject: "aliens" }]), src);
    expect(out[0].subject).toBe("organization");
  });

  test("prose around the JSON is tolerated", () => {
    const out = parseFacts(
      `Here is what I found:\n${json([{ facet: "identity", text: "nonprofit", quote: "We are a nonprofit." }])}\nHope that helps.`,
      src);
    expect(out).toHaveLength(1);
  });

  test("malformed JSON returns nothing rather than throwing", () => {
    expect(parseFacts("[{facet: broken", src)).toEqual([]);
    expect(parseFacts("no json here at all", src)).toEqual([]);
    expect(parseFacts("", src)).toEqual([]);
  });

  test("a non-array payload returns nothing", () => {
    expect(parseFacts(json({ facet: "work" }), src)).toEqual([]);
  });

  test("runaway text is capped rather than stored whole", () => {
    const out = parseFacts(json([{ facet: "work", text: "x".repeat(900), quote: "y".repeat(2000) }]), src);
    expect(out[0].text.length).toBeLessThanOrEqual(300);
    expect(out[0].quote.length).toBeLessThanOrEqual(600);
  });
});

const fact = (o: Partial<ProfileFact>): ProfileFact => ({
  facet: "work", text: "job training", quote: "q", documentId: "d", documentTitle: "t",
  layer: "I", subject: "organization", ...o,
});

describe("mergeFacts", () => {
  test("the same sentence from three documents becomes one fact", () => {
    // The website capture, the strategic plan and the board deck all say it.
    const out = mergeFacts([
      fact({ documentId: "a" }), fact({ documentId: "b" }), fact({ documentId: "c" }),
    ]);
    expect(out).toHaveLength(1);
  });

  test("punctuation and case do not make a fact distinct", () => {
    expect(mergeFacts([fact({ text: "Job Training." }), fact({ text: "job training" })])).toHaveLength(1);
  });

  test("internal strategy outranks the public story within a facet", () => {
    // Layer II says what they need; Layer I says what they want the world to
    // think. For finding money the first is worth more.
    const out = mergeFacts([
      fact({ text: "public framing", layer: "I" }),
      fact({ text: "internal priority", layer: "II" }),
    ]);
    expect(out[0].text).toBe("internal priority");
  });

  test("each facet is capped, because thirty phrasings query worse than three", () => {
    const many = Array.from({ length: 20 }, (_, i) => fact({ text: `programme ${i}` }));
    expect(mergeFacts(many)).toHaveLength(MAX_PER_FACET);
  });

  test("the cap is per facet, not overall", () => {
    const out = mergeFacts([
      ...Array.from({ length: 10 }, (_, i) => fact({ facet: "work", text: `w${i}` })),
      ...Array.from({ length: 10 }, (_, i) => fact({ facet: "need", text: `n${i}` })),
    ]);
    expect(out.filter(f => f.facet === "work")).toHaveLength(MAX_PER_FACET);
    expect(out.filter(f => f.facet === "need")).toHaveLength(MAX_PER_FACET);
  });

  test("competitor facts survive the merge, to be quarantined later not here", () => {
    const out = mergeFacts([fact({ subject: "competitor", text: "rival product" })]);
    expect(out).toHaveLength(1);
    expect(out[0].subject).toBe("competitor");
  });

  test("nothing in, nothing out", () => {
    expect(mergeFacts([])).toEqual([]);
  });
});

describe("documentFingerprint", () => {
  test("the same set of documents fingerprints the same, whatever the order", () => {
    expect(documentFingerprint([{ id: "b" }, { id: "a" }]))
      .toBe(documentFingerprint([{ id: "a" }, { id: "b" }]));
  });

  test("adding a document changes it, which is how staleness is noticed", () => {
    expect(documentFingerprint([{ id: "a" }])).not.toBe(documentFingerprint([{ id: "a" }, { id: "b" }]));
  });

  test("removing one changes it too", () => {
    expect(documentFingerprint([{ id: "a" }, { id: "b" }])).not.toBe(documentFingerprint([{ id: "a" }]));
  });

  test("an empty Inven(s)tory has a fingerprint rather than throwing", () => {
    expect(documentFingerprint([])).toBeTruthy();
  });
});
