import { describe, expect, test } from "vitest";
import {
  bridgeGaps, checkBridge, parseWeave, screenBridges, weaveReminderDue, weaveShareLabel, type WeavePiece,
} from "@/lib/weave";
import { assembleAnswer } from "@/lib/section-answer";
import { contentHash, type VersionContent } from "@/lib/draft-version";

const A = "RE-Assist coordinates care for older adults leaving the hospital in Hamilton County.";
const B = "Our nurse navigators call every patient within 48 hours of discharge.";

const piece = (id: string, text: string, extra: Partial<WeavePiece> = {}): WeavePiece =>
  ({ id, kind: "card", text, breakBefore: false, ...extra });

describe("checkBridge: a bridge may join, never inform", () => {
  test("a plain connecting sentence passes", () => {
    expect(checkBridge("That coordination starts the moment a patient goes home.", A, B)).toBeNull();
  });

  test("a name already in the cards beside it passes, including its possessive", () => {
    expect(checkBridge("RE-Assist's navigators make that handoff personal.", A, B)).toBeNull();
  });

  test("a name the cards do not hold is refused", () => {
    expect(checkBridge("Working with Mercy Health, we close the gap.", A, B)).toBe("name");
    expect(checkBridge("This is how we serve Ohio families.", A, B)).toBe("name");
  });

  test("an acronym the cards do not hold is refused, even opening a sentence", () => {
    expect(checkBridge("CMS rules make this follow-up essential.", A, B)).toBe("name");
  });

  test("a number the cards do not hold is refused, as a figure or a word", () => {
    expect(checkBridge("Within 72 hours we reach most of them.", A, B)).toBe("number");
    expect(checkBridge("We reach three in four of them quickly.", A, B)).toBe("number");
    expect(checkBridge("That is why we reach them within hours, often dozens a week.", A, B)).toBe("number");
  });

  test("a number already in the cards passes", () => {
    expect(checkBridge("Those 48 hours are when a discharge most often goes wrong.", A, B)).toBeNull();
  });

  test("quotations and figure symbols are refused outright", () => {
    expect(checkBridge("As one nurse put it, “no one goes home alone.”", A, B)).toBe("quotation");
    expect(checkBridge("That saves money for every patient we reach, about 30% of costs.", A, B)).toBe("symbol");
  });

  test("too short or too long is refused", () => {
    expect(checkBridge("So.", A, B)).toBe("length");
    expect(checkBridge(Array(40).fill("word").join(" ") + ".", A, B)).toBe("length");
  });

  test("a common word opening a sentence is not taken for a name", () => {
    expect(checkBridge("Because discharge is where care breaks down, we start there.", A, B)).toBeNull();
    expect(checkBridge("Together, these steps keep patients from returning to the hospital.", A, B)).toBeNull();
  });

  test("a capitalised word mid-sentence is a name unless the cards hold it", () => {
    expect(checkBridge("We built this approach with Hamilton County in mind.", A, B)).toBeNull();
    expect(checkBridge("We built this approach with Medicaid in mind.", A, B)).toBe("name");
  });
});

describe("bridgeGaps", () => {
  test("a gap between neighbouring written pieces in one paragraph", () => {
    expect(bridgeGaps([piece("a", A), piece("b", B), piece("c", "We also call caregivers.", { kind: "human" })])).toEqual([0, 1]);
  });

  test("no gap across a paragraph break, beside an existing bridge, or next to an empty piece", () => {
    expect(bridgeGaps([piece("a", A), piece("b", B, { breakBefore: true })])).toEqual([]);
    expect(bridgeGaps([piece("a", A), piece("x", "And so on.", { kind: "bridge" }), piece("b", B)])).toEqual([]);
    expect(bridgeGaps([piece("a", A), piece("h", "  ", { kind: "human" }), piece("b", B)])).toEqual([]);
  });
});

describe("parseWeave", () => {
  test("reads the reply, keeps only offered gaps, one bridge per gap", () => {
    const raw = 'Sure: {"bridges": [{"after": 1, "text": " First   bridge. "}, {"after": 1, "text": "Duplicate."}, {"after": 3, "text": "Not offered."}, {"after": "2", "text": "Second."}]}';
    expect(parseWeave(raw, [0, 1])).toEqual([{ after: 0, text: "First bridge." }, { after: 1, text: "Second." }]);
  });

  test("not the shape at all is null; an empty list is no bridges", () => {
    expect(parseWeave("no json here", [0])).toBeNull();
    expect(parseWeave('{"other": 1}', [0])).toBeNull();
    expect(parseWeave('{"bridges": []}', [0])).toEqual([]);
  });
});

describe("screenBridges", () => {
  test("checks each bridge against the two pieces it sits between", () => {
    const pieces = [piece("a", A), piece("b", B), piece("c", "Families tell us the calls matter most.")];
    const { kept, refused } = screenBridges([
      { after: 0, text: "That handoff is where our nurse navigators begin." },
      { after: 1, text: "In 2025 we expanded to Butler County." },
    ], pieces);
    expect(kept.map(k => k.after)).toEqual([0]);
    expect(refused).toEqual([{ after: 1, text: "In 2025 we expanded to Butler County.", reason: "number" }]);
  });
});

describe("the reminder before weaving", () => {
  test("one weave as a share of the allowance, never shown as nothing", () => {
    expect(weaveShareLabel(45_000, 20_000_000)).toBe("about 0.2%");
    expect(weaveShareLabel(60_000, 20_000_000)).toBe("about 0.3%");
    expect(weaveShareLabel(5_000, 20_000_000)).toBe("less than 0.1%");
    expect(weaveShareLabel(45_000, 0)).toBe("a small part");
  });

  test("shown unless turned off, and again past 80% of the allowance", () => {
    expect(weaveReminderDue(true, 0.1)).toBe(true);
    expect(weaveReminderDue(false, 0.5)).toBe(false);
    expect(weaveReminderDue(false, 0.8)).toBe(true);
  });
});

describe("a proposed bridge is not part of the answer", () => {
  test("left out of the answer's text until accepted", () => {
    const blocks = [
      { kind: "card" as const, text: A, breakBefore: false },
      { kind: "bridge" as const, text: "Proposed bridge.", breakBefore: false, proposed: true },
      { kind: "card" as const, text: B, breakBefore: false },
    ];
    expect(assembleAnswer(blocks)).toBe(`${A} ${B}`);
    blocks[1].proposed = false;
    expect(assembleAnswer(blocks)).toBe(`${A} Proposed bridge. ${B}`);
  });

  test("versions saved before Weave keep the same fingerprint", () => {
    const block = { kind: "card" as const, card_id: "c1", card_version: 1, own_text: null, text: A, edited: false, break_before: false };
    const before: VersionContent = { sections: [{ section_id: "s", prompt: "Q", status: "drafting", text: A, blocks: [block] }] };
    const after: VersionContent = { sections: [{ section_id: "s", prompt: "Q", status: "drafting", text: A, blocks: [{ ...block, proposed: false }] }] };
    expect(contentHash(after)).toBe(contentHash(before));
  });
});
