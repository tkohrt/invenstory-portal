/**
 * Hiding a funder is a claim that it cannot be approached, so the bar is high.
 *
 * The evidence this exists for: a live find_funders call for Ohio private
 * foundations returned twenty results, twelve with has_grant_history false.
 * Semantic search matches mission text, and an operating charity's mission text
 * reads like a funder's because they describe the same work from opposite sides
 * of the cheque.
 *
 * What has NOT been measured is how often that flag is itself wrong, which is
 * why every other signal outranks it and nothing is deleted.
 */
import { describe, expect, test } from "vitest";
import { screenFunders, hiddenByScreen } from "@/lib/funder-screen";
import type { FunderRow } from "@/lib/funder-rows";

const row = (o: Partial<FunderRow>): FunderRow => ({
  funder_id: "1", ein: "1", name: "A Fund", website: null, location: null,
  focus: null, mission: null, typical_grant_range: null, match_reason: null,
  confidence: null, caveat: null, evidence: [], evidence_count: 0,
  from_graph: false, from_overlay: false,
  access_mode: "unknown", access_note: null, access_verified: false,
  has_grant_history: true, verified_at: null, ...o,
});

describe("screenFunders", () => {
  test("an explicit false with nothing vouching for it is set aside", () => {
    const { shown, hidden } = screenFunders([row({ has_grant_history: false })]);
    expect(shown).toHaveLength(0);
    expect(hidden).toHaveLength(1);
  });

  test("nothing is ever deleted", () => {
    const rows = [row({ funder_id: "a", has_grant_history: false }), row({ funder_id: "b" })];
    const { shown, hidden } = screenFunders(rows);
    expect(shown.length + hidden.length).toBe(2);
  });

  test("an ABSENT flag never hides a row", () => {
    // Hiding on missing data hides the records we know least about, which is
    // backwards. null is not false.
    expect(screenFunders([row({ has_grant_history: null })]).hidden).toHaveLength(0);
  });

  test("the graph outranks the flag", () => {
    // The who-funds-whom graph put it here, which requires real grant edges.
    const { hidden } = screenFunders([row({ has_grant_history: false, from_graph: true })]);
    expect(hidden).toHaveLength(0);
  });

  test("named peer grantees outrank the flag", () => {
    // Those are grants, whatever the flag says.
    const { hidden } = screenFunders([row({
      has_grant_history: false, evidence_count: 2,
      evidence: [{ name: "Peer One" }, { name: "Peer Two" }],
    })]);
    expect(hidden).toHaveLength(0);
  });

  test("a funder For Granted added by hand is never second-guessed", () => {
    const { hidden } = screenFunders([row({ has_grant_history: false, from_overlay: true })]);
    expect(hidden).toHaveLength(0);
  });

  test("a true flag is shown, obviously", () => {
    expect(screenFunders([row({ has_grant_history: true })]).shown).toHaveLength(1);
  });

  test("order is preserved within each group, so the ranking survives", () => {
    const rows = [
      row({ funder_id: "1", name: "First" }),
      row({ funder_id: "2", name: "Hidden", has_grant_history: false }),
      row({ funder_id: "3", name: "Second" }),
    ];
    const { shown } = screenFunders(rows);
    expect(shown.map(r => r.name)).toEqual(["First", "Second"]);
  });

  test("an empty list is empty on both sides", () => {
    expect(screenFunders([])).toEqual({ shown: [], hidden: [] });
  });

  test("everything can be hidden without throwing", () => {
    const { shown, hidden } = screenFunders([
      row({ funder_id: "1", has_grant_history: false }),
      row({ funder_id: "2", has_grant_history: false }),
    ]);
    expect(shown).toEqual([]);
    expect(hidden).toHaveLength(2);
  });
});

describe("a human verification outranks the flag", () => {
  test("a verified row is never hidden, even with the flag false", () => {
    // The picker shows "no grant history on record" before you attach, so a
    // verification IS somebody seeing that warning and correcting it anyway.
    // Hiding it afterwards overrules the human with the flag they overruled.
    const { hidden } = screenFunders([row({
      has_grant_history: false, verified_at: "2026-03-01T00:00:00Z",
    })]);
    expect(hidden).toHaveLength(0);
  });

  test("hiddenByScreen and screenFunders are the same predicate", () => {
    // They are rendered in two places: the partition, and the inline warning on
    // the row. Two conditions meaning the same thing, written twice, drift.
    const cases = [
      row({ has_grant_history: false }),
      row({ has_grant_history: false, from_graph: true }),
      row({ has_grant_history: false, from_overlay: true }),
      row({ has_grant_history: false, verified_at: "2026-03-01T00:00:00Z" }),
      row({ has_grant_history: false, evidence_count: 1 }),
      row({ has_grant_history: null }),
      row({ has_grant_history: true }),
    ];
    for (const c of cases) {
      const { hidden } = screenFunders([c]);
      expect(hiddenByScreen(c)).toBe(hidden.length === 1);
    }
  });
});
