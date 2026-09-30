/**
 * The Story Card rules: what may become a card, and when two candidates are the
 * same card. Pure, no database or model. These are the checks the Phase 1 gate
 * leans on ("every stored quote passes the verbatim check"), so they are tested
 * rather than trusted.
 */
import { describe, expect, test } from "vitest";
import {
  CARD_KINDS, kindsFor, normalizeText, quoteInText, quoteOffset, figuresIn, untracedFigures,
  cardSubject, parseCandidates, checkCandidate, claimTokens, cardFingerprint, similarity,
  findPossibleDuplicates, displayLayer, strongest, contentHash, DUPLICATE_THRESHOLD,
  type CardCandidate,
} from "@/lib/story-card";
import { CHECKLIST } from "@/lib/checklist";

const DOC = `Nature for Health Collective connects K-6 students with outdoor learning.
In 2025 we served 1,240 students across 9 partner sites in Cuyahoga County.
Transportation is the biggest barrier: 38% of partner schools cancelled at least one field day for lack of a bus.
Our partner, the Riverside Nature Center, hosts weekly sessions for third graders.`;

const kinds = new Set(kindsFor("nonprofit").map(k => k.key));

const cand = (o: Partial<CardCandidate>): CardCandidate => ({
  kind: "outcome_metric",
  statement: "In 2025 the Collective served 1,240 students across 9 partner sites in Cuyahoga County.",
  quote: "In 2025 we served 1,240 students across 9 partner sites in Cuyahoga County.",
  subject: "organization", strength: "covered", ...o,
});

describe("card kinds", () => {
  test("every kind that names a checklist item names a real one", () => {
    const keys = new Set(CHECKLIST.map(i => i.key));
    for (const k of CARD_KINDS) if (k.itemKey) expect(keys.has(k.itemKey), k.key).toBe(true);
  });
  test("startup kinds only for for-profits, using checklistFor's rule", () => {
    expect(kindsFor("nonprofit").some(k => k.key === "traction")).toBe(false);
    expect(kindsFor(null).some(k => k.key === "traction")).toBe(false);
    expect(kindsFor("for_profit").some(k => k.key === "traction")).toBe(true);
    expect(kindsFor("for_profit").some(k => k.key === "mission_values")).toBe(true);
  });
  test("only relationship and voice kinds accept third-party facts", () => {
    expect(CARD_KINDS.filter(k => k.allowsThirdParty).map(k => k.key).sort())
      .toEqual(["beneficiary_story", "client_voice", "partnership"]);
  });
});

describe("the verbatim quote check", () => {
  test("an exact quote is found", () => {
    expect(quoteInText("we served 1,240 students across 9 partner sites", DOC)).toBe(true);
  });
  test("curly quotes, dashes and spacing do not decide it", () => {
    const text = "Tom said “every child deserves a day outside” — and meant it.";
    expect(quoteInText('Tom said "every child deserves a day outside" - and meant it.', text)).toBe(true);
    expect(quoteInText("we   served 1,240\nstudents across 9 partner", DOC)).toBe(true);
  });
  test("a paraphrase fails, however faithful", () => {
    expect(quoteInText("we reached 1,240 students at 9 partner sites", DOC)).toBe(false);
  });
  test("a changed figure fails", () => {
    expect(quoteInText("we served 1,420 students across 9 partner sites", DOC)).toBe(false);
  });
  test("an ellipsis may join pieces that appear in order", () => {
    expect(quoteInText("Transportation is the biggest barrier ... cancelled at least one field day", DOC)).toBe(true);
  });
  test("but not pieces out of order", () => {
    expect(quoteInText("cancelled at least one field day ... Transportation is the biggest barrier", DOC)).toBe(false);
  });
  test("nor pieces too short to mean anything", () => {
    expect(quoteInText("Transportation is the biggest barrier ... a bus", DOC)).toBe(false);
  });
  test("a quote too short to prove anything fails", () => {
    expect(quoteInText("students", DOC)).toBe(false);
  });
  test("offset points at the quote in the original text", () => {
    const at = quoteOffset("Our partner, the Riverside Nature Center", DOC);
    expect(DOC.slice(at, at + 11)).toBe("Our partner");
  });
});

describe("figures", () => {
  test("normalises commas and trailing zeros", () => {
    expect(figuresIn("$7,000 and 38% and 2.50 and 2025").sort()).toEqual(["2.5", "2025", "38", "7000"]);
  });
  test("a statement may only use figures its quote contains", () => {
    expect(untracedFigures("Served 1,240 students in 2025.", "In 2025 we served 1240 students")).toEqual([]);
    expect(untracedFigures("Served about 1,300 students.", "we served 1,240 students")).toEqual(["1300"]);
    expect(untracedFigures("Founded in 2019, it served 1,240 students.", "we served 1,240 students")).toEqual(["2019"]);
  });
});

describe("subject", () => {
  test("competitor facts never become cards", () => {
    for (const k of CARD_KINDS) expect(cardSubject(k.key, "competitor")).toBeNull();
  });
  test("third-party facts only where the kind allows", () => {
    expect(cardSubject("partnership", "third_party")).toBe("third_party");
    expect(cardSubject("outcome_metric", "third_party")).toBeNull();
    expect(cardSubject("outcome_metric", "organization")).toBe("organization");
  });
});

describe("parsing the model's answer", () => {
  test("reads a JSON array wrapped in prose and defaults unknown fields safely", () => {
    const raw = 'Here you go:\n[{"kind":"need_data","statement":"x","quote":"y","subject":"alien","strength":"huge"}]';
    const [c] = parseCandidates(raw);
    expect(c.kind).toBe("need_data");
    expect(c.subject).toBe("organization");
    expect(c.strength).toBe("thin");
  });
  test("garbage is an empty list, not a throw", () => {
    expect(parseCandidates("no json here")).toEqual([]);
    expect(parseCandidates("[not json]")).toEqual([]);
  });
});

describe("checkCandidate", () => {
  test("a grounded candidate is accepted, with figures read from the quote", () => {
    const r = checkCandidate(cand({}), DOC, kinds);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.card.hasFigures).toBe(true); expect(r.card.subject).toBe("organization"); }
  });
  test("each refusal names its reason", () => {
    const reason = (c: Partial<CardCandidate>) => {
      const r = checkCandidate(cand(c), DOC, kinds);
      return r.ok ? "ok" : r.rejected.reason;
    };
    expect(reason({ kind: "traction" })).toBe("unknown_kind");
    expect(reason({ quote: "" })).toBe("no_quote");
    expect(reason({ statement: "Served students." })).toBe("too_short");
    expect(reason({ statement: Array(95).fill("word").join(" ") })).toBe("too_long");
    expect(reason({ quote: "In 2025 we served 2,000 students across 9 partner sites" })).toBe("quote_not_found");
    expect(reason({ statement: "In 2024 the Collective served 1,240 students across nine partner sites in the county." })).toBe("untraced_figures");
    expect(reason({ subject: "competitor" })).toBe("competitor");
    expect(reason({ subject: "third_party" })).toBe("third_party_not_allowed");
  });
  test("a transcript outsider's first-person claim is moved off the organization", () => {
    const r = checkCandidate(cand({}), DOC, kinds, () => ({ subject: "third_party", speaker: "Speaker 2" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejected.reason).toBe("third_party_not_allowed");
  });
  test("a partner's statement survives as a partnership card, naming the speaker", () => {
    const r = checkCandidate(cand({
      kind: "partnership", subject: "third_party",
      statement: "The Riverside Nature Center partners with the Collective to host weekly sessions for third graders.",
      quote: "Our partner, the Riverside Nature Center, hosts weekly sessions for third graders.",
    }), DOC, kinds, (_q, s) => ({ subject: s, speaker: "Speaker 1" }));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.card.subject).toBe("third_party"); expect(r.card.speaker).toBe("Speaker 1"); }
  });
});

describe("card identity", () => {
  test("the same claim reworded in order and punctuation is one card", () => {
    const a = "The Collective served 1,240 students across 9 partner sites in 2025.";
    const b = "In 2025, across 9 partner sites, the Collective served 1,240 students!";
    expect(cardFingerprint("outcome_metric", a)).toBe(cardFingerprint("outcome_metric", b));
  });
  test("a different figure is a different card", () => {
    expect(cardFingerprint("outcome_metric", "Served 1,240 students in 2025."))
      .not.toBe(cardFingerprint("outcome_metric", "Served 1,300 students in 2025."));
  });
  test("the same words under a different kind are a different card", () => {
    const s = "Transportation is the biggest barrier for partner schools.";
    expect(cardFingerprint("need_data", s)).not.toBe(cardFingerprint("need_story", s));
  });
  test("stop words and simple plurals are ignored", () => {
    expect(claimTokens("The students and the sites")).toEqual(claimTokens("student site"));
  });
});

describe("possible duplicates", () => {
  const card = (id: string, statement: string, createdAt: string, kind = "program_model", dismissed = false) =>
    ({ id, kind, statement, createdAt, dismissed });

  test("similar cards of the same kind flag the newer one against the older", () => {
    const m = findPossibleDuplicates([
      card("new", "Weekly outdoor learning sessions for third graders at partner nature centers.", "2026-09-02"),
      card("old", "Weekly outdoor learning sessions for third graders at nature centers.", "2026-09-01"),
    ]);
    expect(m.get("new")).toBe("old");
    expect(m.has("old")).toBe(false);
  });
  test("different kinds are never compared", () => {
    const m = findPossibleDuplicates([
      card("a", "Weekly outdoor learning sessions for third graders.", "2026-09-01", "program_model"),
      card("b", "Weekly outdoor learning sessions for third graders.", "2026-09-02", "outcome_metric"),
    ]);
    expect(m.size).toBe(0);
  });
  test("a dismissed card is not flagged again", () => {
    const m = findPossibleDuplicates([
      card("old", "Weekly outdoor learning sessions for third graders.", "2026-09-01"),
      card("new", "Weekly outdoor learning sessions for third graders.", "2026-09-02", "program_model", true),
    ]);
    expect(m.size).toBe(0);
  });
  test("unrelated statements stay apart", () => {
    expect(similarity("Transportation is the biggest barrier.", "Our board has seven members."))
      .toBeLessThan(DUPLICATE_THRESHOLD);
  });
});

describe("assembly helpers", () => {
  test("living voice shows first, then internal, then public", () => {
    expect(displayLayer(["I", "III", "II"])).toBe("III");
    expect(displayLayer(["I", "II"])).toBe("II");
    expect(displayLayer([null, undefined, "x"])).toBeNull();
  });
  test("covered beats thin", () => {
    expect(strongest("thin", "covered")).toBe("covered");
    expect(strongest("thin", "thin")).toBe("thin");
  });
  test("content hash changes with content and uses the length prefix", () => {
    expect(contentHash("abc").startsWith("3:")).toBe(true);
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });
  test("normalizeText is idempotent", () => {
    const once = normalizeText("  Hello—World’s  ");
    expect(normalizeText(once)).toBe(once);
  });
});
