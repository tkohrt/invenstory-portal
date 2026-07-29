// MOCK DATA — shaped exactly like the future database rows (hex-only UUIDs).
// Deleted in Phase 3 when lib/data.ts switches to live queries.
import type {
  Tenant, AppUser, Document, DocumentTag, ArtifactType, ArtifactSet, ArtifactCard,
} from "./types";

const now = "2026-07-29T00:00:00Z";
export const T_FTC = "a1000000-0000-4000-8000-000000000001";
export const T_KHAI = "a2000000-0000-4000-8000-000000000002";
export const U_ADMIN_TYLER = "b1000000-0000-4000-8000-000000000001";
export const U_ADMIN_SHANE = "b2000000-0000-4000-8000-000000000002";
export const U_LILI = "b3000000-0000-4000-8000-000000000003";
export const U_HOWIE = "b4000000-0000-4000-8000-000000000004";

export const tenants: Tenant[] = [
  { id: T_FTC, name: "Fund The Climb Foundation", slack_channel_id: "#fund-the-climb", created_at: now },
  { id: T_KHAI, name: "KHAI Ventures", slack_channel_id: "#khai-ventures", created_at: now },
];

export const users: AppUser[] = [
  { id: U_ADMIN_TYLER, tenant_id: null, email: "tyler@forgranted.com", full_name: "Tyler Kohrt", role: "admin", auth_id: "c1000000-0000-4000-8000-000000000001", created_at: now },
  { id: U_ADMIN_SHANE, tenant_id: null, email: "shane@forgranted.com", full_name: "Shane Winnyk", role: "admin", auth_id: "c2000000-0000-4000-8000-000000000002", created_at: now },
  { id: U_LILI, tenant_id: T_FTC, email: "lili@fundtheclimb.org", full_name: "Lili Reitz", role: "client", auth_id: "c3000000-0000-4000-8000-000000000003", created_at: now },
  { id: U_HOWIE, tenant_id: T_KHAI, email: "howie@khai.ventures", full_name: "Howie Greenman", role: "client", auth_id: "c4000000-0000-4000-8000-000000000004", created_at: now },
];

function doc(n: number, tenant_id: string, title: string, doc_kind: Document["doc_kind"], layer: Document["layer"], date: string, snippet: string, source: Document["source"] = "for_granted", status: Document["status"] = "ready"): Document {
  const id = `d${tenant_id === T_FTC ? "1" : "2"}00000${n}-0000-4000-8000-00000000000${n}`;
  return {
    id, tenant_id, title, layer, doc_kind,
    storage_key: `${tenant_id}/${id}/1`, mime_type: "application/octet-stream",
    status, error_detail: status === "failed" ? "Text extraction failed: encrypted PDF" : null,
    ocr_applied: doc_kind === "pdf", current_version: 1,
    uploaded_by: source === "client" ? (tenant_id === T_FTC ? U_LILI : U_HOWIE) : U_ADMIN_TYLER,
    source, snippet, created_at: date, updated_at: date,
  };
}

export const documents: Document[] = [
  doc(1, T_FTC, "Website — About & Programs (captured)", "web", "I", "2026-05-01", "Fund The Climb operates the Uplift Transportation program and P.L.U.S. Housing in the Franklinton neighborhood, serving people in recovery from substance use disorder."),
  doc(2, T_FTC, "IRS Form 990 (2024)", "pdf", "I", "2024-11-01", "Total revenue and functional expenses for the fiscal year, including program service accomplishments for recovery housing and transportation."),
  doc(3, T_FTC, "News coverage — Local recovery feature", "web", "I", "2026-03-01", "A local outlet profiled Basecamp Recovery Center and the foundation's transportation work removing barriers to treatment."),
  doc(4, T_FTC, "Strategic Plan 2025–2027", "docx", "II", "2025-01-15", "Three-year goals: expand Uplift rides by 40%, open a second recovery residence, and diversify funding beyond opioid settlement dollars.", "client"),
  doc(5, T_FTC, "Prior grant application — ODH SUD", "pdf", "II", "2025-06-01", "Submitted narrative describing need, target population, and the transportation-to-treatment evidence base in Franklin County.", "client"),
  doc(6, T_FTC, "Program budget — Uplift Transportation", "xlsx", "II", "2026-01-10", "Line-item budget covering drivers, vehicle leasing, fuel, and dispatch software for the ride program.", "client"),
  doc(7, T_FTC, "Interview — Lili Reitz, Executive Director", "audio", "III", "2026-04-12", "Lili describes founding the organization after seeing clients miss treatment appointments solely because they had no way to get there."),
  doc(8, T_FTC, "Interview — Peer recovery coach", "note", "III", "2026-04-20", "A coach recounts a participant who kept every appointment for the first time once transportation was guaranteed."),
  doc(9, T_FTC, "Board minutes — June (scanned)", "pdf", "II", "2026-07-28", "Processing…", "client", "processing"),
  doc(1, T_KHAI, "Company website & product pages", "web", "I", "2026-05-01", "KHAI Ventures builds nurtur, a perinatal and maternal mental health screening tool, and the PPD Screen product."),
  doc(2, T_KHAI, "Press — maternal health innovation award", "web", "I", "2026-02-01", "Coverage of recognition for early detection of perinatal mood and anxiety disorders."),
  doc(3, T_KHAI, "Pitch deck (Seed)", "pdf", "II", "2026-01-01", "Market size, the nurtur screening workflow, clinical partnerships, and the Kaleidoscope Assets fund strategy.", "client"),
  doc(4, T_KHAI, "Investor newsletter Q1", "docx", "II", "2026-04-01", "Quarterly traction: pilot sites onboarded, screening volume, and regulatory milestones.", "client"),
  doc(5, T_KHAI, "Interview — Howie Greenman, Founder", "audio", "III", "2026-03-15", "Howie explains why universal perinatal screening matters and the personal story behind the company."),
];

let tagN = 0;
function tag(document_id: string, tenant_id: string, t: string): DocumentTag {
  tagN += 1;
  return { id: `e0000000-0000-4000-8000-${String(tagN).padStart(12, "0")}`, document_id, tenant_id, tag: t };
}
const dFtc = (n: number) => documents.filter(d => d.tenant_id === T_FTC)[n - 1].id;
const dKhai = (n: number) => documents.filter(d => d.tenant_id === T_KHAI)[n - 1].id;

export const documentTags: DocumentTag[] = [
  tag(dFtc(1), T_FTC, "overview"), tag(dFtc(1), T_FTC, "programs"),
  tag(dFtc(2), T_FTC, "financials"), tag(dFtc(2), T_FTC, "990"),
  tag(dFtc(3), T_FTC, "press"), tag(dFtc(3), T_FTC, "impact"),
  tag(dFtc(4), T_FTC, "strategy"), tag(dFtc(4), T_FTC, "goals"),
  tag(dFtc(5), T_FTC, "grant"), tag(dFtc(5), T_FTC, "past-application"),
  tag(dFtc(6), T_FTC, "budget"), tag(dFtc(6), T_FTC, "transportation"),
  tag(dFtc(7), T_FTC, "leadership"), tag(dFtc(7), T_FTC, "founding-story"),
  tag(dFtc(8), T_FTC, "staff-voice"), tag(dFtc(8), T_FTC, "impact"),
  tag(dFtc(9), T_FTC, "governance"),
  tag(dKhai(1), T_KHAI, "overview"), tag(dKhai(1), T_KHAI, "product"),
  tag(dKhai(2), T_KHAI, "press"), tag(dKhai(3), T_KHAI, "fundraising"),
  tag(dKhai(4), T_KHAI, "traction"), tag(dKhai(5), T_KHAI, "leadership"),
];

export const artifactTypes: ArtifactType[] = [
  { slug: "themes", nav_label: "Themes", name: "Themes emerging from your Inven(s)tory", description: "The story threads running across every document.", prompt_ref: "prompts/themes.md", card_schema: { body: "string" }, corpus_filter: null },
  { slug: "impact_metrics", nav_label: "Impact Metrics", name: "Impact metrics your story supports", description: "Funder-ready metrics grounded in your own documents.", prompt_ref: "prompts/impact_metrics.md", card_schema: { measures: "string", why: "string", how: "string", formula: "string", example: "string", gap: "string" }, corpus_filter: null },
];

export const artifactSets: ArtifactSet[] = [
  { id: "f1000000-0000-4000-8000-000000000001", tenant_id: T_FTC, type_slug: "themes", status: "none", version: 0, generated_at: null, reviewed_by: null, model_used: null, token_cost: null, gap_note: null },
  { id: "f2000000-0000-4000-8000-000000000002", tenant_id: T_FTC, type_slug: "impact_metrics", status: "approved", version: 1, generated_at: "2026-07-20T15:00:00Z", reviewed_by: U_ADMIN_SHANE, model_used: "mock", token_cost: 0, gap_note: "Dispatch records would unlock adherence metrics. Worth capturing from August onward." },
  { id: "f3000000-0000-4000-8000-000000000003", tenant_id: T_KHAI, type_slug: "themes", status: "pending", version: 1, generated_at: "2026-07-28T12:00:00Z", reviewed_by: null, model_used: "mock", token_cost: 0, gap_note: "Layer III is sparse. Additional voices (clinicians, pilot-site staff) would deepen the human story." },
  { id: "f4000000-0000-4000-8000-000000000004", tenant_id: T_KHAI, type_slug: "impact_metrics", status: "none", version: 0, generated_at: null, reviewed_by: null, model_used: null, token_cost: null, gap_note: null },
];

export const artifactCards: ArtifactCard[] = [
  { id: "10000000-0000-4000-8000-000000000001", set_id: "f2000000-0000-4000-8000-000000000002", tenant_id: T_FTC, title: "Treatment appointment adherence rate", sort_order: 1, citations: [dFtc(6), dFtc(4), dFtc(8)],
    payload: { measures: "Share of scheduled treatment appointments actually attended by Uplift riders.", why: "Funders of SUD programs ask for retention-in-care evidence; adherence is its leading indicator.", how: "Count completed rides matched to scheduled appointments in dispatch records, monthly.", formula: "(appointments attended with Uplift ride ÷ appointments scheduled for enrolled riders) × 100", example: "Your peer coach interview describes a participant who kept every appointment for the first time once rides were guaranteed — the qualitative version of this number.", gap: "Dispatch software exports exist (budget line item) but are not yet retained month-over-month." } },
  { id: "10000000-0000-4000-8000-000000000002", set_id: "f2000000-0000-4000-8000-000000000002", tenant_id: T_FTC, title: "Cost per ride to treatment", sort_order: 2, citations: [dFtc(6), dFtc(2)],
    payload: { measures: "Fully loaded program cost divided by completed rides.", why: "Lets funders compare your efficiency to medical transport benchmarks — a number you control the narrative on.", how: "Divide the Uplift line-item budget (drivers, leasing, fuel, dispatch) by rides delivered per period.", formula: "total Uplift program cost ÷ completed rides", example: "Your 2026 budget already itemizes every cost input; only the ride count denominator is missing.", gap: "Monthly completed-ride counts need one recurring export from dispatch." } },
  { id: "10000000-0000-4000-8000-000000000003", set_id: "f3000000-0000-4000-8000-000000000003", tenant_id: T_KHAI, title: "Universal perinatal screening as the core mission", sort_order: 1, citations: [dKhai(1), dKhai(3), dKhai(5)],
    payload: { body: "The site, the seed deck, and the founder interview converge on one conviction: maternal mental health conditions are common and detectable, and screening should be universal. The mission is stated consistently across public and investor materials." } },
  { id: "10000000-0000-4000-8000-000000000004", set_id: "f3000000-0000-4000-8000-000000000003", tenant_id: T_KHAI, title: "Clinical credibility paired with a fundable market", sort_order: 2, citations: [dKhai(3), dKhai(4)],
    payload: { body: "Internal materials balance a clinical-validation narrative with market-size and traction framing, positioning the company for both non-dilutive grants and investor capital." } },
  { id: "10000000-0000-4000-8000-000000000005", set_id: "f3000000-0000-4000-8000-000000000003", tenant_id: T_KHAI, title: "A personal origin powering the vision", sort_order: 3, citations: [dKhai(5), dKhai(2)],
    payload: { body: "The founder interview supplies the human 'why' behind the product — the kind of origin story that anchors grant narratives and differentiates from competitors." } },
];
