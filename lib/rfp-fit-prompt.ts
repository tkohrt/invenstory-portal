// The RFP Engine's one judgment: fit, on shape of work (patch 54, 17 Nov 2026).
//
// Pure: the prompt and the reading of the reply (tests/portal/rfp-fit-prompt.
// test.ts). Patch 56 (17 Nov 2026): the first live golden run passed at exactly
// 80% with every miss one notch harsh (Medium read as Low), because the model
// let gates, deal-breakers and the contract vehicle lower fit and used Low for
// anything unfamiliar. The prompt now states the rubric's own limits on Low and
// what may not move fit. No row of the golden set is named in it. The call itself is lib/server/rfp-fit.ts. Rubric v1.1 step 3, with
// amendments 2 (shapeable RFIs), 4 (deal-breakers), 5 (vertical granularity)
// and 8 (provisional fit for forecasts) written into the instructions.
//
// The notice is public procurement text the portal did not write, so it goes in
// fenced as PROCUREMENT_NOTICE. The client profile goes in as CLIENT_CONTEXT.
// Both quotes in the reply are checked against those two texts: a fit whose
// quotes cannot be found is kept but marked unverified, for a person to look at.
import { untrusted } from "./untrusted";
import { quoteInText } from "./story-card";
import type { Fit, FitJudgment, RfpNoticeInput, Stage } from "./rfp-rubric";

export const FIT_SYSTEM = [
  "You screen government contracting opportunities for one client, applying a written rubric strictly. Judge only from the client profile and the notice you are given.",
  "",
  "Your one job is FIT: does the WORK this notice describes match what the client demonstrably sells and has shipped? Nothing else lowers or raises fit.",
  "",
  "Decided elsewhere, so they must NOT move fit in either direction:",
  "- Gates and eligibility: clearances, CMMC, FedRAMP, GSA Schedules, set-asides, registrations, past performance on government contracts. A notice that asks about clearances is judged on its work alone.",
  "- Deal-breakers: report them in deal_breaker; never lower fit because of one.",
  "- The contract vehicle and the effort: IDIQ, BPA, task orders, size and duration belong to the effort estimate. Judge the work the notice describes, not the vehicle it will be bought through.",
  "",
  "Fit is about the SHAPE of the work, never keyword overlap. Use these definitions exactly:",
  "- High: the deliverable is a build or assessment the client demonstrably sells, in a vertical they have shipped in, with no structural mismatch.",
  "- Medium: the client could deliver this kind of work, but it is adjacent or undifferentiated, or it is in a domain outside their shipped experience despite a friendly format. A build or assessment of the kind the client sells, in an unfamiliar domain, is Medium, not Low.",
  "- Low: ONLY a shape mismatch, whatever the vocabulary: staffing, labor-hour or personnel-augmentation contracts; cyber operations or cybersecurity services; commodity or license resale; OEM-only scope; regulatory research services; buying a packaged or licensed product the client has no product for. If none of these shapes applies, fit is not Low.",
  "A shipped vertical means the same domain AND the same data-and-workflow class. An industry label alone caps fit at Medium (administrative health software is not clinical decision support); it does not make fit Low.",
  "",
  "Before answering, name to yourself which definition the work matches. Choose Low only if you can name the shape mismatch from the Low list.",
  "",
  "Also report:",
  "- shapeable (RFI or sources sought only, else false): could a response credibly shape the requirement toward something the client builds? A survey of off-the-shelf products the client has no offering for is not shapeable.",
  "- deal_breaker: a mandatory element of the response the client plainly cannot meet (for example a required number of government case studies when the profile shows none), in a short phrase; otherwise null.",
  "- strategic: a strategic value the PROFILE names that bears on this notice (a stated relationship with this buyer, a funded program, a category that recurs for the client), in a short phrase; otherwise null. Never invent one.",
  "",
  "Quote your evidence by COPYING, not paraphrasing: client_quote is one unbroken run of 5 to 25 words copied character for character from the client profile, and notice_quote one unbroken run of 5 to 25 words copied character for character from the notice. No ellipses, no joined fragments, no added or changed words.",
  "",
  "Reply with JSON only, no prose before or after:",
  '{"fit":"High|Medium|Low","client_quote":"...","notice_quote":"...","rationale":"one sentence citing the deciding facts","shapeable":false,"deal_breaker":null,"strategic":null}',
].join("\n");

export function fitUserPrompt(profile: string, n: RfpNoticeInput, stage: Stage): string {
  const kind = stage === "rfi" ? "an RFI or sources sought (market research)"
    : stage === "assessment_event" ? "an assessment event or white-paper call"
    : stage === "forecast" || stage === "draft" || stage === "presolicitation" ? "an early-stage notice (score a provisional fit)"
    : "a solicitation";
  const notice = [
    `Title: ${n.title}`,
    n.agency ? `Agency: ${n.agency}` : "",
    n.notice_type_raw ? `Notice type: ${n.notice_type_raw}` : "",
    n.set_aside ? `Set-aside: ${n.set_aside}` : "",
    n.description ? `\n${n.description}` : "",
  ].filter(Boolean).join("\n");
  return [
    "CLIENT PROFILE:",
    untrusted("CLIENT_CONTEXT", profile),
    "",
    `THE NOTICE (${kind}):`,
    untrusted("PROCUREMENT_NOTICE", notice),
    "",
    "Judge fit and reply with the JSON only.",
  ].join("\n");
}

export interface FitReply extends FitJudgment {
  rationale: string;
  evidence: { from: "client" | "notice"; text: string }[];
  /** False when either quote could not be found in its source. */
  quotesVerified: boolean;
}

const FITS: Fit[] = ["High", "Medium", "Low"];
const phrase = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t && !/^(null|none|n\/a)$/i.test(t) ? t.slice(0, max) : null;
};

/** The model's reply, read strictly. Null when it is not usable JSON with a fit. */
export function parseFitReply(raw: string, profile: string, noticeText: string): FitReply | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(m[0]); } catch { return null; }
  const fit = FITS.find(f => f.toLowerCase() === String(o.fit ?? "").trim().toLowerCase());
  if (!fit) return null;
  const clientQuote = phrase(o.client_quote, 300);
  const noticeQuote = phrase(o.notice_quote, 300);
  const evidence: FitReply["evidence"] = [];
  if (clientQuote) evidence.push({ from: "client", text: clientQuote });
  if (noticeQuote) evidence.push({ from: "notice", text: noticeQuote });
  const quotesVerified = !!clientQuote && !!noticeQuote
    && quoteInText(clientQuote, profile) && quoteInText(noticeQuote, noticeText);
  return {
    fit,
    shapeable: o.shapeable === true,
    dealBreaker: phrase(o.deal_breaker, 200),
    strategic: phrase(o.strategic, 200),
    rationale: phrase(o.rationale, 400) ?? "",
    evidence,
    quotesVerified,
  };
}

/** The notice text the quotes are checked against: what the prompt showed. */
export function noticeTextOf(n: RfpNoticeInput): string {
  return [n.title, n.agency ?? "", n.notice_type_raw ?? "", n.set_aside ?? "", n.description ?? ""].join("\n");
}
