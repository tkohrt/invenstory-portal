// Funders a client cannot apply to.
//
// The grant side has screened for this since the beginning: a 501(c)(3)-only
// programme is not a "needs a check" for a for-profit, it is structurally
// impossible and gets dropped. The funder side has never screened at all, so a
// for-profit's shortlist could include foundations whose own guidelines say
// they fund registered charities only.
//
// The rule this implements: do not recommend a funder the client is precluded
// from applying to or being eligible for.
//
// Two things keep it honest. It screens only on text the funder actually
// stated, which in practice means a Ground Truth eligibility note somebody
// recorded from their site, and it never guesses from silence. A funder we know
// nothing about stays on the list, because "unknown" is not "ineligible".
//
// Pure and free of `server-only` so it is unit testable.
import type { EligibilityProfile } from "@/lib/eligibility-fields";
import type { FunderRow } from "@/lib/funder-rows";

/** Same patterns the grant screener has used against real eligibility text. */
const NONPROFIT_ONLY = /501\s*\(?c\)?\s*\(?3\)?\s*(organizations?\s*)?only|nonprofit organizations? only|tax-exempt organizations? only|only (?:fund|support|make grants to) (?:registered )?(?:501\s*\(?c\)?\s*\(?3\)?|charit|nonprofit)/i;
const GOV_ONLY = /\b(units? of local government|state agencies only|governmental entities only|tribal governments only)\b/i;
const INDIVIDUALS_ONLY = /\b(scholarships?|grants?) (?:are )?(?:made |awarded )?(?:to|for) individuals only\b|only (?:makes? )?grants? to individuals/i;

export interface FunderBlock {
  /** Short reason, shown to whoever is reading the filtered count. */
  reason: string;
  /** The funder's own words, so the call can be checked rather than trusted. */
  evidence: string;
}

/**
 * A hard blocker, or null.
 *
 * Deliberately narrow. Access mode is NOT treated as a blocker here even when
 * it says no unsolicited requests: a funder that will not read a cold
 * application may still be reachable through a board connection or an
 * introduction, and knowing how to do that is For Granted's business rather
 * than something to hide the row over. Those rows are already labelled.
 * "Not accepting" is the exception, because there is nothing to do this cycle.
 */
export function funderBlock(f: FunderRow, p: EligibilityProfile): FunderBlock | null {
  const text = `${f.access_note ?? ""} ${f.caveat ?? ""} ${f.focus ?? ""}`.trim();
  const isNonprofit = p.org_type === "nonprofit_501c3" || p.tax_status === "501c3";
  const isGov = p.org_type === "government" || p.org_type === "tribal";

  if (text && NONPROFIT_ONLY.test(text) && !isNonprofit) {
    return { reason: "funds registered charities only", evidence: text };
  }
  if (text && GOV_ONLY.test(text) && !isGov) {
    return { reason: "funds government entities only", evidence: text };
  }
  if (text && INDIVIDUALS_ONLY.test(text)) {
    return { reason: "grants to individuals, not organizations", evidence: text };
  }
  if (f.access_mode === "closed") {
    return {
      reason: "not accepting requests",
      evidence: f.access_note ?? "Recorded as not currently accepting requests.",
    };
  }
  return null;
}
