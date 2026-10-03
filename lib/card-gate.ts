// Which Story Cards may be used in a grant answer, and what stands in the way.
//
// The rule (decided 2 October 2026): a card goes into an answer only once a
// person has verified it. For Granted's verification is enough to draft; a
// client's counts too. Editing a card counts as verifying it (lib/server/card-edit.ts).
//
// Two gates use this file:
//   1. Placing. Dragging a card in, pressing Add, Arrange for me, and starting
//      from a Standard Answer all refuse an unverified card. The page opens the
//      card's review instead, so verifying it places it in one step.
//   2. The finish line. Marking an application Completed or Submitted, approving
//      a Standard Answer, and copying an answer out are refused while any card in
//      it is unverified, retired, or sensitive and undecided. This catches cards
//      placed before the rule existed, and cards whose status changed afterwards.
//
// Pure and free of `server-only`, so the page and the server apply exactly the
// same rule, and it is tested without a database.
import { placeable } from "./card-sensitivity";

export type GateIssue = "unverified" | "sensitive" | "retired";

export interface GateCard {
  status: "suggested" | "verified" | "retired" | string;
  sensitive?: boolean | null;
  sensitiveCleared?: string | null;
}

/**
 * What stops this card going into an answer, or null when nothing does.
 *
 * A card that cannot be found is treated as retired: the library only stops
 * offering a card when it is retired, so a placed card with no live record has
 * been taken out of use.
 */
export function placeIssue(card: GateCard | null | undefined): GateIssue | null {
  if (!card || card.status === "retired") return "retired";
  if (!placeable({ sensitive: !!card.sensitive, sensitiveCleared: (card.sensitiveCleared ?? null) as never })) return "sensitive";
  if (card.status !== "verified") return "unverified";
  return null;
}

export const canPlace = (card: GateCard | null | undefined) => placeIssue(card) === null;

export const ISSUE_LABEL: Record<GateIssue, string> = {
  unverified: "not yet verified",
  sensitive: "sensitive, awaiting a decision",
  retired: "retired from the library",
};

export interface GateBlock { sectionId: string; kind: string; cardId: string | null; text: string }
export interface GateSection { id: string; prompt: string }

export interface Blocker {
  sectionId: string;
  /** 1-based, in the application's order. */
  question: number;
  prompt: string;
  cardId: string;
  text: string;
  issue: GateIssue;
}

/**
 * Every card in these answers that stops them leaving the building, in
 * question order. Only card blocks count: a writer's own words and AI bridges
 * have their own checks (the figure audit, Phase 4).
 */
export function finishBlockers(
  sections: GateSection[], blocks: GateBlock[], card: (id: string) => GateCard | null | undefined,
): Blocker[] {
  const order = new Map(sections.map((s, i) => [s.id, i]));
  const out: Blocker[] = [];
  for (const b of blocks) {
    if (b.kind !== "card" || !b.cardId) continue;
    const at = order.get(b.sectionId);
    if (at == null) continue;
    const issue = placeIssue(card(b.cardId));
    if (issue) out.push({ sectionId: b.sectionId, question: at + 1, prompt: sections[at].prompt, cardId: b.cardId, text: b.text, issue });
  }
  return out.sort((a, b) => a.question - b.question);
}

/** One plain sentence for a refusal: how many, of what, and where. */
export function describeBlockers(list: Blocker[], what = "this application"): string {
  if (!list.length) return "";
  const count = (i: GateIssue) => list.filter(b => b.issue === i).length;
  const parts = (["unverified", "sensitive", "retired"] as GateIssue[])
    .filter(i => count(i)).map(i => `${count(i)} ${ISSUE_LABEL[i]}`);
  const qs = [...new Set(list.map(b => b.question))];
  return `${list.length} card${list.length === 1 ? "" : "s"} in ${what} ${list.length === 1 ? "needs" : "need"} attention first `
    + `(${parts.join(", ")}), in question${qs.length === 1 ? "" : "s"} ${qs.join(", ")}.`;
}
