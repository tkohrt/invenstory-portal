// Form items: everything on a funder's form that is not a question to write.
//
// Form Items build spec, step 1 (16 October 2026). The reader sorts every item
// on the form into one of three kinds instead of leaving the non-written ones
// out:
//   written       a question answered in prose; a draft_section, as before;
//   fact          one value (short text, number, date, a choice, yes/no);
//   confirmation  something ticked or certified.
// Facts and confirmations are draft_form_item rows, which nothing in drafting
// reads. This file is the pure half: the vocabulary, how the reader's loose
// labels are read, and the sentence that accounts for every item.
//
// Pure and free of `server-only`, so every rule is tested without a model.

export const ITEM_KINDS = ["written", "fact", "confirmation"] as const;
export type ItemKind = typeof ITEM_KINDS[number];
export type FormKind = Exclude<ItemKind, "written">;

export const ANSWER_TYPES = ["short_text", "number", "date", "choice", "yes_no"] as const;
export type AnswerType = typeof ANSWER_TYPES[number];

export const ANSWER_TYPE_LABEL: Record<AnswerType, string> = {
  short_text: "Short answer", number: "Number", date: "Date", choice: "Choice", yes_no: "Yes / No",
};
export const KIND_LABEL: Record<FormKind, string> = { fact: "Form fact", confirmation: "Confirmation" };

/** At most this many options are kept for a choice; a longer list is the funder's, but not ours to display whole. */
export const MAX_OPTIONS = 30;
/** More form fields than a form holds suggests a reading problem. */
export const MAX_FORM_ITEMS = 200;

/**
 * Read the reader's label for an item's kind.
 *
 * Lenient about wording ("checkbox", "form field", "narrative"). Anything
 * unrecognised, or no label at all, is WRITTEN: an item wrongly in the
 * questions is seen and moved by a person, while one wrongly hidden among
 * the form fields is easier to miss. Window answers saved before items had
 * kinds therefore read as written, which is what they were.
 */
export function readKind(v: unknown): ItemKind {
  const s = String(v ?? "").toLowerCase().replace(/[\s_-]+/g, " ").trim();
  if (/^(fact|field|form field|value|short value|single value)$/.test(s)) return "fact";
  if (/^(confirmation|confirm|checkbox|check box|certification|certify|acknowledg(e)?ment|consent)$/.test(s)) return "confirmation";
  return "written";
}

/** Read the reader's label for a fact's answer type. Unknown is a short answer. */
export function readAnswerType(v: unknown): AnswerType {
  const s = String(v ?? "").toLowerCase().replace(/[\s_/-]+/g, " ").trim();
  if (/^(yes no|y n|boolean|bool|yesno)$/.test(s)) return "yes_no";
  if (/^(number|numeric|integer|count|amount|currency|money)$/.test(s)) return "number";
  if (/^(date|day)$/.test(s)) return "date";
  if (/^(choice|select|select one|dropdown|drop down|multiple choice|multi select|multiselect|radio|options?)$/.test(s)) return "choice";
  return "short_text";
}

/** The options of a choice: trimmed, non-empty, de-duplicated, at most MAX_OPTIONS. */
export function readOptions(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const o of v) {
    const t = typeof o === "string" ? o.trim().slice(0, 300) : "";
    if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/** A confirmation has no answer type; a fact always has one. */
export function answerTypeFor(kind: FormKind, t: AnswerType | null | undefined): AnswerType | null {
  return kind === "confirmation" ? null : (t ?? "short_text");
}

export interface ItemCounts { written: number; facts: number; confirmations: number; attachments: number }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The sentence that accounts for every item the reader found, the trust line
 * at the top of the confirmation screen: "31 items found in the application:
 * 13 to write, 15 form facts and 3 confirmations." Attachments are counted
 * apart, since a funder rarely numbers them among the form's items. Kinds with
 * nothing in them are left out of the list.
 */
export function reconciliationLine(c: ItemCounts): string {
  const total = c.written + c.facts + c.confirmations;
  const parts = [
    c.written ? `${c.written} to write` : null,
    c.facts ? plural(c.facts, "form fact", "form facts") : null,
    c.confirmations ? plural(c.confirmations, "confirmation", "confirmations") : null,
  ].filter((x): x is string => !!x);
  const list = parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const head = total ? `${plural(total, "item", "items")} found in the application: ${list}.` : "No items found in the application.";
  return c.attachments ? `${head} Plus ${plural(c.attachments, "attachment", "attachments")} to upload.` : head;
}
