// May a client start an analysis from their own Analyze page?
//
// Phase C had its own fair-use cap here (one analysis a day, 200 new pages a
// month). Phase D folds it into the monthly AI allowance (decisions 24 and 30):
// the allowance is the only limit, shared with every other paid client step.
// A press reads only documents that are new, changed, or read under older
// rules, so pressing with nothing new to read starts nothing and costs nothing.
//
// Analyses For Granted runs are never limited. Pure, so the page can explain
// the rule and the server enforce exactly the same one.
import type { AllowanceDecision } from "./allowance";

/** A page, for showing the size of a run: roughly a printed page of text. */
export const CHARS_PER_PAGE = 3000;

export const pagesOf = (chars: number) => Math.max(0, Math.ceil(chars / CHARS_PER_PAGE));

export type CapDecision =
  | { allowed: true; pages: number; warning: string | null }
  | { allowed: false; reason: "nothing_new" }
  | { allowed: false; reason: "allowance"; message: string };

export function decideClientRun(input: {
  pendingDocs: number; pendingChars: number; allowance: AllowanceDecision;
}): CapDecision {
  if (input.pendingDocs <= 0) return { allowed: false, reason: "nothing_new" };
  const a = input.allowance;
  if (!a.ok) return { allowed: false, reason: "allowance", message: a.message };
  return { allowed: true, pages: pagesOf(input.pendingChars), warning: "warning" in a ? a.warning : null };
}

/** One plain sentence for the page, when the button is not available. */
export function describeCap(d: CapDecision): string {
  if (d.allowed) return "";
  if (d.reason === "nothing_new") return "Everything in your Inven(s)tory has been analysed. Upload or change a document to analyse again.";
  return d.message;
}
