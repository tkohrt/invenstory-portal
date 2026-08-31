/**
 * A real run failed with "ON CONFLICT DO UPDATE command cannot affect row a
 * second time" and lost all 12 matches, because several assistance programmes
 * shared one landing page and grant_id is the link.
 */
import { describe, expect, test } from "vitest";
import { dedupeScreened } from "@/lib/grant-screen";
import type { ScreenedGrant } from "@/lib/grant-screen";

const g = (grant_id: string, title: string): ScreenedGrant => ({
  grant_id, title, verdict: "check", reason: "r", close_date: null, award_ceiling: null,
});

describe("dedupeScreened", () => {
  test("ids are unique, which is the property the database requires", () => {
    const out = dedupeScreened([
      g("https://kfnwo.org/programs", "Emergency Assistance"),
      g("https://kfnwo.org/programs", "Education Grants"),
      g("https://kfnwo.org/programs", "Housing Support"),
    ]);
    expect(new Set(out.map(x => x.grant_id)).size).toBe(out.length);
  });

  test("two real programmes sharing a page both survive", () => {
    const out = dedupeScreened([
      g("https://kfnwo.org/programs", "Emergency Assistance"),
      g("https://kfnwo.org/programs", "Education Grants"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].grant_id).toBe("https://kfnwo.org/programs");
    expect(out[1].grant_id).toContain("#education-grants");
  });

  test("the same opportunity returned twice collapses to one", () => {
    const out = dedupeScreened([
      g("https://x.org/a", "Same Grant"),
      g("https://x.org/a", "Same Grant"),
    ]);
    expect(out).toHaveLength(1);
  });

  test("distinct links are left completely alone", () => {
    const out = dedupeScreened([g("https://a.org", "A"), g("https://b.org", "B")]);
    expect(out.map(x => x.grant_id)).toEqual(["https://a.org", "https://b.org"]);
  });

  test("order is preserved, so the ranking survives", () => {
    const out = dedupeScreened([g("https://a.org", "First"), g("https://b.org", "Second")]);
    expect(out.map(x => x.title)).toEqual(["First", "Second"]);
  });

  test("titles that slugify identically still get unique ids", () => {
    const out = dedupeScreened([
      g("https://x.org/p", "Fund A"),
      g("https://x.org/p", "Fund  A!"),   // different title, same slug
    ]);
    expect(new Set(out.map(x => x.grant_id)).size).toBe(2);
  });
});
