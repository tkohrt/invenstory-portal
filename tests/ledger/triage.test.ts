import { describe, it, expect } from "vitest";
import {
  FUNDER_STATES, GRANT_STATES, statesFor, stateAllowed, suppresses,
  reasonRequired, validateTriage, proposesCorrection, findReason,
  FUNDER_REASONS, GRANT_REASONS, STATE_LABEL, STATE_HELP,
  type TriageState,
} from "@/lib/triage";

describe("two vocabularies, not one", () => {
  it("keeps funder and grant states apart", () => {
    expect(stateAllowed("funder", "watching")).toBe(true);
    expect(stateAllowed("grant", "watching")).toBe(false);
    expect(stateAllowed("grant", "pinned")).toBe(true);
    expect(stateAllowed("funder", "pinned")).toBe(false);
  });

  it("gives funders somewhere to put 'yes, but not this cycle'", () => {
    // The reason the two vocabularies exist. pin/reject forces that answer
    // into one of two boxes that both misrepresent it.
    expect(FUNDER_STATES).toContain("watching");
    expect(suppresses("watching")).toBe(false);
  });

  it("labels and help text exist for every state in both lanes", () => {
    for (const st of [...FUNDER_STATES, ...GRANT_STATES] as TriageState[]) {
      expect(STATE_LABEL[st]).toBeTruthy();
      expect(STATE_HELP[st]).toBeTruthy();
    }
  });

  it("offers the right list per kind", () => {
    expect(statesFor("funder")).toEqual(FUNDER_STATES);
    expect(statesFor("grant")).toEqual(GRANT_STATES);
  });
});

describe("a reason is required exactly when a row is ruled out", () => {
  it("requires one to rule out, and not otherwise", () => {
    expect(reasonRequired("not_a_fit")).toBe(true);
    expect(reasonRequired("rejected")).toBe(true);
    expect(reasonRequired("target")).toBe(false);
    expect(reasonRequired("watching")).toBe(false);
    expect(reasonRequired("under_review")).toBe(false);
  });

  it("refuses a rejection with no reason", () => {
    const r = validateTriage("grant", "rejected", null);
    expect(r.ok).toBe(false);
  });

  it("refuses a reason borrowed from the other lane", () => {
    // "wrong_geography" is a funder judgment; a solicitation is not a place.
    expect(validateTriage("grant", "rejected", "wrong_geography").ok).toBe(false);
    expect(validateTriage("funder", "not_a_fit", "deadline_passed").ok).toBe(false);
  });

  it("drops a reason supplied for a state that does not take one", () => {
    const r = validateTriage("funder", "target", "wrong_cause");
    expect(r.ok && r.reason).toBe(null);
  });

  it("accepts a well-formed judgment", () => {
    const r = validateTriage("funder", "not_a_fit", "values_conflict");
    expect(r.ok && r.state).toBe("not_a_fit");
    expect(r.ok && r.reason).toBe("values_conflict");
  });

  it("rejects a state that does not exist at all", () => {
    expect(validateTriage("funder", "deleted", null).ok).toBe(false);
  });
});

describe("which rejections are claims about the shared record", () => {
  it("proposes a correction for a fact true of every client", () => {
    expect(proposesCorrection("funder", "not_a_fit", "not_a_grantmaker")?.code)
      .toBe("not_a_grantmaker");
    expect(proposesCorrection("grant", "rejected", "not_a_grant")?.code).toBe("not_a_grant");
  });

  it("does not propose one for a judgment about this client", () => {
    expect(proposesCorrection("funder", "not_a_fit", "values_conflict")).toBeNull();
    expect(proposesCorrection("funder", "not_a_fit", "wrong_geography")).toBeNull();
  });

  it("needs the STATE to be a rejection, not just the code", () => {
    // Watching a funder that happens to be invitation only is not a claim
    // that they are invitation only for everybody.
    expect(proposesCorrection("funder", "watching", "invitation_only")).toBeNull();
    expect(proposesCorrection("funder", "not_a_fit", "invitation_only")?.global).toBe(true);
  });

  it("every reason code carries a label and an explanation", () => {
    for (const c of [...FUNDER_REASONS, ...GRANT_REASONS]) {
      expect(c.label).toBeTruthy();
      expect(c.help).toBeTruthy();
      expect(typeof c.global).toBe("boolean");
    }
  });

  it("keeps values_conflict client-specific in both lanes", () => {
    // A client refusing this money says nothing about the record itself.
    expect(findReason("funder", "values_conflict")?.global).toBe(false);
    expect(findReason("grant", "values_conflict")?.global).toBe(false);
  });

  it("has no duplicate codes within a lane", () => {
    for (const list of [FUNDER_REASONS, GRANT_REASONS]) {
      expect(new Set(list.map(c => c.code)).size).toBe(list.length);
    }
  });
});
