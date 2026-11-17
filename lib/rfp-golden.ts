// The golden set: 20 opportunities with settled verdicts (patch 54, 17 Nov 2026).
//
// From the Big Kitty Labs re-run of 12 November 2026: every row traced to its
// issuing source where possible, scored blind under Rubric v1, then settled
// under the v1.1 amendments. Frozen as the RFP Engine's regression set: no
// rubric or prompt change ships unless a run over these rows holds the 80% bar
// (GOLDEN_BAR). Used two ways:
//   - tests/portal/rfp-golden.test.ts: the rules alone, with the frozen fits,
//     must reproduce every settled verdict (no model, no network);
//   - /api/admin/rfp-golden: the live model judges fit for each row and the
//     run is scored against these verdicts, then recorded (rfp_golden_run).
//
// Only public procurement facts are here. The client's capability profile,
// which the live run needs, is held in the database (rfp_golden_profile,
// migration 0095), never in this repository: the repository is public.
//
// Descriptions are the source pack's facts, shortened. Rows are scored as of
// their original windows (spring 2026), so today's date never enters.
import type { GovAnswers } from "./gov-readiness";
import type { Action, FitJudgment, RfpNoticeInput } from "./rfp-rubric";

export interface GoldenRow {
  id: string;
  label: string;
  notice: RfpNoticeInput;
  /** The settled verdict. */
  expected: Action;
  /** Also acceptable: a call the 12 Nov calibration left genuinely open. */
  accept?: Action[];
  /** The frozen fit judgment (blind score, settled under v1.1); null where fit is never reached. */
  frozen: FitJudgment | null;
  /** T1-verified when the 7 Nov verdicts were locked: the original comparison set. */
  comparable: boolean;
  note?: string;
}

/** The scoring date for every row: inside the spring 2026 windows. */
export const GOLDEN_AS_OF = new Date("2026-05-15T12:00:00Z");

const stamp = { by: "golden-set", role: "admin" as const, at: "2026-11-12T00:00:00.000Z" };

/**
 * The client's gates as the 12 Nov profile recorded them: SAM held; no
 * facility clearance, CMMC or GSA Schedule on record (treated as not held);
 * FedRAMP satisfiable by architecture; small business, no socio-economic
 * certifications.
 */
export const GOLDEN_GATES: GovAnswers = {
  sam: { status: "active", uei: null, cage: null, expires: null, ...stamp },
  clearance: { level: "none", ...stamp },
  cmmc: { level: "none", ...stamp },
  fedramp: { posture: "none", ...stamp },
  gsa_schedule: { status: "none", contract: null, ...stamp },
  set_asides: { statuses: { small_business: "yes", eight_a: "no", wosb: "no", hubzone: "no", sdvosb: "no" }, ...stamp },
};

const fit = (f: FitJudgment["fit"], o: Partial<FitJudgment> = {}): FitJudgment =>
  ({ fit: f, shapeable: false, dealBreaker: null, strategic: null, ...o });
const fed = (o: Omit<RfpNoticeInput, "jurisdiction" | "evidence_tier"> & { evidence_tier?: RfpNoticeInput["evidence_tier"] }): RfpNoticeInput =>
  ({ evidence_tier: "T1", jurisdiction: "federal", ...o });
const sl = (o: Omit<RfpNoticeInput, "jurisdiction" | "evidence_tier"> & { evidence_tier?: RfpNoticeInput["evidence_tier"] }): RfpNoticeInput =>
  ({ evidence_tier: "T1", jurisdiction: "state_local", ...o });

export const GOLDEN_ROWS: GoldenRow[] = [
  {
    id: "R1", label: "Army INSCOM, Intelligence and Automation Operations", comparable: true,
    notice: fed({
      title: "Intelligence and Automation Operations", agency: "Army Contracting Command (INSCOM)",
      notice_type: "solicitation", notice_type_raw: "Solicitation", set_aside: "SBA",
      description: "Solicitation W50NH9-26-R-A002. Total Small Business Set-Aside, NAICS 541519. Contractor personnel for operational intelligence integration, data-centric support, staffing, recruitment, vetting, training, surge and 24/7 operations; about 488,994 labor hours over 5 years. Package includes DD Form 254 requiring TOP SECRET facility security clearance with SCI access; CMMC L2 noted; Sections L/M and a Government Format Pricing Model attached.",
    }),
    expected: "skip_team", frozen: fit("Low"),
  },
  {
    id: "R2", label: "ARCYBER / CFIC, AI Effects at the Edge assessment event", comparable: true,
    notice: fed({
      title: "AI Effects at the Edge", agency: "Army Cyber Command (ARCYBER) / Cyber Fusion Innovation Center",
      notice_type: "special_notice", notice_type_raw: "Special Notice",
      description: "Assessment event held June 9-11 2026; white paper and demo entry. An AI/ML model embedded on a commercial platform that autonomously develops and deploys Modular Mission Payloads (cyber-effects payloads) integrated with connected sensors. Non-FAR agreements, competitive like a BAA or CSO, judged on technical merit; no set-aside or clearance bar at submission. The event family has recurred since at least 2022.",
    }),
    expected: "pass", frozen: fit("Low", { strategic: null }),
    note: "Amendment 1: Low fit with open gates is a pass; the category is worth a watch because it recurs.",
  },
  {
    id: "R3", label: "AI research and evaluation service (unverified)", comparable: false,
    notice: fed({
      title: "Artificial Intelligence Research and Evaluation Service", evidence_tier: "T2",
      notice_type: "solicitation",
      description: "Tracker row only (aggregator ID DRA-10651): AI model assessment, benchmarking, bias testing. No public record under this ID; issuing agency not identified.",
    }),
    expected: "cannot_score", frozen: null,
  },
  {
    id: "R4", label: "NRC, AI/ML cybersecurity for reactors", comparable: false,
    notice: fed({
      title: "Cybersecurity of Novel Technology Implementations in Operating and New/Advanced Reactors: Artificial Intelligence and Machine Learning",
      agency: "Nuclear Regulatory Commission", notice_type: "solicitation", set_aside: "SBA",
      description: "Solicitation 31310026R0012. Total small business set-aside; NAICS 541715/541512. Expert cybersecurity services for assessment, strategy and protection of AI/ML implementations in nuclear reactor environments; nuclear-domain expertise expected.",
    }),
    expected: "pass", frozen: fit("Low"),
  },
  {
    id: "R5", label: "Central Health, predictive analytics and CDS platform", comparable: true,
    notice: sl({
      title: "AI-Powered Predictive Analytics & Clinical Decision Support Platform for Emergency Department Utilization and Preventable Readmissions Reduction",
      agency: "Central Health (Travis County Healthcare District)", notice_type: "solicitation", notice_type_raw: "RFQ",
      description: "RFQ 2605-001, a Request for Qualifications to pre-qualify firms to design, implement and support the platform. Data integration across clinical, claims, ADT, pharmacy and behavioral health; safety-net populations. Evaluation emphasizes outcomes, AI modeling and CDS performance, implementation strategy, organizational experience and responsible AI practices. Open to all qualified firms, no set-aside.",
    }),
    expected: "lean_bid", frozen: fit("Medium"),
    note: "Amendment 5: shipped health work is administrative, not clinical, so fit caps at Medium. A committed pursuit with a clinical partner as the named mitigation.",
  },
  {
    id: "R6", label: "Legal aid AI intake system (attribution unconfirmed)", comparable: false,
    notice: sl({
      title: "Technology and AI Integration for Legal Aid Intake System", evidence_tier: "T2",
      notice_type: "solicitation",
      description: "Tracker row attributed to a Minnesota state agency (aggregator ID AI-1029). No matching Minnesota solicitation. A probable but unconfirmed match: Legal Services of Eastern Missouri, AI-driven intake system consulting RFP.",
    }),
    expected: "cannot_score", frozen: null,
    note: "Amendment 6: a candidate match is a verification task, never evidence.",
  },
  {
    id: "R7", label: "Missouri AI governance dashboard (unverified)", comparable: false,
    notice: sl({
      title: "AI Governance and Policy Compliance Dashboard Services", evidence_tier: "T2",
      notice_type: "solicitation",
      description: "Tracker row (aggregator ID AI-1028). No matching Missouri solicitation located; the category is real (Missouri Executive Order 26-02).",
    }),
    expected: "cannot_score", frozen: null,
  },
  {
    id: "R8", label: "Federal new-generation AI and ML tools (unverified)", comparable: false,
    notice: fed({
      title: "New Generation AI and ML Tools & Strategies", evidence_tier: "T2",
      notice_type: "solicitation",
      description: "Tracker row (aggregator ID AI-1014): LLM integration, agentic AI, enterprise deployment. No public record under this ID.",
    }),
    expected: "cannot_score", frozen: null,
  },
  {
    id: "R9", label: "AFLCMC Hanscom, GEOINT AI/ML orchestration RFI", comparable: false,
    notice: fed({
      title: "Request for Information (RFI) for GEOINT AI/ML Algorithm Orchestration Framework",
      agency: "Air Force Life Cycle Management Center (AFLCMC) C2ISR", notice_type: "sources_sought", notice_type_raw: "Sources Sought",
      description: "Notice FA239826, no set-aside. Capability statements on algorithm orchestration and workflows for processing geospatial imagery, GEOINT algorithm storefronts, integration with existing exploitation systems; questions include production capacity for large-scale ML imagery processing and the respondent's ability to obtain and maintain clearances for potential future work.",
    }),
    expected: "answer", frozen: fit("Medium"),
  },
  {
    id: "R10", label: "SCDOT, Enterprise Tech and AI Strategic Roadmap", comparable: false,
    notice: sl({
      title: "Enterprise Tech & AI Strategic Roadmap", agency: "South Carolina Department of Transportation",
      notice_type: "solicitation", notice_type_raw: "RFP",
      description: "Solicitation 5400029524. Consulting services to develop an AI Strategic Plan integrated with enterprise IT/OT strategy and data governance: current-state assessment, AI adoption roadmap, validation workshops, change management, workforce readiness, governance implementation planning, executive briefings.",
    }),
    expected: "lean_bid", frozen: fit("Medium"),
    note: "A committed pursuit; out-of-state vendor registration is a lift item, not a gate (amendment 7).",
  },
  {
    id: "R11", label: "FMPA, AI utility infrastructure data collection", comparable: false,
    notice: sl({
      title: "AI Utility Infrastructure Data Collection System", agency: "Florida Municipal Power Agency",
      notice_type: "solicitation", notice_type_raw: "RFP",
      description: "RFP 2026-209. End-to-end AI-enabled system for GIS-ready utility inventory using georeferenced imagery or spatial capture to document poles and attachments; automated detection, classification and measurement of assets via computer vision; results to Esri ArcGIS.",
    }),
    expected: "lean_bid", accept: ["pass"], frozen: fit("Medium"),
    note: "At its window this is a lean bid. The July 2026 award to a specialist computer-vision product company moved it among the no's on slide 5; the engine cannot know an outcome in advance, so either verdict agrees.",
  },
  {
    id: "R12", label: "DOJ Antitrust Division, data analytics RFI", comparable: true,
    notice: fed({
      title: "ATR IT Modernization: Data Analytics Solution", agency: "Department of Justice, Antitrust Division",
      notice_type: "sources_sought", notice_type_raw: "Sources Sought",
      description: "RFI TMF5-1bRFI, no set-aside. Market research for an enterprise AI-enabled data analytics solution for litigation and investigation support: large-scale ingestion of structured and unstructured data, AI/ML for economic analysis and pattern detection, Azure integration. Vendors must provide at least three case studies of implementing data analytics solutions for government agencies.",
    }),
    expected: "answer", frozen: fit("Medium", { dealBreaker: "three government case studies are required, and the client has no government past performance" }),
    note: "Amendment 4: answer in a reframed capacity, stated in the verdict.",
  },
  {
    id: "R13", label: "DOL, AI-enabled accessibility tooling RFI", comparable: false,
    notice: fed({
      title: "RFI for AI Enabled Accessibility Tooling", agency: "Department of Labor, OASAM/OCIO",
      notice_type: "sources_sought", notice_type_raw: "Sources Sought",
      description: "RFI OAA-26-00311, full and open. AI-enabled Section 508 accessibility compliance tooling, 50 user licenses: automated 508/WCAG scanning, document remediation, code-level repair suggestions, a copilot, dashboards; asks about migrating from legacy tools and AI token pricing.",
    }),
    expected: "pass", frozen: fit("Low", { shapeable: false }),
    note: "Amendment 2: a licensed-product survey the client has no offering for.",
  },
  {
    id: "R14", label: "Nevada Controller's Office, secure data management and AI readiness", comparable: false,
    notice: sl({
      title: "Secure Information Management and Analytics", agency: "State of Nevada Controller's Office",
      notice_type: "solicitation",
      description: "Solicitation 06CO-S3891. Enterprise data connectivity and AI readiness; one-time purchase including intelligence analytics design, server maintenance and developer maintenance; specific line items with part numbers in the listing.",
    }),
    expected: "pass", frozen: fit("Low"),
    note: "Specified line items suggest a directed buy.",
  },
  {
    id: "R15", label: "Census CENTAM (draft)", comparable: true,
    notice: fed({
      title: "Census Bureau Transformation and Application Modernization (CENTAM)", agency: "U.S. Census Bureau",
      notice_type: "presolicitation", notice_type_raw: "Presolicitation",
      description: "Notice YA1323-26-CENTAMSN-0002, a DRAFT solicitation for industry review. Four Blanket Purchase Agreements, $1B-$2.6B over about 10 years, supporting the 2030 Decennial Census: application modernization, data analytics, AI/ML, DevSecOps, geospatial. BPAs under GSA are competed among GSA Schedule holders via eBuy. Part A solicitation expected Q1 FY27.",
    }),
    expected: "watch_gate_plan", frozen: null,
    note: "Amendment 3: gate closed plus draft stage, with a gate (a GSA Schedule) that can be opened or teamed before the solicitation lands.",
  },
  {
    id: "R16", label: "HUD H2TNG sources sought", comparable: true,
    notice: fed({
      title: "Technology Transformation Next Generation (H2TNG)", agency: "Department of Housing and Urban Development",
      notice_type: "sources_sought", notice_type_raw: "Sources Sought",
      description: "Sources Sought NFNC20260310 with a draft Performance Work Statement, replacing a canceled presolicitation, for a multiple-award IDIQ for enterprise IT support and transformation across HUD.",
    }),
    expected: "answer", frozen: fit("Medium"),
  },
  {
    id: "R17", label: "Commerce, direct-to-CSP cloud BPA", comparable: true,
    notice: fed({
      title: "Cloud Vehicle Blanket Purchase Agreement procurement strategy", agency: "Department of Commerce",
      notice_type: "special_notice", notice_type_raw: "Special Notice",
      description: "Special notice 62172. $4.105B over 10 years for native hyperscale cloud services. Only OEMs acting as cloud service providers are eligible; participation limited to GSA MAS holders under SIN 518210C via GSA eBuy. The notice is informational only.",
    }),
    expected: "skip_team", frozen: null,
  },
  {
    id: "R18", label: "NOAA AWIPS cloud (awarded)", comparable: false,
    notice: fed({
      title: "AWIPS cloud", agency: "NOAA National Weather Service", evidence_tier: "T2",
      notice_type: "award",
      description: "Tracker records the solicitation as awarded, status tracking: moving the forecaster workstation platform to the cloud. No active solicitation.",
    }),
    expected: "track_recompete", frozen: null,
    note: "Amendment 3: a tracker-stated award is tracked for recompete without full verification.",
  },
  {
    id: "R19", label: "DoDEA, cloud FOIA software sources sought", comparable: false,
    notice: fed({
      title: "Cloud-Based FOIA Management Software", agency: "Department of Defense Education Activity",
      notice_type: "sources_sought", notice_type_raw: "Sources Sought",
      description: "Sources sought HE12542051426, market research only: cloud FOIA management software, case management, electronic data review, AI-powered redaction, a public access link to the National FOIA Portal, migration from FOIAXpress.",
    }),
    expected: "answer", accept: ["pass"], frozen: fit("Low", { shapeable: true }),
    note: "Settled as a free response (slide 5). Amendment 2's text would also allow a pass, so either verdict agrees.",
  },
  {
    id: "R20", label: "Surface Transportation Board forecast", comparable: true,
    notice: fed({
      title: "Cloud Services for Amazon Web Services and Microsoft 365", agency: "Surface Transportation Board (via DOT)",
      notice_type: "forecast",
      description: "Procurement forecast OST-STB-2024-05 with named incumbents; no solicitation or deadline. The 2025-2026 forecast splits it into smaller line items, including an ISP connectivity successor forecast around August 2026.",
    }),
    expected: "watch", frozen: null,
  },
];
