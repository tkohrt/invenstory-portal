import { describe, it, expect } from "vitest";
import { curatedLeads, curatedCard } from "@/lib/curated";
import { screenGrant } from "@/lib/grant-screen";
import { EMPTY_PROFILE } from "@/lib/eligibility-fields";

const TODAY = "2026-11-12";

describe("curatedLeads", () => {
  it("keeps entries without URLs on a title key, marks everything site", () => {
    const out = curatedLeads([
      { kind: "opportunity", title: "Mozilla Technology Fund", url: "https://foundation.mozilla.org/fund", deadline: "2026-12-01" },
      { kind: "opportunity", title: "Open Web Grant", url: null, amount: "$50,000" },
    ], TODAY);
    expect(out).toHaveLength(2);
    expect(out.every(l => l.grounded === "site")).toBe(true);
    expect(out[1].url_key).toBe("curated:open web grant");
  });

  it("drops past deadlines, duplicates and untitled rows", () => {
    const out = curatedLeads([
      { title: "Old Call", url: "https://x.org/a", deadline: "2026-01-01" },
      { title: "Dup", url: "https://x.org/b" },
      { title: "Dup again", url: "https://x.org/b" },
      { url: "https://x.org/c" },
    ], TODAY);
    expect(out.map(l => l.title)).toEqual(["Dup"]);
  });

  it("treats rolling deadlines as open", () => {
    const out = curatedLeads([{ title: "Rolling Fund", url: "https://x.org/r", deadline: "rolling" }], TODAY);
    expect(out[0].rolling).toBe(true);
    expect(out[0].deadline).toBeNull();
  });
});

describe("curatedCard + screenGrant", () => {
  it("an approved entry screens like any grant", () => {
    const card = curatedCard({
      title: "Community Health Grant", eligibility: "501(c)(3) nonprofit organizations",
      close_date: "2027-01-15", max_award: 50_000, website: "https://x.org/g",
    });
    const p = { ...EMPTY_PROFILE, org_type: "nonprofit" as const, tax_status: "501c3" as const };
    const s = screenGrant({ ...card, id: "e1" } as Parameters<typeof screenGrant>[0], p, new Date(`${TODAY}T12:00:00Z`));
    expect(s).not.toBeNull();
    expect(["eligible", "likely", "check"]).toContain(s!.verdict);
  });

  it("a closed entry screens out", () => {
    const card = curatedCard({ title: "Closed", close_date: "2026-01-01" });
    const s = screenGrant({ ...card, id: "e2" } as Parameters<typeof screenGrant>[0],
      { ...EMPTY_PROFILE, org_type: "nonprofit" as const }, new Date(`${TODAY}T12:00:00Z`));
    expect(s).toBeNull();
  });

  it("ignores junk field types", () => {
    const card = curatedCard({ title: 5, max_award: "lots", website: "  " });
    expect(card.title).toBeUndefined();
    expect(card.max_award).toBeUndefined();
    expect(card.website).toBeUndefined();
  });
});
