// The voice profile's sources (Auto-Draft build spec, section 3; 12 October
// 2026). Pure; tested in tests/drafter/voice-profile.test.ts.
//
// A voice profile says how a client tends to build answers: where stories sit
// against data, how bridges open and close, paragraph shape, words they reach
// for. Voice and structure only, never facts: every figure, name and claim in
// a draft must still come from a placed Story Card.
//
// This patch is the plumbing only (Shane, 12 October 2026). Nothing writes a
// profile automatically: For Granted writes and corrects it on the client's
// activity page, and the house style guide and the profile guide are to be
// written together at the end of the Auto-Draft build.
//
// Its sources:
//   1. approved Standard Answers for this client;
//   2. documents a person tagged Past grant application (type_tag
//      past_application; filenames and titles are never used, so blank funder
//      forms and RFPs stay out), weighing more when their outcome is Won;
//   3. drafts in the portal marked Won, which count as winning automatically.
// The minimum to auto-draft is one approved Standard Answer or one tagged past
// application.

export type VoiceSourceKind = "standard_answer" | "past_application" | "won_draft";

export interface VoiceSource {
  kind: VoiceSourceKind;
  id: string;
  title: string;
  /** A winning grant: a past application whose outcome is Won, or a draft marked Won. */
  winning: boolean;
}

/** How much a source counts in the profile. Winning sources count more (spec section 3). */
export const VOICE_WEIGHT = { winning: 2, other: 1 } as const;

export const VOICE_KIND_LABEL: Record<VoiceSourceKind, string> = {
  standard_answer: "Approved Standard Answer",
  past_application: "Past grant application",
  won_draft: "Draft marked Won",
};

export function voiceSources(input: {
  answers: { id: string; question: string | null }[];
  documents: { id: string; title: string; type_tag?: string | null; outcome?: string | null }[];
  drafts: { id: string; title: string; status: string; purpose?: string | null }[];
}): VoiceSource[] {
  const answers: VoiceSource[] = input.answers.map(a => ({
    kind: "standard_answer", id: a.id, title: a.question?.trim() || "A Standard Answer", winning: false,
  }));
  const docs: VoiceSource[] = input.documents
    .filter(d => d.type_tag === "past_application")
    .map(d => ({ kind: "past_application", id: d.id, title: d.title, winning: d.outcome === "won" }));
  const drafts: VoiceSource[] = input.drafts
    .filter(d => d.status === "won" && d.purpose !== "standard_answers")
    .map(d => ({ kind: "won_draft", id: d.id, title: d.title, winning: true }));
  // Winning first, then by kind as listed, then by title, so the list reads the same every time.
  const order: VoiceSourceKind[] = ["past_application", "won_draft", "standard_answer"];
  return [...answers, ...docs, ...drafts].sort((a, b) =>
    Number(b.winning) - Number(a.winning) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.title.localeCompare(b.title));
}

export const sourceWeight = (s: Pick<VoiceSource, "winning">) => (s.winning ? VOICE_WEIGHT.winning : VOICE_WEIGHT.other);

/**
 * Whether there is enough to auto-draft from: at least one approved Standard
 * Answer or one tagged past application (spec section 3). A draft marked Won
 * weighs as winning but is not one of the two the spec names, so on its own it
 * does not meet the minimum; the Brain alone never does.
 */
export function minimumMet(sources: Pick<VoiceSource, "kind">[]): boolean {
  return sources.some(s => s.kind === "standard_answer" || s.kind === "past_application");
}

export const MINIMUM_MESSAGE =
  "Auto-draft needs at least one approved Standard Answer or one document tagged Past grant application for this client.";

/** One source as a stable key: its kind, id and whether it is winning. */
const keyOf = (s: Pick<VoiceSource, "kind" | "id" | "winning">) => `${s.kind}:${s.id}:${s.winning ? "w" : "-"}`;

/**
 * What changed in the sources since the profile was last written: sources
 * added, sources gone, and sources whose winning status changed (a past
 * application given the outcome Won, say). Empty lists mean nothing changed.
 */
export function sourcesChanged(saved: VoiceSource[], current: VoiceSource[]): {
  added: VoiceSource[]; removed: VoiceSource[]; outcome: VoiceSource[]; any: boolean;
} {
  const savedById = new Map(saved.map(s => [`${s.kind}:${s.id}`, s]));
  const currentById = new Map(current.map(s => [`${s.kind}:${s.id}`, s]));
  const added = current.filter(s => !savedById.has(`${s.kind}:${s.id}`));
  const removed = saved.filter(s => !currentById.has(`${s.kind}:${s.id}`));
  const outcome = current.filter(s => {
    const was = savedById.get(`${s.kind}:${s.id}`);
    return was !== undefined && keyOf(was) !== keyOf(s);
  });
  return { added, removed, outcome, any: added.length + removed.length + outcome.length > 0 };
}

/** The stored sources list from untrusted JSON: anything malformed is dropped. */
export function parseSources(v: unknown): VoiceSource[] {
  if (!Array.isArray(v)) return [];
  const kinds = new Set<string>(Object.keys(VOICE_KIND_LABEL));
  return v.flatMap(x => {
    const o = x as Partial<VoiceSource> | null;
    return o && typeof o === "object" && typeof o.id === "string" && typeof o.kind === "string" && kinds.has(o.kind)
      ? [{ kind: o.kind as VoiceSourceKind, id: o.id, title: typeof o.title === "string" ? o.title : "", winning: o.winning === true }]
      : [];
  });
}

/** The longest profile For Granted can save, in characters. */
export const PROFILE_MAX_CHARS = 20000;
