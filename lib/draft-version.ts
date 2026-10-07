// Versions of a draft: the pure half.
//
// A version is the whole application at a moment: every question, and every
// block of every answer as it then stood (the card and the card's version, any
// edit, any written text, paragraph breaks). It is stored whole in
// draft_snapshot.content, so restoring it later puts back exactly what was
// there, and every sentence still traces to its source.
//
// Free of `server-only`; tested in tests/drafter/draft-version.test.ts.

export type VersionReason = "submitted" | "manual" | "completed" | "stage" | "autosave" | "restore";

export interface VersionBlock {
  kind: "card" | "bridge" | "human";
  card_id: string | null;
  card_version: number | null;
  /** What the block itself stores: the edit for an edited card, the writing for your own text, null otherwise. */
  own_text: string | null;
  /** How it read at the time, for viewing and comparing without the card library. */
  text: string;
  edited: boolean;
  break_before: boolean;
  /** A bridge proposed by Weave and not yet accepted (versions from before Weave have none). */
  proposed?: boolean;
}

export interface VersionSection {
  section_id: string;
  prompt: string;
  status: "empty" | "drafting" | "done";
  /** The answer as text, for viewing and comparing. */
  text: string;
  blocks: VersionBlock[];
}

export interface VersionContent { sections: VersionSection[] }

/** A fingerprint of what matters: the answers' structure and words. Status changes alone are not a new version. */
export function contentHash(c: VersionContent): string {
  const key = JSON.stringify(c.sections.map(s => [s.section_id,
    s.blocks.map(b => [b.kind, b.card_id, b.card_version, b.own_text, b.edited, b.break_before, ...(b.proposed ? [1] : [])])]));
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${key.length}:${(h >>> 0).toString(36)}`;
}

/** Autosaves kept in full before thinning starts. */
export const KEEP_RECENT_AUTOSAVES = 20;

/**
 * Which autosaves to delete. Every other kind of version is kept for good.
 *
 * The newest KEEP_RECENT_AUTOSAVES autosaves stay; older ones keep only the
 * last of each day. Input in any order; output is the ids to remove.
 */
export function autosavesToThin(versions: { id: string; reason: VersionReason; takenAt: string }[]): string[] {
  const auto = versions.filter(v => v.reason === "autosave").sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  const older = auto.slice(KEEP_RECENT_AUTOSAVES);
  const keptDay = new Set<string>();
  const drop: string[] = [];
  for (const v of older) {
    const day = v.takenAt.slice(0, 10);
    if (keptDay.has(day)) drop.push(v.id); else keptDay.add(day);
  }
  return drop;
}

/** The label a version shows in the history. */
export function versionLabel(v: { reason: VersionReason; name: string | null; stage: string | null }): string {
  if (v.name) return v.name;
  switch (v.reason) {
    case "submitted": return "Submitted";
    case "completed": return "Marked completed";
    case "autosave": return "Autosave";
    case "restore": return "Before a restore";
    case "manual": return "Saved version";
    case "stage": return v.stage === "polish" ? "Before Polish" : v.stage === "weave" ? "Before Weave" : "Stage change";
  }
}

export interface SectionDiff { sectionId: string; prompt: string; before: string; now: string; changed: boolean; missing: boolean }

/**
 * Compare a version with the draft as it is now, question by question.
 * `missing` marks a question in the version that the draft no longer has.
 */
export function compareVersion(version: VersionContent, current: VersionContent): SectionDiff[] {
  const now = new Map(current.sections.map(s => [s.section_id, s]));
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  return version.sections.map(s => {
    const c = now.get(s.section_id);
    return {
      sectionId: s.section_id, prompt: s.prompt, before: s.text, now: c?.text ?? "",
      changed: !c || norm(c.text) !== norm(s.text), missing: !c,
    };
  });
}

export type DraftStatus = "drafting" | "client_review" | "completed" | "submitted" | "won" | "lost";

/** Which status changes a person may make. Submitted is final except for the outcome. */
export function canMoveStatus(from: DraftStatus, to: DraftStatus): boolean {
  if (from === to) return false;
  if (from === "submitted") return to === "won" || to === "lost";
  if (from === "won" || from === "lost") return to === "won" || to === "lost";
  return to === "drafting" || to === "client_review" || to === "completed" || to === "submitted";
}

/** A submitted application, and its outcome, cannot be edited. */
export const LOCKED_STATUSES: ReadonlySet<DraftStatus> = new Set(["submitted", "won", "lost"]);

export const STATUS_NAME: Record<DraftStatus, string> = {
  drafting: "Drafting", client_review: "With client", completed: "Completed",
  submitted: "Submitted", won: "Awarded", lost: "Declined",
};
