import { describe, expect, test } from "vitest";
import {
  autosavesToThin, canMoveStatus, compareVersion, contentHash, versionLabel, KEEP_RECENT_AUTOSAVES,
  type VersionContent,
} from "@/lib/draft-version";

const content = (text: string, own: string | null = null): VersionContent => ({
  sections: [{ section_id: "s1", prompt: "Q", status: "drafting", text,
    blocks: [{ kind: "card", card_id: "c1", card_version: 1, own_text: own, text, edited: !!own, break_before: false }] }],
});

describe("contentHash", () => {
  test("changes when the answer changes, not when only the status does", () => {
    const a = content("One.");
    const b = { sections: [{ ...a.sections[0], status: "done" as const }] };
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash(content("One.", "Edited.")));
  });
});

describe("autosavesToThin", () => {
  test("keeps the newest autosaves and one per day before them; never touches other kinds", () => {
    const v = [];
    for (let i = 0; i < KEEP_RECENT_AUTOSAVES + 6; i++) {
      // Three a day, oldest first.
      const day = String(1 + Math.floor(i / 3)).padStart(2, "0");
      v.push({ id: `a${i}`, reason: "autosave" as const, takenAt: `2026-10-${day}T1${i % 3}:00:00Z` });
    }
    v.push({ id: "m", reason: "manual" as const, takenAt: "2026-10-01T00:00:00Z" });
    const drop = autosavesToThin(v);
    expect(drop).not.toContain("m");
    expect(v.length - 1 - drop.length).toBeGreaterThanOrEqual(KEEP_RECENT_AUTOSAVES);
    // The six oldest span two days: one kept each, four dropped.
    expect(drop.length).toBe(4);
  });
});

describe("labels, comparison, statuses", () => {
  test("labels", () => {
    expect(versionLabel({ reason: "stage", name: null, stage: "weave" })).toBe("Before Weave");
    expect(versionLabel({ reason: "manual", name: "Sent to Ashley", stage: null })).toBe("Sent to Ashley");
  });
  test("compareVersion marks changed and missing questions", () => {
    const d = compareVersion(content("Old."), { sections: [] });
    expect(d[0]).toMatchObject({ changed: true, missing: true });
    expect(compareVersion(content("Same  text."), content("Same text."))[0].changed).toBe(false);
  });
  test("submitted is final except for the outcome", () => {
    expect(canMoveStatus("drafting", "completed")).toBe(true);
    expect(canMoveStatus("completed", "drafting")).toBe(true);
    expect(canMoveStatus("submitted", "drafting")).toBe(false);
    expect(canMoveStatus("submitted", "won")).toBe(true);
    expect(canMoveStatus("drafting", "won")).toBe(false);
  });
});
