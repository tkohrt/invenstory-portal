/**
 * Two lists, one shortlist.
 *
 * `funders` is semantic search — who works on this kind of thing. `evidence` is
 * the who-funds-whom graph — who already writes cheques to organizations like
 * this one. The second is the differentiator, so a funder in both must come
 * back as one row that KEEPS the graph evidence, not two rows that read like
 * two separate findings.
 */
import { describe, expect, test } from "vitest";
import { funderRowsFrom, funderId } from "@/lib/funder-rows";
import type { FunderCard } from "@/lib/ledger-types";

const f = (o: Partial<FunderCard>): FunderCard =>
  ({ name: "A Fund", ein: "340714588", ...o } as FunderCard);

describe("funderId", () => {
  test("the EIN is the identity, because it is what the picker attaches to", () => {
    expect(funderId(f({ ein: "340714588" }))).toBe("340714588");
  });

  test("whitespace does not create a second identity for one funder", () => {
    expect(funderId(f({ ein: " 340714588 " }))).toBe("340714588");
  });

  test("an overlay-added funder keeps its namespaced id, which is stable across runs", () => {
    expect(funderId({ ...f({ ein: undefined }), id: "overlay:abc" } as never)).toBe("overlay:abc");
  });

  test("no EIN falls back to a name slug rather than a shared blank", () => {
    expect(funderId(f({ ein: undefined, name: "The Anonymous Trust" }))).toBe("name:the-anonymous-trust");
  });

  test("two different EIN-less funders get different ids", () => {
    const a = funderId(f({ ein: "", name: "Trust One" }));
    const b = funderId(f({ ein: "", name: "Trust Two" }));
    expect(a).not.toBe(b);
  });
});

describe("funderRowsFrom", () => {
  test("a funder in both lists is one row, not two", () => {
    const rows = funderRowsFrom([f({})], [f({})]);
    expect(rows).toHaveLength(1);
  });

  test("…and that row keeps the graph evidence and the graph flag", () => {
    // The failure this guards: the search record overwrites the graph record,
    // and the strongest signal on the page silently becomes the weakest.
    const rows = funderRowsFrom(
      [f({ mission: "A richer profile from search" })],
      [f({ evidence_grantees: [{ name: "Peer Org", amount_usd: 50000 }] })],
    );
    expect(rows[0].from_graph).toBe(true);
    expect(rows[0].evidence).toHaveLength(1);
    expect(rows[0].mission).toBe("A richer profile from search");   // gaps still filled
  });

  test("merging fills gaps and NEVER drops a caveat the graph carried", () => {
    // The worst bug this file has had: spreading the search record over the
    // graph record replaced every field including the nulls, so a
    // donor-advised fund lost the caveat saying it takes no unsolicited
    // proposals — while keeping the "already funds peers" badge.
    const caveat = "Donor-advised fund — does not accept unsolicited proposals.";
    const rows = funderRowsFrom(
      [f({ mission: "From search", caveat: undefined, website: undefined })],
      [f({ caveat, website: "https://graph.example", evidence_grantees: [{ name: "Peer" }] })],
    );
    expect(rows[0].caveat).toBe(caveat);
    expect(rows[0].website).toBe("https://graph.example");
    expect(rows[0].mission).toBe("From search");
  });

  test("a graph card with no grantees does not claim to fund peers", () => {
    // Otherwise the row asserts a giving history in one column and denies it
    // two columns later.
    const rows = funderRowsFrom([], [f({ evidence_grantees: [] })]);
    expect(rows[0].from_graph).toBe(false);
    expect(rows[0].evidence_count).toBe(0);
  });

  test("one funder, two EIN spellings, one row", () => {
    // "34-0714588" and "340714588" are the same funder. Two rows meant one
    // badged 'already funds peers' and one 'focus aligns', forever.
    const rows = funderRowsFrom(
      [f({ ein: "34-0714588" })],
      [f({ ein: "340714588", evidence_grantees: [{ name: "Peer" }] })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].funder_id).toBe("340714588");
    expect(rows[0].from_graph).toBe(true);
  });

  test("a malformed evidence payload is coerced, not thrown on", () => {
    // The service's wire shape has disagreed with its docs twice. A non-array
    // here would throw at upsert time, after the grant half was written.
    const rows = funderRowsFrom([], [
      { ...f({ ein: "1" }), evidence_grantees: { nope: true } } as never,
      { ...f({ ein: "2" }), evidence_grantees: [{ amount_usd: 5 }, { name: "Real Peer" }] } as never,
    ]);
    expect(rows.find(r => r.ein === "1")?.evidence).toEqual([]);
    // the nameless entry is dropped; it renders as ", , and 2 more"
    expect(rows.find(r => r.ein === "2")?.evidence.map(e => e.name)).toEqual(["Real Peer"]);
  });

  test("an overlay-added funder is marked as a For Granted record", () => {
    // It reaches every tenant by design and nothing assessed it against this
    // one, so the page must not claim focus alignment for it.
    const rows = funderRowsFrom(
      [{ ...f({ ein: undefined }), id: "overlay:abc", name: "FG Discovery" } as never], []);
    expect(rows[0].from_overlay).toBe(true);
    expect(rows[0].from_graph).toBe(false);
  });

  test("graph-backed funders sort above focus-only ones", () => {
    const rows = funderRowsFrom(
      [f({ ein: "111", name: "Zeta Focus Only" })],
      [f({ ein: "222", name: "Alpha Graph", evidence_grantees: [{ name: "Peer" }] })],
    );
    expect(rows.map(r => r.name)).toEqual(["Alpha Graph", "Zeta Focus Only"]);
  });

  test("evidence_count is stored, because the page orders by it", () => {
    const rows = funderRowsFrom([], [f({ evidence_grantees: [{ name: "a" }, { name: "b" }] })]);
    expect(rows[0].evidence_count).toBe(2);
  });

  test("more evidence sorts first among graph-backed funders", () => {
    const rows = funderRowsFrom([], [
      f({ ein: "1", name: "One Peer", evidence_grantees: [{ name: "a" }] }),
      f({ ein: "2", name: "Three Peers", evidence_grantees: [{ name: "a" }, { name: "b" }, { name: "c" }] }),
    ]);
    expect(rows[0].name).toBe("Three Peers");
  });

  test("a caveat is carried verbatim, never dropped or softened", () => {
    // The tool's own instructions: relay a caveat rather than presenting a
    // pass-through vehicle as an approachable foundation.
    const caveat = "Donor-advised fund — does not accept unsolicited proposals.";
    expect(funderRowsFrom([f({ caveat })], [])[0].caveat).toBe(caveat);
  });

  test("verified_at comes from the approved correction's review date", () => {
    const card = { ...f({}), _overlay: { reviewed_at: "2026-08-12T00:00:00Z" } };
    expect(funderRowsFrom([card as never], [])[0].verified_at).toBe("2026-08-12T00:00:00Z");
  });

  test("an unverified funder says so rather than inventing a date", () => {
    expect(funderRowsFrom([f({})], [])[0].verified_at).toBeNull();
  });

  test("a funder with no name still produces a usable row", () => {
    const rows = funderRowsFrom([f({ name: undefined, ein: "999" })], []);
    expect(rows[0].name).toBe("Unnamed funder");
    expect(rows[0].funder_id).toBe("999");
  });

  test("two EIN-less funders do not collapse into one row", () => {
    const rows = funderRowsFrom([
      f({ ein: undefined, name: "Trust One" }),
      f({ ein: undefined, name: "Trust Two" }),
    ], []);
    expect(rows).toHaveLength(2);
  });

  test("two nameless, EIN-less cards also stay separate", () => {
    const rows = funderRowsFrom([
      f({ ein: undefined, name: undefined }),
      f({ ein: undefined, name: undefined }),
    ], []);
    expect(rows).toHaveLength(2);
  });

  test("the inputs are not mutated", () => {
    const input = [f({ evidence_grantees: [{ name: "Peer" }] })];
    const snapshot = JSON.stringify(input);
    funderRowsFrom(input, input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("grantee amounts survive, under the WIRE's field names", () => {
    // MCP_TOOLS.md implies amount_usd / years[]; the service sends total_usd
    // and latest_year. We declared the documented shape and read undefined for
    // every amount — the third divergence between this service's output and
    // its documentation.
    const rows = funderRowsFrom([], [f({
      evidence_grantees: [{ name: "GOODWILL OF NW OHIO", total_usd: 1034881, latest_year: "2023" }],
    })]);
    expect(rows[0].evidence[0].total_usd).toBe(1034881);
    expect(rows[0].evidence[0].latest_year).toBe("2023");
  });

  test("empty in, empty out", () => {
    expect(funderRowsFrom([], [])).toEqual([]);
  });
});
