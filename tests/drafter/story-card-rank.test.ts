import { describe, expect, test } from "vitest";
import {
  WEIGHTS, rankCards, scoreCard, reasonFor, overlap, SLUG_ITEMS,
  type RankCard, type RankContext, type RankSection,
} from "@/lib/story-card-rank";
import { SLUG_KINDS } from "@/lib/application-parse";
import { CHECKLIST } from "@/lib/checklist";
import { CARD_KIND_MAP } from "@/lib/story-card";

const NOW = new Date("2026-10-01T12:00:00Z");

const card = (over: Partial<RankCard> & { id: string }): RankCard => ({
  kind: "program_model", itemKey: "program", strength: "covered", status: "suggested",
  layer: "II", statement: "RE-Assist coordinates care across clinics.", newestEvidenceAt: "2026-08-01T00:00:00Z",
  ...over,
});

const ctx = (over: Partial<RankContext> = {}): RankContext => ({
  now: NOW, usedElsewhere: new Set(), inSection: new Set(), sectionHasVoice: true, ...over,
});

const need: RankSection = {
  prompt: "Describe the need for transportation among students in your county.",
  wantedKinds: ["need_data", "need_story", "population_geography"], slugs: ["need"],
};

describe("scoreCard follows spec section 8", () => {
  test("a wanted, item-matched, covered, verified, fresh card scores every positive part", () => {
    const c = card({ id: "a", kind: "need_data", itemKey: "need", status: "verified", statement: "x" });
    const { score, parts } = scoreCard(c, need, ctx());
    expect(parts.kind).toBe(WEIGHTS.kind);
    expect(parts.item).toBe(WEIGHTS.item);
    expect(parts.covered).toBe(WEIGHTS.covered);
    expect(parts.verified).toBe(WEIGHTS.verified);
    expect(parts.fresh).toBe(WEIGHTS.fresh);
    expect(score).toBeCloseTo(3 + 1.5 + 1 + 1 + 0.5, 3);
  });

  test("evidence older than 18 months is not fresh; missing dates are not fresh", () => {
    expect(scoreCard(card({ id: "a", newestEvidenceAt: "2024-12-01T00:00:00Z" }), need, ctx()).parts.fresh).toBe(0);
    expect(scoreCard(card({ id: "a", newestEvidenceAt: null }), need, ctx()).parts.fresh).toBe(0);
    expect(scoreCard(card({ id: "a", newestEvidenceAt: "nonsense" }), need, ctx()).parts.fresh).toBe(0);
  });

  test("living voice earns its half point only while the answer has none", () => {
    const v = card({ id: "v", layer: "III" });
    expect(scoreCard(v, need, ctx({ sectionHasVoice: false })).parts.voice).toBe(WEIGHTS.voice);
    expect(scoreCard(v, need, ctx({ sectionHasVoice: true })).parts.voice).toBe(0);
  });

  test("a card used in another section loses a point", () => {
    const c = card({ id: "u" });
    expect(scoreCard(c, need, ctx({ usedElsewhere: new Set(["u"]) })).parts.usedElsewhere).toBe(-1);
  });

  test("similarity never outweighs a single structural signal", () => {
    // A card that repeats the question word for word, but is the wrong kind,
    // must still rank below a right-kind card with no shared words at all.
    const echo = card({ id: "echo", kind: "finance_budget", itemKey: "budget", strength: "thin",
      statement: "Describe the need for transportation among students in your county." });
    const right = card({ id: "right", kind: "need_story", itemKey: null, strength: "thin", newestEvidenceAt: null,
      statement: "Families drive two hours each way to reach the nearest clinic." });
    const ranked = rankCards([echo, right], need, ctx());
    expect(ranked[0].card.id).toBe("right");
    expect(ranked.find(r => r.card.id === "echo")!.parts.similarity).toBeLessThanOrEqual(WEIGHTS.similarity);
  });

  test("the preference prior is added when present, and is zero when absent", () => {
    const c = card({ id: "p" });
    expect(scoreCard(c, need, ctx()).parts.prior).toBe(0);
    expect(scoreCard(c, need, ctx({ prior: () => 0.25 })).parts.prior).toBe(0.25);
  });
});

describe("rankCards", () => {
  test("never offers retired cards or cards already in this section", () => {
    const cards = [card({ id: "a" }), card({ id: "b", status: "retired" }), card({ id: "c" })];
    const ids = rankCards(cards, need, ctx({ inSection: new Set(["c"]) })).map(r => r.card.id);
    expect(ids).toEqual(["a"]);
  });

  test("is deterministic: equal scores order by id, and positions are 1-based", () => {
    const cards = [card({ id: "z" }), card({ id: "m" }), card({ id: "a" })];
    const r1 = rankCards(cards, need, ctx());
    const r2 = rankCards([...cards].reverse(), need, ctx());
    expect(r1.map(r => r.card.id)).toEqual(["a", "m", "z"]);
    expect(r2.map(r => r.card.id)).toEqual(["a", "m", "z"]);
    expect(r1.map(r => r.position)).toEqual([1, 2, 3]);
  });

  test("puts wanted kinds first", () => {
    const cards = [
      card({ id: "fin", kind: "finance_budget", itemKey: "budget" }),
      card({ id: "need", kind: "need_data", itemKey: "need", strength: "thin" }),
    ];
    expect(rankCards(cards, need, ctx())[0].card.id).toBe("need");
  });
});

describe("overlap", () => {
  test("ignores stop words and meets simple plurals", () => {
    expect(overlap("How many students do you serve?", "We serve 300 student riders.")).toBeGreaterThan(0.5);
    expect(overlap("the and of", "anything")).toBe(0);
  });
});

describe("reasonFor only claims what scored", () => {
  test("a wanted kind names the kind and the source", () => {
    const r = rankCards([card({ id: "a", kind: "need_data", itemKey: "need" })], need, ctx())[0];
    const line = reasonFor(r, "Need: the data", "Annual Report 2025");
    expect(line).toMatch(/^The question asks for need: the data; from Annual Report 2025/);
    expect(line).toMatch(/not yet verified/);
  });
  test("an off-kind card says so rather than inventing a reason", () => {
    const r = rankCards([card({ id: "a", kind: "finance_budget", itemKey: "budget", statement: "zzz" })], need, ctx())[0];
    expect(reasonFor(r, "Finances", null)).toMatch(/^Not a kind this question asks for/);
  });
});

describe("the tables agree with the rest of the drafter", () => {
  test("every seeded slug has checklist items, and every item exists", () => {
    const keys = new Set(CHECKLIST.map(i => i.key));
    for (const slug of Object.keys(SLUG_KINDS)) {
      expect(SLUG_ITEMS[slug], slug).toBeTruthy();
      for (const k of SLUG_ITEMS[slug]) expect(keys.has(k), `${slug} -> ${k}`).toBe(true);
    }
  });
  test("every wanted kind in SLUG_KINDS is a real card kind", () => {
    for (const kinds of Object.values(SLUG_KINDS)) for (const k of kinds) expect(CARD_KIND_MAP[k], k).toBeTruthy();
  });
});
