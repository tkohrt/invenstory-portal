// The Healthy Inven(s)tory Document Checklist — one source of truth for what a
// robust Inven(s)tory holds, org-type-aware and tiered. Read by the gap-detection
// agent and the readiness UI. See "Healthy Inven(s)tory Document Checklist — Spec".
export type ChecklistTier = "essential" | "important" | "enriching";
export type ChecklistAudience = "all" | "nonprofit" | "startup";

export interface ChecklistItem {
  key: string;
  label: string;            // shown when present
  gap: string;              // shown when missing (imperative)
  tier: ChecklistTier;
  layer: "I" | "II" | "III";
  audience: ChecklistAudience;
  demand?: number;          // measured funder-demand %, from the grants extraction
}

export const CHECKLIST: ChecklistItem[] = [
  // ---- shared ----
  { key: "public_story",     label: "Public story / website capture", gap: "Add your website or public-story capture.",                 tier: "essential", layer: "I",  audience: "all" },
  { key: "mission",          label: "Mission & positioning",          gap: "Capture your mission and positioning.",                       tier: "essential", layer: "I",  audience: "all", demand: 18 },
  { key: "program",          label: "Program / product description(s)", gap: "Add a clear description of your program(s) or product(s).",   tier: "essential", layer: "II", audience: "all", demand: 50 },
  { key: "need",             label: "Statement of need (data-backed)",gap: "Add a data-backed statement of need.",                        tier: "essential", layer: "II", audience: "all", demand: 20 },
  { key: "budget",           label: "Operating budget / financials",  gap: "Add your operating budget or a financial overview.",          tier: "essential", layer: "II", audience: "all", demand: 28 },
  { key: "outcomes",         label: "Impact measurement",             gap: "Add how you measure impact — methodology, metrics, and baselines.", tier: "essential", layer: "II", audience: "all", demand: 10 },
  { key: "founder_voice",    label: "Founder / leader interview",     gap: "Record a founder or leader interview (living voice).",         tier: "essential", layer: "III",audience: "all" },
  { key: "leadership",       label: "Leadership & team",              gap: "Add leadership and team backgrounds.",                        tier: "essential", layer: "II", audience: "all", demand: 6 },
  { key: "capacity",         label: "Track record",                   gap: "Add your track record — years operating, people served, programs run.", tier: "important", layer: "II", audience: "all", demand: 12 },
  { key: "theory_of_change", label: "Theory of change / logic model", gap: "Add a theory of change or logic model.",                      tier: "important", layer: "II", audience: "all" },
  { key: "partnerships",     label: "Partnerships & collaborations",  gap: "Add your key partnerships.",                                  tier: "important", layer: "II", audience: "all", demand: 6 },
  { key: "past_grants",      label: "Past grant applications",        gap: "Upload past grant applications (reuses your own voice).",      tier: "important", layer: "II", audience: "all" },
  { key: "sustainability",   label: "Sustainability plan",            gap: "Add a plan for sustaining the work beyond a grant.",           tier: "enriching", layer: "III",audience: "all", demand: 3 },
  { key: "equity",           label: "Equity / DEI approach",          gap: "Add your equity approach.",                                   tier: "enriching", layer: "II", audience: "all", demand: 4 },
  { key: "other_funding",    label: "Other funding sources",          gap: "Note your other funding sources and leverage.",               tier: "enriching", layer: "II", audience: "all", demand: 2 },
  { key: "client_story",     label: "Client / beneficiary story",     gap: "Add a client or beneficiary story.",                          tier: "enriching", layer: "III",audience: "all" },
  // ---- nonprofit ----
  { key: "irs_990",          label: "IRS 990 (recent)",               gap: "Add your most recent IRS 990.",                               tier: "essential", layer: "I",  audience: "nonprofit" },
  { key: "determination",    label: "501(c)(3) determination letter", gap: "Add your 501(c)(3) determination letter.",                    tier: "essential", layer: "II", audience: "nonprofit" },
  { key: "board_roster",     label: "Board roster / governance",      gap: "Add your board roster and governance docs.",                  tier: "important", layer: "II", audience: "nonprofit" },
  { key: "program_budgets",  label: "Program-level budgets",          gap: "Add program-level budgets.",                                  tier: "important", layer: "II", audience: "nonprofit" },
  { key: "funder_list",      label: "Funder list / grant history",    gap: "Add your funder list and grant history.",                     tier: "important", layer: "II", audience: "nonprofit" },
  { key: "annual_report",    label: "Annual report",                  gap: "Add your latest annual report.",                              tier: "enriching", layer: "I",  audience: "nonprofit" },
  { key: "eval_reports",     label: "Evaluation / 3rd-party reports",  gap: "Add any evaluation or third-party reports.",                  tier: "enriching", layer: "II", audience: "nonprofit" },
  // ---- for-profit / startup ----
  { key: "pitch_deck",       label: "Pitch deck",                     gap: "Add your pitch deck.",                                        tier: "essential", layer: "II", audience: "startup" },
  { key: "traction",         label: "Traction / proof metrics",       gap: "Add traction metrics, pilots, or case studies.",              tier: "essential", layer: "II", audience: "startup" },
  { key: "cap_table",        label: "Cap table / entity & raise",     gap: "Add your cap table, entity structure, and raise history.",     tier: "essential", layer: "II", audience: "startup" },
  { key: "go_to_market",     label: "Go-to-market & market size",     gap: "Add your go-to-market and market sizing.",                    tier: "important", layer: "II", audience: "startup" },
  { key: "competition",      label: "Competitive landscape",          gap: "Add your competitive landscape.",                             tier: "important", layer: "II", audience: "startup" },
  { key: "strategic_partners",label:"Strategic partners / LOIs",       gap: "Add strategic partners or letters of intent.",                tier: "important", layer: "II", audience: "startup" },
  { key: "investor_updates", label: "Investor updates",               gap: "Add investor updates or newsletters.",                        tier: "enriching", layer: "II", audience: "startup" },
  { key: "financial_model",  label: "Financial model / projections",  gap: "Add your financial model or projections.",                    tier: "enriching", layer: "II", audience: "startup" },
];

// Items applicable to an org given its type (from the eligibility profile).
export function checklistFor(orgType: string | null | undefined): ChecklistItem[] {
  const branch: ChecklistAudience = orgType === "for_profit" ? "startup" : "nonprofit";
  return CHECKLIST.filter(i => i.audience === "all" || i.audience === branch);
}

export const TIER_WEIGHT: Record<ChecklistTier, number> = { essential: 3, important: 2, enriching: 1 };

// Weighted readiness % given which item keys are present.
export function readinessPct(items: ChecklistItem[], present: Set<string>): number {
  const total = items.reduce((a, i) => a + TIER_WEIGHT[i.tier], 0);
  if (!total) return 0;
  const got = items.reduce((a, i) => a + (present.has(i.key) ? TIER_WEIGHT[i.tier] : 0), 0);
  return Math.round((got / total) * 100);
}

// Short "what it is + why funders care" blurb per item, for the expanded panel.
export const BLURBS: Record<string, string> = {
  public_story: "Your public-facing story: website, about page, press. Funders form their first impression here, so it must be clear and current.",
  mission: "A crisp statement of who you serve and the change you seek. Nearly every application opens with it, and funders screen for mission fit first.",
  program: "A concrete description of what you actually do. The single most requested item in grant applications: funders fund programs, not intentions.",
  need: "The problem you address, backed by data. Funders want evidence the need is real and urgent before they commit dollars.",
  budget: "Your operating budget and financial picture. Funders check that you can steward money responsibly and that the ask is proportional.",
  outcomes: "How you measure impact — your evaluation methodology, the metrics you track, and the baselines you measure against — alongside results to date. Funders fund proof: a credible measurement approach carries far more weight than activity counts.",
  founder_voice: "The founder or leader in their own words. This living voice gives applications authenticity no document can, and captures the origin story.",
  leadership: "Who leads and delivers the work. Funders assess whether the team has the capacity and credibility to execute.",
  capacity: "Your history of delivery — years operating, people served, and programs run. Funders de-risk grants by backing organizations that have demonstrably done the work before.",
  theory_of_change: "How your activities lead to outcomes. A logic model signals rigor and is often required by larger and federal funders.",
  partnerships: "Who you collaborate with. Partnerships show reach, leverage, and that you are not working in isolation.",
  past_grants: "Applications you have already written. They capture your own voice and reusable answers, and show funders your grant history.",
  sustainability: "How the work continues after the grant. Funders avoid one-time bets and want a path beyond their dollars.",
  equity: "How your work advances equity for those you serve. Increasingly a scored dimension in applications.",
  other_funding: "Your other funding and leverage. Funders like to see diversified support and that they are not the sole backer.",
  client_story: "A story from someone you serve. Proof with a human face that moves reviewers.",
  irs_990: "Your most recent IRS 990. Funders validate finances and past grants here; it is often the first document they pull.",
  determination: "Your 501(c)(3) determination letter. Hard proof of tax-exempt status and a common eligibility gate.",
  board_roster: "Your board and governance. Funders check for sound governance and an engaged, qualified board.",
  program_budgets: "Budgets at the program level. Funders want to see how their dollars map to specific work.",
  funder_list: "Your current funders and grant history. Shows momentum and helps funders see who already backs you.",
  annual_report: "Your annual report: a polished summary of impact and finances that builds funder confidence.",
  eval_reports: "Evaluations or third-party assessments. External validation carries more weight than self-reported claims.",
  pitch_deck: "Your pitch deck. The fastest way for a funder or investor to understand the opportunity and the ask.",
  traction: "Evidence it is working: pilots, metrics, case studies. Funders and investors fund proof, not promise.",
  cap_table: "Your ownership, entity structure, and raise history. Diligence basics any capital provider will ask for.",
  go_to_market: "How you reach customers and the market size. Shows the path to scale and impact.",
  competition: "Who else is in the space and how you differ. Funders want to know why you win.",
  strategic_partners: "Partners and letters of intent. External validation and distribution that de-risk the bet.",
  investor_updates: "Your investor updates. Show discipline, momentum, and transparent communication.",
  financial_model: "Your model and projections. Funders assess viability and how their capital extends runway or impact.",
};

export interface ReadinessItem {
  key: string; label: string; tier: ChecklistTier; layer: "I" | "II" | "III";
  state: "covered" | "thin" | "missing"; sources: { id: string; title: string }[]; blurb: string;
}
