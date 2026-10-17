// The Document Reader's per-client switches (decision 1 of the build spec, 17
// October 2026). Pure and tested (tests/reader/reader-features.test.ts).
//
// Stored like the sidebar's page switches, in feature_visibility (one row per
// client per key), set by For Granted on the client's activity page, Document
// reader tab. For Granted always sees everything. Every switch is checked on
// the server as well as in the page (lib/server/reader.ts, reader-actions.ts):
// a feature switched off for a client cannot be reached by its URL or its
// actions.
//
// "Full text and search" is always on and has no switch. Three switches are for
// later phases and do nothing yet: they can be set now and take effect when
// their feature ships ("later").

export type ReaderFeatureKey =
  | "reader_highlights" | "reader_card_actions" | "reader_every_use"
  | "reader_draft_links" | "reader_edit" | "reader_make_card";

export interface ReaderFeature {
  key: ReaderFeatureKey;
  label: string;
  hint: string;
  /** The default for a client with no row: a value, or the value of a page switch. */
  defaultOn: boolean | "card_review";
  /** A page switch this one needs on as well. */
  requires?: "drafts";
  /** A later phase: stored, not yet in effect. */
  later?: boolean;
}

export const READER_FEATURES: ReaderFeature[] = [
  { key: "reader_highlights", label: "Story Card highlights", hint: "See which passages their cards came from", defaultOn: true },
  { key: "reader_card_actions", label: "Act on cards", hint: "Verify, edit, out of date, not supported", defaultOn: "card_review" },
  { key: "reader_every_use", label: "Every use, and why", hint: "Readiness, eligibility, funder matching", defaultOn: false, later: true },
  { key: "reader_draft_links", label: "Links to drafts", hint: "Where a card is used in a draft", defaultOn: false, requires: "drafts" },
  { key: "reader_edit", label: "Edit the text", hint: "Saves a new version; re-reading is separate", defaultOn: false, later: true },
  { key: "reader_make_card", label: "Make a Story Card from a selection", hint: "A card made from any passage they select", defaultOn: false, later: true },
];

export const READER_FEATURE_KEYS = new Set<string>(READER_FEATURES.map(f => f.key));

export function isReaderFeatureKey(k: unknown): k is ReaderFeatureKey {
  return typeof k === "string" && READER_FEATURE_KEYS.has(k);
}

/** What one person may do in the reader. */
export interface ReaderAccess {
  admin: boolean;
  highlights: boolean;
  cardActions: boolean;
  draftLinks: boolean;
  /** For Granted only: show retired cards' passages too (decision of 17 October 2026). */
  showRetired: boolean;
}

/** Each switch as stored, or its default: what the activity page shows. */
export function readerSwitches(
  rows: Record<string, boolean | undefined>,
  workspace: Record<string, boolean | undefined>,
): Record<ReaderFeatureKey, boolean> {
  const out = {} as Record<ReaderFeatureKey, boolean>;
  for (const f of READER_FEATURES) {
    const stored = rows[f.key];
    out[f.key] = stored !== undefined ? stored
      : f.defaultOn === "card_review" ? !!workspace.card_review : f.defaultOn;
  }
  return out;
}

/** Why a switch cannot take effect for this client, or null. */
export function switchBlocked(f: ReaderFeature, workspace: Record<string, boolean | undefined>): string | null {
  if (f.requires === "drafts" && !workspace.drafts) return "Needs Drafts switched on for this client";
  return null;
}

/**
 * What a person may do. For Granted: everything. A client: what the switches
 * say, where acting on cards also needs the highlights (there is nothing to
 * act on without them) and links to drafts also need Drafts on.
 */
export function readerAccess(
  isAdmin: boolean,
  rows: Record<string, boolean | undefined>,
  workspace: Record<string, boolean | undefined>,
): ReaderAccess {
  if (isAdmin) return { admin: true, highlights: true, cardActions: true, draftLinks: true, showRetired: true };
  const s = readerSwitches(rows, workspace);
  const highlights = s.reader_highlights;
  return {
    admin: false,
    highlights,
    cardActions: highlights && s.reader_card_actions,
    draftLinks: highlights && s.reader_draft_links && !!workspace.drafts,
    showRetired: false,
  };
}
