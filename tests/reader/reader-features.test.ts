// The Document Reader's per-client switches.
import { describe, expect, test } from "vitest";
import { READER_FEATURES, readerAccess, readerSwitches, switchBlocked, isReaderFeatureKey } from "@/lib/reader-features";

const noRows = {};
const ws = (o: Record<string, boolean> = {}) => ({ card_review: false, drafts: false, ...o });

describe("defaults for a client with nothing set", () => {
  test("highlights on; acting on cards follows Story Cards; the rest off", () => {
    expect(readerSwitches(noRows, ws())).toEqual({
      reader_highlights: true, reader_card_actions: false, reader_every_use: false,
      reader_draft_links: false, reader_edit: false, reader_make_card: false,
    });
    expect(readerSwitches(noRows, ws({ card_review: true })).reader_card_actions).toBe(true);
  });

  test("a stored row wins over the default", () => {
    expect(readerSwitches({ reader_card_actions: false }, ws({ card_review: true })).reader_card_actions).toBe(false);
    expect(readerSwitches({ reader_highlights: false }, ws()).reader_highlights).toBe(false);
  });
});

describe("what a client may do", () => {
  test("acting on cards needs the highlights", () => {
    expect(readerAccess(false, { reader_highlights: false, reader_card_actions: true }, ws()).cardActions).toBe(false);
    expect(readerAccess(false, { reader_card_actions: true }, ws()).cardActions).toBe(true);
  });

  test("links to drafts only while Drafts is on for the client", () => {
    expect(readerAccess(false, { reader_draft_links: true }, ws()).draftLinks).toBe(false);
    expect(readerAccess(false, { reader_draft_links: true }, ws({ drafts: true })).draftLinks).toBe(true);
    expect(switchBlocked(READER_FEATURES.find(f => f.key === "reader_draft_links")!, ws())).toMatch(/Drafts/);
    expect(switchBlocked(READER_FEATURES.find(f => f.key === "reader_draft_links")!, ws({ drafts: true }))).toBeNull();
  });

  test("a client never sees retired cards", () => {
    expect(readerAccess(false, { reader_highlights: true, reader_card_actions: true }, ws({ drafts: true, card_review: true })).showRetired).toBe(false);
  });
});

test("For Granted sees everything, whatever the switches say", () => {
  expect(readerAccess(true, { reader_highlights: false, reader_card_actions: false }, ws())).toEqual({
    admin: true, highlights: true, cardActions: true, draftLinks: true, showRetired: true,
  });
});

test("only reader keys are accepted", () => {
  expect(isReaderFeatureKey("reader_edit")).toBe(true);
  expect(isReaderFeatureKey("drafts")).toBe(false);
  expect(isReaderFeatureKey(undefined)).toBe(false);
});
