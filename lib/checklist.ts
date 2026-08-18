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
  { key: "program",          label: "Program / product description",  gap: "Add a clear program or product description.",                 tier: "essential", layer: "II", audience: "all", demand: 50 },
  { key: "need",             label: "Statement of need (data-backed)",gap: "Add a data-backed statement of need.",                        tier: "essential", layer: "II", audience: "all", demand: 20 },
  { key: "budget",           label: "Operating budget / financials",  gap: "Add your operating budget or a financial overview.",          tier: "essential", layer: "II", audience: "all", demand: 28 },
  { key: "outcomes",         label: "Outcomes & evaluation",          gap: "Add outcomes with how you measure them.",                     tier: "essential", layer: "II", audience: "all", demand: 10 },
  { key: "goals",            label: "Goals & measurable objectives",  gap: "Add goals and measurable objectives.",                        tier: "essential", layer: "II", audience: "all", demand: 18 },
  { key: "founder_voice",    label: "Founder / leader interview",     gap: "Record a founder or leader interview (living voice).",         tier: "essential", layer: "III",audience: "all" },
  { key: "leadership",       label: "Leadership & team",              gap: "Add leadership and team backgrounds.",                        tier: "important", layer: "II", audience: "all", demand: 6 },
  { key: "capacity",         label: "Capacity / track record",        gap: "Add evidence of your capacity and track record.",             tier: "important", layer: "II", audience: "all", demand: 12 },
  { key: "timeline",         label: "Timeline & deliverables",        gap: "Add a timeline and deliverables.",                            tier: "important", layer: "II", audience: "all", demand: 12 },
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
