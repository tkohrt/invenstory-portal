import type { GardenState } from "@/lib/types";

// Where a garden prompt's CTA should go. Item prompts deep-link to the Inven(s)tory
// page and open that Readiness checklist item's detail panel; eligibility prompts go
// to the Funding Eligibility page.
export function promptHref(p: GardenState["prompt"]): string {
  if (p?.itemKey) return `/invenstory?item=${encodeURIComponent(p.itemKey)}`;
  if (p?.target === "eligibility") return "/funding-eligibility";
  return "/invenstory";
}
