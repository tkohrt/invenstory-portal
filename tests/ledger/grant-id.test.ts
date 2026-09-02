/**
 * One id, three consumers.
 *
 * The merge key, the cached eligible_grant.grant_id, and the picker's base_id
 * have to be the same string. When they were not — the merge keyed on the raw
 * link while the cache held a slug-qualified, 400-char-truncated version — a
 * correction filed against a real opportunity matched no base record, was
 * neither applied nor appended, and vanished with no error anywhere.
 */
import { describe, expect, test } from "vitest";
import { qualifyGrantIds, baseGrantId, dedupeScreened, screenGrant, GRANT_ID_MAX } from "@/lib/grant-screen";
import { mergeOverlay } from "@/lib/ledger-merge";
import type { EligibilityProfile } from "@/lib/eligibility-fields";
import type { LedgerOverlayRow } from "@/lib/types";

const PROFILE = {
  org_type: "nonprofit", cause_areas: ["health"], populations: [], service_area: [],
  state_code: "OH", budget_band: "100k_500k", has_501c3: true,
} as unknown as EligibilityProfile;

describe("qualifyGrantIds", () => {
  test("the link is the id when it is unique", () => {
    const out = qualifyGrantIds([{ opportunity_number: "https://f.org/a", title: "Fund A" }]);
    expect(out[0].id).toBe("https://f.org/a");
  });

  test("two programmes on one landing page get distinct ids", () => {
    const out = qualifyGrantIds([
      { opportunity_number: "https://f.org/apply", title: "Fund A" },
      { opportunity_number: "https://f.org/apply", title: "Fund B" },
    ]);
    expect(out[0].id).toBe("https://f.org/apply");
    expect(out[1].id).toBe("https://f.org/apply#fund-b");
    expect(new Set(out.map(o => o.id)).size).toBe(2);
  });

  test("the same opportunity twice collapses to one", () => {
    const out = qualifyGrantIds([
      { opportunity_number: "https://f.org/a", title: "Fund A" },
      { opportunity_number: "https://f.org/a", title: "Fund A" },
    ]);
    expect(out).toHaveLength(1);
  });

  test("ids are truncated HERE, so the stored id equals the merged id", () => {
    // The database column slices at 400. If truncation happened only there, a
    // long grants.gov URL with query parameters would be stored under a key the
    // merge never looks for.
    const long = "https://grants.gov/view?" + "x".repeat(600);
    const out = qualifyGrantIds([{ opportunity_number: long, title: "Long" }]);
    expect(out[0].id).toHaveLength(GRANT_ID_MAX);
    expect(out[0].id.slice(0, GRANT_ID_MAX)).toBe(out[0].id);
  });

  test("a record with no link still gets a stable id from its title", () => {
    expect(baseGrantId({ title: "Community Recovery Fund" })).toBe("Community Recovery Fund");
  });

  test("a long title is truncated the same way, not at a different length", () => {
    // screenGrant used to slice titles at 120 while matching used the full
    // string — another silent mismatch.
    const title = "T".repeat(600);
    expect(baseGrantId({ title })).toHaveLength(GRANT_ID_MAX);
  });
});

describe("the id survives screening unchanged", () => {
  test("screenGrant adopts the assigned id rather than recomputing one", () => {
    const [rec] = qualifyGrantIds([
      { opportunity_number: "https://f.org/apply", title: "Fund B" },
      // force qualification by making it a duplicate link
    ].slice(0, 1));
    const s = screenGrant({ ...rec, eligibility: "Open to nonprofits" } as never, PROFILE);
    expect(s?.grant_id).toBe(rec.id);
  });

  test("a qualified id reaches the cached row byte for byte", () => {
    const recs = qualifyGrantIds([
      { opportunity_number: "https://f.org/apply", title: "Fund A" },
      { opportunity_number: "https://f.org/apply", title: "Fund B" },
    ]);
    const screened = recs
      .map(r => screenGrant({ ...r, eligibility: "Open to nonprofits" } as never, PROFILE))
      .filter(Boolean) as { grant_id: string }[];
    expect(screened.map(s => s.grant_id)).toEqual(recs.map(r => r.id));
  });

  test("dedupeScreened no longer re-keys anything", () => {
    const list = [
      { grant_id: "https://f.org/apply", title: "Fund A" },
      { grant_id: "https://f.org/apply#fund-b", title: "Fund B" },
    ] as never[];
    const out = dedupeScreened(list);
    expect(out.map((g: { grant_id: string }) => g.grant_id))
      .toEqual(["https://f.org/apply", "https://f.org/apply#fund-b"]);
  });
});

describe("a correction attached to a cached id reaches its record", () => {
  const overlayRow = (base_id: string, fields: Record<string, unknown>): LedgerOverlayRow =>
    ({ id: "o1", kind: "grant", base_id, ein: null, opportunity_number: base_id,
       fields, status: "approved", source_url: "https://f.org/apply",
       provenance: "manual", confidence: "high", reviewed_at: "2026-08-12T00:00:00Z",
     } as unknown as LedgerOverlayRow);

  test("the second programme on a shared page is correctable — the case that vanished", () => {
    const withIds = qualifyGrantIds([
      { opportunity_number: "https://f.org/apply", title: "Fund A" },
      { opportunity_number: "https://f.org/apply", title: "Fund B" },
    ]);
    // base_id is what listTenantMatchesAction hands the form: the cached id.
    const unmatched: string[] = [];
    const merged = mergeOverlay(
      withIds as never, [overlayRow("https://f.org/apply#fund-b", { close_date: "2027-03-01" })],
      { onUnmatched: r => unmatched.push(r.base_id ?? "") },
    );
    expect(unmatched).toEqual([]);
    const b = merged.find(m => m.title === "Fund B");
    expect(b?.close_date).toBe("2027-03-01");
    // and it did not bleed onto its neighbour
    expect(merged.find(m => m.title === "Fund A")?.close_date).toBeUndefined();
  });

  test("a correction for a record this run did not return is reported, not silently dropped", () => {
    const unmatched: string[] = [];
    mergeOverlay(
      qualifyGrantIds([{ opportunity_number: "https://f.org/a", title: "A" }]) as never,
      [overlayRow("https://f.org/gone", {})],
      { onUnmatched: r => unmatched.push(r.base_id ?? "") },
    );
    expect(unmatched).toEqual(["https://f.org/gone"]);
  });
});
