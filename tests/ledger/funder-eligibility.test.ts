/**
 * Funders a client cannot apply to.
 *
 * The grant side has screened for this from the start. The funder side never
 * has, so a for-profit's shortlist could carry foundations whose own guidelines
 * say they fund registered charities only.
 *
 * The discipline: screen on what the funder actually stated, never on silence.
 */
import { describe, expect, test } from "vitest";
import { funderBlock } from "@/lib/funder-eligibility";
import { screenFunders } from "@/lib/funder-screen";
import type { FunderRow } from "@/lib/funder-rows";
import type { EligibilityProfile } from "@/lib/eligibility-fields";

const row = (o: Partial<FunderRow>): FunderRow => ({
  funder_id: "1", ein: "1", name: "A Fund", website: null, location: null,
  focus: null, mission: null, typical_grant_range: null, match_reason: null,
  confidence: null, caveat: null, evidence: [], evidence_count: 0,
  from_graph: false, from_overlay: false,
  access_mode: "unknown", access_note: null, access_verified: false,
  has_grant_history: true, verified_at: null, ...o,
});

const forProfit = { org_type: "for_profit", tax_status: null } as unknown as EligibilityProfile;
const nonprofit = { org_type: "nonprofit_501c3", tax_status: "501c3" } as unknown as EligibilityProfile;
const gov = { org_type: "government", tax_status: null } as unknown as EligibilityProfile;

describe("funderBlock", () => {
  test("a charities-only funder blocks a for-profit", () => {
    const b = funderBlock(row({ access_note: "We fund 501(c)(3) organizations only." }), forProfit);
    expect(b?.reason).toBe("funds registered charities only");
    expect(b?.evidence).toContain("501(c)(3)");
  });

  test("…and does not block a nonprofit", () => {
    expect(funderBlock(row({ access_note: "We fund 501(c)(3) organizations only." }), nonprofit)).toBeNull();
  });

  test("a government-only funder blocks a nonprofit", () => {
    expect(funderBlock(row({ caveat: "Grants to units of local government." }), nonprofit)?.reason)
      .toBe("funds government entities only");
  });

  test("…and does not block a government applicant", () => {
    expect(funderBlock(row({ caveat: "Grants to units of local government." }), gov)).toBeNull();
  });

  test("a scholarship fund blocks every organization", () => {
    expect(funderBlock(row({ access_note: "Only makes grants to individuals." }), nonprofit)?.reason)
      .toBe("grants to individuals, not organizations");
  });

  test("'not accepting' blocks, because there is nothing to do this cycle", () => {
    expect(funderBlock(row({ access_mode: "closed" }), nonprofit)?.reason).toBe("not accepting requests");
  });

  test("invitation only does NOT block", () => {
    // A funder that will not read a cold application may still be reachable
    // through a board connection, and knowing how is For Granted's business.
    // The row is already labelled; hiding it would lose a real prospect.
    expect(funderBlock(row({ access_mode: "invitation_only" }), nonprofit)).toBeNull();
    expect(funderBlock(row({ access_mode: "preselected_only" }), nonprofit)).toBeNull();
  });

  test("silence never blocks", () => {
    // "Unknown" is not "ineligible", and most funders will be unknown for a
    // long time yet.
    expect(funderBlock(row({}), forProfit)).toBeNull();
    expect(funderBlock(row({ focus: "Health" }), forProfit)).toBeNull();
  });

  test("a funder describing charities without restricting to them does not block", () => {
    // "supports charitable work" is not "501(c)(3) only".
    expect(funderBlock(row({ focus: "Supports charitable work across Ohio" }), forProfit)).toBeNull();
  });
});

describe("screenFunders with an eligibility profile", () => {
  test("an ineligible funder is set aside with its own reason", () => {
    const { shown, hidden } = screenFunders(
      [row({ name: "Charities Only Fund", access_note: "501(c)(3) organizations only" })],
      forProfit,
    );
    expect(shown).toHaveLength(0);
    expect(hidden[0].reason).toBe("funds registered charities only");
  });

  test("eligibility and data quality stay distinct reasons", () => {
    const { hidden } = screenFunders([
      row({ funder_id: "a", access_note: "501(c)(3) organizations only" }),
      row({ funder_id: "b", has_grant_history: false }),
    ], forProfit);
    expect(new Set(hidden.map(h => h.reason)))
      .toEqual(new Set(["funds registered charities only", "no grants on record"]));
  });

  test("with no profile, only the data-quality screen runs", () => {
    // No profile means nothing to be ineligible against, and guessing would be
    // worse than not screening.
    const { shown } = screenFunders([row({ access_note: "501(c)(3) organizations only" })], null);
    expect(shown).toHaveLength(1);
  });

  test("an eligible funder passes both screens", () => {
    const { shown } = screenFunders([row({ access_note: "Open to nonprofits in Ohio" })], nonprofit);
    expect(shown).toHaveLength(1);
  });
});
