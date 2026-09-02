/**
 * A real run failed with "ON CONFLICT DO UPDATE command cannot affect row a
 * second time" and lost all 12 matches, because several assistance programmes
 * shared one landing page and the id is the link.
 *
 * Uniqueness now happens in qualifyGrantIds, BEFORE the merge, so the id the
 * database stores is the id a correction is filed against. These tests moved
 * with it; dedupeScreened keeps only the collapse it still owns.
 */
import { describe, expect, test } from "vitest";
import { dedupeScreened, qualifyGrantIds } from "@/lib/grant-screen";
import type { ScreenedGrant } from "@/lib/grant-screen";

const g = (grant_id: string, title: string): ScreenedGrant => ({
  grant_id, title, verdict: "check", reason: "r", close_date: null, award_ceiling: null,
});
const raw = (link: string, title: string) => ({ opportunity_number: link, title });

describe("qualifyGrantIds — the uniqueness the database requires", () => {
  test("ids are unique", () => {
    const out = qualifyGrantIds([
      raw("https://kfnwo.org/programs", "Emergency Assistance"),
      raw("https://kfnwo.org/programs", "Education Grants"),
      raw("https://kfnwo.org/programs", "Housing Support"),
    ]);
    expect(new Set(out.map(x => x.id)).size).toBe(out.length);
  });

  test("two real programmes sharing a page both survive", () => {
    const out = qualifyGrantIds([
      raw("https://kfnwo.org/programs", "Emergency Assistance"),
      raw("https://kfnwo.org/programs", "Education Grants"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("https://kfnwo.org/programs");
    expect(out[1].id).toContain("#education-grants");
  });

  test("the same opportunity returned twice collapses to one", () => {
    expect(qualifyGrantIds([raw("https://x.org/a", "Same"), raw("https://x.org/a", "Same")])).toHaveLength(1);
  });

  test("distinct links are left completely alone", () => {
    const out = qualifyGrantIds([raw("https://a.org", "A"), raw("https://b.org", "B")]);
    expect(out.map(x => x.id)).toEqual(["https://a.org", "https://b.org"]);
  });

  test("order is preserved, so the ranking survives", () => {
    const out = qualifyGrantIds([raw("https://a.org", "First"), raw("https://b.org", "Second")]);
    expect(out.map(x => x.title)).toEqual(["First", "Second"]);
  });

  test("titles that slugify identically still get unique ids", () => {
    const out = qualifyGrantIds([
      raw("https://x.org/p", "Fund A"),
      raw("https://x.org/p", "Fund  A!"),   // different title, same slug
    ]);
    expect(new Set(out.map(x => x.id)).size).toBe(2);
  });
});

describe("dedupeScreened — the safety net, which no longer re-keys", () => {
  test("an id repeated after screening collapses", () => {
    const out = dedupeScreened([g("https://x.org/a", "Same"), g("https://x.org/a", "Same")]);
    expect(out).toHaveLength(1);
  });

  test("already-qualified ids pass through byte for byte", () => {
    // Re-keying here is exactly what put the stored id out of step with the
    // key corrections were filed against.
    const ids = ["https://x.org/p", "https://x.org/p#fund-b"];
    const out = dedupeScreened(ids.map((id, i) => g(id, `Fund ${i}`)));
    expect(out.map(x => x.grant_id)).toEqual(ids);
  });

  test("order is preserved", () => {
    const out = dedupeScreened([g("https://a.org", "First"), g("https://b.org", "Second")]);
    expect(out.map(x => x.title)).toEqual(["First", "Second"]);
  });
});
