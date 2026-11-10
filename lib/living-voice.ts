// What to say in the Living Voice layer (patch 3 of the 1 November 2026 build).
//
// Layer III is where an organization's founder or leader speaks for itself:
// why they started, what drives them, who they work with and why. Those things
// rarely live in documents, and they are what a funder's language is matched
// against. People asked what to put there and could not remember the advice
// they were given on a call, so the questions live in the portal instead.
//
// Pure and free of `server-only`: the drawer, the readiness item and the
// getting-started card share one list, and it is unit tested.

export interface VoicePrompt { key: string; question: string }
export interface VoiceSection { key: string; title: string; prompts: VoicePrompt[] }

/** How the portal stores the organization's kind on the tenant row. */
export type TenantOrgType = "nonprofit" | "startup" | null;

const BASE: VoiceSection[] = [
  {
    key: "origin", title: "Where it started", prompts: [
      { key: "why_start", question: "Why did you start this work? What did you see that others were missing?" },
      { key: "moment", question: "Was there a moment when you decided to do it yourself? Tell it as a story." },
    ],
  },
  {
    key: "drive", title: "What drives you", prompts: [
      { key: "care", question: "What do you care about most in this work, and what would you never compromise on?" },
      { key: "success", question: "What does success look like for the people you serve, in their words rather than yours?" },
    ],
  },
  {
    key: "who", title: "Who you work with", prompts: [
      { key: "partners", question: "Which organizations or people do you most want to work with, and why them?" },
      { key: "story", question: "Tell one story of a person or organization whose situation changed because of your work. Use names and numbers where you can." },
    ],
  },
  {
    key: "where", title: "Where you work, and why there", prompts: [
      { key: "places", question: "Why these places or communities? What do you understand about working there that an outsider would not?" },
    ],
  },
  {
    key: "next", title: "What comes next", prompts: [
      { key: "funding", question: "What would you do with more funding over the next two years?" },
      { key: "obstacle", question: "What is the one thing holding the work back today?" },
    ],
  },
  // Added 9 Nov 2026 (Shane, from the 7 Nov walkthrough): an open field, so
  // anything the set questions did not ask for still has a place to land.
  {
    key: "open", title: "In your own words", prompts: [
      { key: "anything_else", question: "Anything else you want funders to know? Say it however you would say it out loud." },
    ],
  },
];

/** A company is asked one more thing funders always want to know. */
const STARTUP_EXTRA: VoicePrompt = {
  key: "why_company",
  question: "Why build this as a company? Who pays, and how does the mission survive the business model?",
};

export function voiceSections(orgType: TenantOrgType): VoiceSection[] {
  if (orgType !== "startup") return BASE;
  return BASE.map(s => s.key === "drive" ? { ...s, prompts: [...s.prompts, STARTUP_EXTRA] } : s);
}

export function allPrompts(orgType: TenantOrgType): VoicePrompt[] {
  return voiceSections(orgType).flatMap(s => s.prompts);
}

/** Advice shown above the questions. Sentences, not labels. */
export const VOICE_TIPS: readonly string[] = [
  "Record yourself answering out loud, the way you would leave a voice memo. Ten to twenty minutes is plenty.",
  "Speak to a funder you trust. Name real people, places and numbers; they become the evidence a grant cites.",
  "Upload the recording's transcript as a text or Word file to Layer III, or type your answers below instead.",
];

/** The questions as plain text, for copying into a notes app before recording. */
export function promptsAsText(orgType: TenantOrgType): string {
  const lines: string[] = ["Living Voice: questions to answer in your own words", ""];
  for (const s of voiceSections(orgType)) {
    lines.push(s.title.toUpperCase());
    for (const p of s.prompts) lines.push(`- ${p.question}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** Shortest answer set worth filing; the note action refuses under ten characters. */
export const MIN_ANSWER_CHARS = 40;

/**
 * Written answers as one Q and A text, in question order, unanswered questions
 * left out. The questions stay in the text so whoever reads it later (a person
 * or the analysis) knows what each answer is answering.
 */
export function answersToText(orgType: TenantOrgType, answers: Record<string, string>): string {
  const out: string[] = [];
  for (const p of allPrompts(orgType)) {
    const a = (answers[p.key] ?? "").trim();
    if (!a) continue;
    out.push(`Q: ${p.question}\nA: ${a}`);
  }
  return out.join("\n\n");
}

export function answeredCount(orgType: TenantOrgType, answers: Record<string, string>): number {
  return allPrompts(orgType).filter(p => (answers[p.key] ?? "").trim().length > 0).length;
}

// ---- Getting started (shown on the Inven(s)tory until it is done or hidden) ----

export interface StartFacts {
  /** Eligibility gaps tiered critical (org type, location, tax status). */
  criticalGaps: number;
  layerCounts: { I: number; II: number; III: number };
  readinessRun: boolean;
}

export type StartStepKey = "eligibility" | "layer1" | "layer2" | "layer3" | "readiness";

export interface StartStep { key: StartStepKey; title: string; detail: string; done: boolean }

export function startSteps(f: StartFacts): StartStep[] {
  return [
    { key: "eligibility", title: "Answer the Funding Eligibility questions",
      detail: "Organization type, where you are and your tax status. Without them nothing can be screened.",
      done: f.criticalGaps === 0 },
    { key: "layer1", title: "Add your public story (Layer I)",
      detail: "Your website, press, a LinkedIn profile: whatever a funder could find about you on their own.",
      done: f.layerCounts.I > 0 },
    { key: "layer2", title: "Add your internal documents (Layer II)",
      detail: "Past applications, budgets, plans, agreements: anything that holds the context of your story.",
      done: f.layerCounts.II > 0 },
    { key: "layer3", title: "Record your living voice (Layer III)",
      detail: "The founder or leader in their own words: why you started, what drives you, who you work with.",
      done: f.layerCounts.III > 0 },
    { key: "readiness", title: "Check your readiness",
      detail: "See what a funder would still ask for, and what to add next.",
      done: f.readinessRun },
  ];
}

/** Shown while any step is left, unless the person hid it. */
export function showStart(steps: StartStep[], hidden: boolean): boolean {
  return !hidden && steps.some(s => !s.done);
}
