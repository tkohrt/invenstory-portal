import type { GardenState } from "@/lib/types";

// Where a garden prompt's CTA should go. Item prompts deep-link to the Readiness
// screen (its own page since P1.5, patch 38) and open that checklist item's detail
// panel; eligibility prompts go to the Funding Eligibility page.
export function promptHref(p: GardenState["prompt"]): string {
  if (p?.itemKey) return `/readiness?item=${encodeURIComponent(p.itemKey)}`;
  if (p?.target === "eligibility") return "/funding-eligibility";
  return "/invenstory";
}
