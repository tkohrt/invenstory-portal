// What a question still needs, and how far the whole application has come
// (9 October 2026). Pure; tested in tests/drafter/draft-gaps.test.ts.
//
// The gap panel sits under each question. For every kind of card the question
// calls for it says one of five things, most settled first:
//
//   in_answer    a card of this kind is in the answer
//   answered     the client answered For Granted's question, and the card it made is ready to use
//   asked        For Granted asked the client, and is waiting
//   in_library   the Story Cards hold cards of this kind not used here (Show them)
//   none         nothing yet: Add it now (write it as a user-generated card) or Ask the client

export type GapState = "in_answer" | "answered" | "asked" | "in_library" | "none";

export interface GapAsk {
  id: string; sectionId: string | null; kind: string; question: string;
  status: "open" | "answered" | "withdrawn";
  answer: string | null; cardId: string | null; askedAt: string; answeredAt: string | null;
}

export interface GapRow {
  kind: string;
  state: GapState;
  /** Cards of this kind in the library, not in this answer, that can be placed or reviewed. */
  inLibrary: number;
  /** The newest question asked about this kind for this question, if any. */
  ask: GapAsk | null;
}

export function questionGaps(input: {
  sectionId: string;
  wantedKinds: string[];
  blocks: { kind: string; cardId: string | null }[];
  cards: { id: string; kind: string; status: string; placeable: boolean }[];
  asks: GapAsk[];
}): GapRow[] {
  const inAnswerIds = new Set(input.blocks.filter(b => b.kind === "card" && b.cardId).map(b => b.cardId as string));
  const byId = new Map(input.cards.map(c => [c.id, c]));
  const kindsIn = new Set([...inAnswerIds].map(id => byId.get(id)?.kind).filter(Boolean) as string[]);
  return [...new Set(input.wantedKinds)].map(kind => {
    const asks = input.asks
      .filter(a => a.sectionId === input.sectionId && a.kind === kind && a.status !== "withdrawn")
      .sort((a, b) => b.askedAt.localeCompare(a.askedAt));
    const ask = asks[0] ?? null;
    const inLibrary = input.cards.filter(c => c.kind === kind && c.status !== "retired" && c.placeable && !inAnswerIds.has(c.id)).length;
    const answeredCard = ask?.status === "answered" && ask.cardId ? byId.get(ask.cardId) : undefined;
    const state: GapState = kindsIn.has(kind) ? "in_answer"
      : answeredCard && answeredCard.status !== "retired" && !inAnswerIds.has(answeredCard.id) ? "answered"
      : ask?.status === "open" ? "asked"
      : inLibrary > 0 ? "in_library"
      : "none";
    return { kind, state, inLibrary, ask };
  });
}

/** The question For Granted sends the client, ready to edit. */
export function askDraft(prompt: string, kindLabel: string, describe: string): string {
  const q = prompt.replace(/\s+/g, " ").trim();
  const short = q.length > 140 ? `${q.slice(0, 137).replace(/\s+\S*$/, "")}…` : q;
  return `We are answering "${short}" and would like ${kindLabel.toLowerCase()} in your own words: ${describe}. A few sentences is plenty.`;
}

/** Limits on a question to the client and on the answer. */
export const ASK_LIMITS = { questionMin: 10, questionMax: 600 };

export function askProblem(question: string): string | null {
  const n = question.trim().length;
  if (n < ASK_LIMITS.questionMin) return "Write the question you would like the client to answer.";
  if (n > ASK_LIMITS.questionMax) return `Keep the question under ${ASK_LIMITS.questionMax} characters.`;
  return null;
}

/** The progress strip across the top of the Storyboard. */
export interface DraftProgress {
  questions: number;
  done: number;
  /** Cards that stop an answer leaving (unverified, sensitive, retired, reworded). */
  toReview: number;
  /** Bridges Weave proposed that nobody has accepted or rejected yet. */
  bridgesWaiting: number;
  /** Numbers in edited cards that the card's sources do not hold. */
  figuresToTrace: number;
  /** Questions to the client still waiting for an answer, and answers waiting to be used. */
  asksOpen: number;
  answersReady: number;
  /** The first question (index) with each, so the strip can go there. */
  firstBridge: number | null;
  firstFigure: number | null;
  firstAsk: number | null;
}

export function draftProgress(input: {
  sections: { id: string }[];
  blocksBy: Record<string, { kind: string; proposed: boolean }[]>;
  statusBy: Record<string, string>;
  toReview: number;
  /** How many untraced figures a block holds. */
  figuresIn: (sectionId: string, blockIndex: number) => number;
  /** Per section, from questionGaps. */
  gapsBy: Record<string, GapRow[]>;
}): DraftProgress {
  let bridgesWaiting = 0, figuresToTrace = 0, asksOpen = 0, answersReady = 0;
  let firstBridge: number | null = null, firstFigure: number | null = null, firstAsk: number | null = null;
  input.sections.forEach((s, i) => {
    const blocks = input.blocksBy[s.id] ?? [];
    const b = blocks.filter(x => x.kind === "bridge" && x.proposed).length;
    if (b) { bridgesWaiting += b; firstBridge ??= i; }
    let f = 0;
    blocks.forEach((_, bi) => { f += input.figuresIn(s.id, bi); });
    if (f) { figuresToTrace += f; firstFigure ??= i; }
    for (const g of input.gapsBy[s.id] ?? []) {
      if (g.state === "asked") { asksOpen++; firstAsk ??= i; }
      if (g.state === "answered") { answersReady++; firstAsk ??= i; }
    }
  });
  return {
    questions: input.sections.length,
    done: input.sections.filter(s => input.statusBy[s.id] === "done").length,
    toReview: input.toReview, bridgesWaiting, figuresToTrace, asksOpen, answersReady,
    firstBridge, firstFigure, firstAsk,
  };
}
