/**
 * Funder corrections have to reach a funder view.
 *
 * Until this existed, runMatch merged the grant overlay and returned funder
 * results raw, so every verification recorded through the picker was approved
 * and then ignored. These tests pin the output side of the review loop.
 */
import { describe, expect, test } from "vitest";
import { applyFunderOverlay } from "@/lib/ledger-merge";
import type { FunderCard } from "@/lib/ledger-types";
import type { LedgerOverlayRow } from "@/lib/types";

const funder = (o: Partial<FunderCard>): FunderCard =>
  ({ name: "A Fund", ein: "340714588", ...o } as FunderCard);

const row = (o: Partial<LedgerOverlayRow>): LedgerOverlayRow => ({
  id: "o1", kind: "funder", base_id: null, ein: null, opportunity_number: null,
  fields: {}, status: "approved", source_url: null, provenance: "manual",
  confidence: "high", reviewed_at: "2026-08-12T00:00:00Z", reviewed_by: null,
  surfaced_for_tenant: null, proposed_by: null, created_at: "2026-08-01T00:00:00Z",
  ...o,
} as unknown as LedgerOverlayRow);

describe("applyFunderOverlay", () => {
  test("a correction keyed by EIN overrides the base card", () => {
    const out = applyFunderOverlay(
      [funder({ typical_grant_range: "Up to $11M" })],
      [row({ base_id: "340714588", fields: { typical_grant_range: "$25,000–$100,000" } })],
    );
    expect(out[0].typical_grant_range).toBe("$25,000–$100,000");
    expect(out[0].name).toBe("A Fund");   // untouched fields survive
  });

  test("the EIN the picker writes is the EIN the merge matches on", () => {
    // The picker sets base_id = candidate.ein. If these two ever disagree the
    // whole loop silently stops working, which is what this test is for.
    const out = applyFunderOverlay(
      [funder({ ein: "340714588", website: "https://old.example" })],
      [row({ base_id: "340714588", fields: { website: "https://new.example" } })],
    );
    expect(out[0].website).toBe("https://new.example");
  });

  test("a correction for a funder not in these results does not leak in", () => {
    const out = applyFunderOverlay(
      [funder({ ein: "111111111" })],
      [row({ base_id: "999999999", fields: { name: "Somebody Else" } })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("A Fund");
  });

  test("an approved new funder is appended, even when the search returned nothing", () => {
    const out = applyFunderOverlay([], [row({ ein: "555", fields: { name: "FG Discovery Fund" } })]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("FG Discovery Fund");
  });

  test("FG sourcing never reaches the card", () => {
    // These runs feed client views. reveal stays off.
    const out = applyFunderOverlay(
      [funder({})],
      [row({ base_id: "340714588", fields: { name: "Corrected" }, source_url: "https://internal.example" })],
    );
    expect(JSON.stringify(out)).not.toContain("internal.example");
  });

  test("a funder with no EIN passes through rather than being dropped", () => {
    const out = applyFunderOverlay(
      [funder({ ein: undefined, name: "Anonymous Trust" })],
      [row({ base_id: "340714588", fields: { name: "X" } })],
    );
    expect(out.some(f => f.name === "Anonymous Trust")).toBe(true);
  });

  test("an empty overlay is a no-op", () => {
    const base = [funder({})];
    expect(applyFunderOverlay(base, [])).toBe(base);
  });

  test("two EIN-less funders do not collapse onto one shared id", () => {
    // mergeOverlay's contract is that an id names ONE record. Handing every
    // anonymous trust the same empty id lets a single fold-in splice one
    // funder's fields onto all of them.
    const out = applyFunderOverlay(
      [funder({ ein: undefined, name: "Trust One" }), funder({ ein: "", name: "Trust Two" })],
      [row({ ein: "555", fields: { name: "FG Discovery Fund" } })],
    );
    expect(out.filter(f => f.name === "Trust One")).toHaveLength(1);
    expect(out.filter(f => f.name === "Trust Two")).toHaveLength(1);
    expect(out.some(f => f.name === "FG Discovery Fund")).toBe(true);
  });

  test("FG working notes never ride onto a card", () => {
    // `notes` is a fields key — "who you spoke to, what changed" — and fields
    // are spread wholesale onto the record. reveal:false was only stripping the
    // _overlay stamp.
    const out = applyFunderOverlay(
      [funder({})],
      [row({ base_id: "340714588", fields: { name: "Corrected", notes: "Jane hates our last client" } })],
    );
    expect(out[0].name).toBe("Corrected");
    expect(JSON.stringify(out)).not.toContain("hates our last client");
  });

  test("additions:false keeps FG discoveries out of the graph-evidence list", () => {
    // The evidence list asserts "the graph shows these funders already backing
    // organizations like yours". An FG-found funder with no graph history is
    // not that, and counting it there is a false claim.
    const overlay = [
      row({ id: "add", ein: "555", fields: { name: "FG Discovery Fund" } }),
      row({ id: "fix", base_id: "340714588", fields: { website: "https://new.example" } }),
    ];
    const evidence = applyFunderOverlay([funder({})], overlay, { additions: false });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].website).toBe("https://new.example");   // corrections still apply

    // …while the discovery list does take them.
    expect(applyFunderOverlay([funder({})], overlay)).toHaveLength(2);
  });
});
