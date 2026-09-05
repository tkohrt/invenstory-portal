/**
 * The most useful field about a funder, and the one the base dataset lacks.
 *
 * Two properties are load-bearing:
 *   - an inference is never presented as a fact
 *   - "unknown" is an honest answer, and the default is never "open"
 */
import { describe, expect, test } from "vitest";
import { inferAccessMode, resolveAccess, ACCESS_LABEL, ACCESS_MODES } from "@/lib/access-mode";
import { funderRowsFrom } from "@/lib/funder-rows";
import type { FunderCard } from "@/lib/ledger-types";

const f = (o: Partial<FunderCard>): FunderCard =>
  ({ name: "A Fund", ein: "340714588", ...o } as FunderCard);

describe("inferAccessMode", () => {
  test("reads a real caveat from the graph tool", () => {
    // Verbatim from funders_who_fund_orgs_like_mine.
    const caveat = "Community foundation: much of its giving is donor-advised. "
      + "Look specifically for its competitive/discretionary grant programs when approaching.";
    const a = inferAccessMode(caveat, "community_foundation");
    expect(a?.mode).toBe("donor_advised");
    expect(a?.verified).toBe(false);
    expect(a?.note).toBe(caveat);   // relayed verbatim, never paraphrased
  });

  test("'does not accept unsolicited proposals' is invitation only", () => {
    expect(inferAccessMode("The Foundation does not accept unsolicited proposals.")?.mode)
      .toBe("invitation_only");
  });

  test("being told you cannot apply outranks being told it is donor-advised", () => {
    // A caveat can say both. The half that changes what you do comes first.
    expect(inferAccessMode("Donor-advised fund; does not accept unsolicited requests.")?.mode)
      .toBe("invitation_only");
  });

  test("an RFP cycle is recognised", () => {
    expect(inferAccessMode("Gives through an annual request for proposals.")?.mode).toBe("rfp_cycle");
  });

  test("the DAF-sponsor classification alone is enough to guess", () => {
    const a = inferAccessMode(null, "donor_advised_fund_sponsor");
    expect(a?.mode).toBe("donor_advised");
    expect(a?.verified).toBe(false);
  });

  test("nothing to go on returns null rather than a guess", () => {
    expect(inferAccessMode(null, "private_foundation")).toBeNull();
    expect(inferAccessMode("   ", null)).toBeNull();
  });

  test("no inference is ever marked verified", () => {
    for (const c of ["donor-advised", "no unsolicited", "RFP", "not accepting"]) {
      expect(inferAccessMode(c)?.verified).toBe(false);
    }
  });
});

describe("resolveAccess", () => {
  test("a recorded Ground Truth answer wins and is verified", () => {
    const a = resolveAccess({
      access_mode: "invitation_only",
      access_note: '"We do not accept unsolicited proposals" — their Grants page',
      caveat: "Community foundation: much of its giving is donor-advised.",
    });
    expect(a.mode).toBe("invitation_only");
    expect(a.verified).toBe(true);
    expect(a.note).toContain("their Grants page");
  });

  test("with nothing recorded and nothing to infer, the answer is unknown", () => {
    const a = resolveAccess({});
    expect(a.mode).toBe("unknown");
    expect(a.verified).toBe(false);
  });

  test("the default is never 'open' — the one guess that costs a week", () => {
    expect(resolveAccess({}).mode).not.toBe("open");
    expect(resolveAccess({ caveat: "Some unrelated note." }).mode).not.toBe("open");
  });

  test("a junk recorded value falls through to inference rather than being trusted", () => {
    const a = resolveAccess({ access_mode: "definitely_open", caveat: "Donor-advised fund." });
    expect(a.mode).toBe("donor_advised");
    expect(a.verified).toBe(false);
  });

  test("an explicitly recorded 'unknown' is still unknown, not a verified claim", () => {
    expect(resolveAccess({ access_mode: "unknown" }).verified).toBe(false);
  });

  test("every mode has a label", () => {
    for (const m of ACCESS_MODES) expect(ACCESS_LABEL[m]).toBeTruthy();
  });
});

describe("access on a funder row", () => {
  test("a caveat on the graph card becomes an inferred access mode", () => {
    const rows = funderRowsFrom([], [f({
      caveat: "Community foundation: much of its giving is donor-advised.",
      evidence_grantees: [{ name: "Peer" }],
    })]);
    expect(rows[0].access_mode).toBe("donor_advised");
    expect(rows[0].access_verified).toBe(false);
  });

  test("a verified answer is never overwritten by a guess from the other list", () => {
    // The graph card carries a caveat we would infer from; the search card
    // carries what a person actually recorded. The person wins.
    const rows = funderRowsFrom(
      [f({ access_mode: "open", access_note: '"Apply any time" — their site' })],
      [f({ caveat: "Donor-advised fund.", evidence_grantees: [{ name: "Peer" }] })],
    );
    expect(rows[0].access_mode).toBe("open");
    expect(rows[0].access_verified).toBe(true);
  });

  test("…and that holds whichever list the verified answer arrives in", () => {
    const rows = funderRowsFrom(
      [f({ caveat: "Donor-advised fund." })],
      [f({ access_mode: "rfp_cycle", access_note: "Cycle opens in March.",
           evidence_grantees: [{ name: "Peer" }] })],
    );
    expect(rows[0].access_mode).toBe("rfp_cycle");
    expect(rows[0].access_verified).toBe(true);
  });

  test("a funder nobody has checked reads unknown", () => {
    expect(funderRowsFrom([f({})], [])[0].access_mode).toBe("unknown");
  });
});
