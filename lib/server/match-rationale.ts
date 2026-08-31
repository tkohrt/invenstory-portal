import "server-only";
// Why the portal thinks a client fits an opportunity.
//
// The rule this module exists to enforce: the explanation must be grounded in
// things that actually exist — fields the client filled in on their eligibility
// profile, and documents that are actually in their Inven(s)tory. It must never
// invent a document, a programme, or a capability. That is the same standard
// the readiness grader is held to, and it matters more here, because this text
// is what a person will act on when deciding whether to spend a week writing an
// application.
import { getContentCoverage } from "./gap-agent";
import { chatComplete, generationConfigured } from "./llm";
import { checklistFor } from "@/lib/checklist";
import { ORG_TYPES, BUDGET_BANDS, type EligibilityProfile } from "@/lib/eligibility-fields";
import type { ScreenedGrant } from "@/lib/grant-screen";

export interface Dossier {
  profileLines: string[];
  evidence: { item: string; docTitle: string; quote?: string }[];
  docTitles: string[];
}

/** Everything the portal actually knows about this client, in citable form. */
export async function buildDossier(tenantId: string, orgName: string, p: EligibilityProfile): Promise<Dossier> {
  const { cov } = await getContentCoverage(tenantId);
  const labelFor = new Map(checklistFor(p.org_type).map(i => [i.key, i.label]));

  const evidence: Dossier["evidence"] = [];
  for (const [key, c] of Object.entries(cov)) {
    if (c.state === "missing") continue;
    for (const src of c.sources ?? []) {
      if (!src.title) continue;
      evidence.push({ item: labelFor.get(key) ?? key, docTitle: src.title, quote: src.quote });
    }
  }

  const profileLines = [
    `Organization: ${orgName}`,
    `Type: ${ORG_TYPES.find(t => t.v === p.org_type)?.l ?? "unspecified"}`,
    p.tax_status ? `Tax status: ${p.tax_status}` : null,
    p.state_code ? `Based in: ${p.state_code}` : null,
    p.service_area.length ? `Serves: ${p.service_area.join(", ")}` : null,
    p.budget_band ? `Budget band: ${BUDGET_BANDS.find(b => b.v === p.budget_band)?.l ?? p.budget_band}` : null,
    p.cause_areas.length ? `Cause areas: ${p.cause_areas.join(", ")}` : null,
    p.populations.length ? `Populations served: ${p.populations.join(", ")}` : null,
    `Federal registration: ${p.federal_registration === "sam_uei_active" ? "SAM.gov/UEI active" : "not registered"}`,
    p.match_capacity_pct != null ? `Cost-match capacity: up to ${p.match_capacity_pct}%` : null,
  ].filter(Boolean) as string[];

  return { profileLines, evidence, docTitles: [...new Set(evidence.map(e => e.docTitle))] };
}

const SYSTEM = `You explain, for a grants consultancy, why a specific funding opportunity may fit a specific client.

You are given (a) the client's eligibility profile, (b) evidence drawn from their Inven(s)tory of documents, and (c) one opportunity.

Write 1-3 sentences of plain prose. Rules, in order of importance:
1. Ground every claim. Cite eligibility-profile facts by their value ("Ohio-based", "for-profit", "no SAM.gov registration") and cite Inven(s)tory documents by their EXACT title in double quotes.
2. NEVER invent a document title, a programme, a figure or a capability. Only cite titles from the supplied list. If the Inven(s)tory has nothing relevant, say so plainly: the alignment is on profile alone and the Inven(s)tory does not yet evidence it.
3. Say what does NOT fit as readily as what does. A blocker (wrong org type, missing registration, cost-match requirement) is the most useful thing you can surface.
4. No hype, no marketing language, no "this is a great opportunity". No em dashes.
5. This data is a June 2026 snapshot. Never state a deadline or an award amount as settled fact.

Return ONLY a JSON array, one object per opportunity, in the order given:
[{"i": 0, "why": "..."}]`;

function ruleBased(g: ScreenedGrant, p: EligibilityProfile, orgName: string): string {
  const bits: string[] = [];
  const type = ORG_TYPES.find(t => t.v === p.org_type)?.l?.toLowerCase();
  if (type) bits.push(`${orgName} is a ${type}`);
  if (p.cause_areas.length) bits.push(`working on ${p.cause_areas.join(", ")}`);
  if (p.state_code) bits.push(`based in ${p.state_code}`);
  const base = bits.length ? bits.join(", ") + "." : "";
  return `${base} ${g.reason}. Eligibility text needs a human read at the source.`.trim();
}

/**
 * Generate one rationale per screened grant, in place.
 *
 * A cited document title that isn't in the Inven(s)tory is treated as a
 * fabrication and the whole rationale is discarded for the rule-based fallback.
 * Better a thin true sentence than a rich invented one.
 */
export async function addRationales(
  grants: ScreenedGrant[], dossier: Dossier, p: EligibilityProfile, orgName: string,
): Promise<void> {
  if (!grants.length) return;
  if (!generationConfigured()) {
    // Worth being loud about. A run where every explanation is the fallback
    // looks like a weak model rather than an unconfigured one, and that
    // misdiagnosis costs more than the log line.
    console.warn("[match] no generation provider configured — every rationale will be rule-based. "
      + "Check LLM credentials are scoped to this environment, not Production only.");
    grants.forEach(g => { g.rationale = ruleBased(g, p, orgName); });
    return;
  }

  const evidenceBlock = dossier.evidence.slice(0, 40)
    .map(e => `- [${e.item}] from "${e.docTitle}"${e.quote ? `: "${e.quote.slice(0, 240)}"` : ""}`)
    .join("\n") || "(no Inven(s)tory evidence available)";

  const opportunities = grants.map((g, i) => [
    `#${i} ${g.title}`,
    g.funder ? `  Funder/source: ${g.funder}` : null,
    g.close_date ? `  Deadline: ${g.close_date}` : `  Deadline: rolling or unlisted`,
    g.award_ceiling ? `  Award ceiling: ${g.award_ceiling}` : null,
    g.eligibility ? `  Eligibility (AI-extracted, unverified): ${g.eligibility.slice(0, 500)}` : null,
    `  Rule-based screen said: ${g.reason}`,
  ].filter(Boolean).join("\n")).join("\n\n");

  const user = `CLIENT ELIGIBILITY PROFILE
${dossier.profileLines.join("\n")}

INVEN(S)TORY EVIDENCE (cite these titles exactly, and only these)
${evidenceBlock}

DOCUMENT TITLES YOU MAY CITE
${dossier.docTitles.length ? dossier.docTitles.map(t => `"${t}"`).join("\n") : "(none)"}

OPPORTUNITIES
${opportunities}`;

  const res = await chatComplete({ system: SYSTEM, user, maxTokens: 2400, temperature: 0.2 });
  if (!res?.text) {
    console.warn("[match] generation returned nothing; falling back to rule-based rationales");
    grants.forEach(g => { g.rationale = ruleBased(g, p, orgName); });
    return;
  }

  let parsed: { i: number; why: string }[] = [];
  try {
    const m = res.text.match(/\[[\s\S]*\]/);
    parsed = m ? JSON.parse(m[0]) : [];
  } catch { parsed = []; }

  const allowed = dossier.docTitles.map(t => t.toLowerCase());
  for (const g of grants) g.rationale = undefined;
  for (const row of parsed) {
    const g = grants[row.i];
    if (!g || typeof row.why !== "string") continue;
    // Any quoted string that looks like a document citation must be real.
    const cited = [...row.why.matchAll(/"([^"]{4,120})"/g)].map(m => m[1].toLowerCase());
    const fabricated = cited.some(c => !allowed.some(t => t.includes(c) || c.includes(t)));
    g.rationale = fabricated ? ruleBased(g, p, orgName) : row.why.trim();
  }
  for (const g of grants) if (!g.rationale) g.rationale = ruleBased(g, p, orgName);
}
