import "server-only";
import { db } from "./db";
import { chatComplete, generationConfigured } from "./llm";
import type { Gap } from "@/lib/eligibility-fields";

// The content areas a fundable inventory should cover, with tiers.
const CONTENT_AREAS: { key: string; tier: "yellow" | "low"; label: string; layer: "I" | "II" | "III" }[] = [
  { key: "financials_budget", tier: "yellow", label: "No budget or financials found — most funders require them.", layer: "II" },
  { key: "outcomes_evaluation", tier: "yellow", label: "Little on outcomes or evaluation — funders ask how you measure impact.", layer: "II" },
  { key: "board_governance", tier: "yellow", label: "No board or governance information found.", layer: "II" },
  { key: "leadership_team", tier: "low", label: "Add background on your leadership and team.", layer: "II" },
  { key: "sustainability", tier: "low", label: "Nothing on how the work is sustained beyond a grant.", layer: "III" },
  { key: "theory_of_change", tier: "low", label: "No theory of change / logic model captured.", layer: "III" },
  { key: "past_grants", tier: "low", label: "No past grant applications — uploading them enriches your profile.", layer: "III" },
];

// Bedrock pass: assess which content areas the inventory covers. Cached.
export async function analyzeContentGaps(tenantId: string): Promise<Gap[]> {
  const [{ data: docs }, { data: chunks }] = await Promise.all([
    db.from("document").select("title, layer").eq("tenant_id", tenantId).eq("status", "ready"),
    db.from("document_chunk").select("text").eq("tenant_id", tenantId).limit(24),
  ]);
  const D = docs ?? [];
  if (D.length === 0) {
    // Empty inventory: every content area is a gap.
    return CONTENT_AREAS.map(a => ({ tier: a.tier, key: a.key, label: a.label, fix: "upload" as const, layer: a.layer }));
  }
  if (!generationConfigured()) return []; // no model → skip content gaps (structural still shown)

  const digest =
    "DOCUMENTS:\n" + D.map(d => `- [L${d.layer}] ${d.title}`).join("\n") +
    "\n\nCONTENT SAMPLE:\n" + (chunks ?? []).map(c => (c.text ?? "").slice(0, 200)).join("\n---\n").slice(0, 6000);
  const areas = CONTENT_AREAS.map(a => a.key).join(", ");
  const res = await chatComplete({
    system: "You assess whether a nonprofit/startup's document inventory covers key fundability areas. " +
      "Return STRICT JSON only: an object mapping each area to true (clearly covered) or false (missing/weak). " +
      "Areas: " + areas + ". Be strict — mark true only if the documents actually contain that information.",
    user: digest,
    maxTokens: 400, temperature: 0,
  });
  if (!res) return [];
  let cov: Record<string, boolean> = {};
  try { const m = res.text.match(/\{[\s\S]*\}/); if (m) cov = JSON.parse(m[0]); } catch { return []; }
  return CONTENT_AREAS.filter(a => cov[a.key] === false)
    .map(a => ({ tier: a.tier, key: a.key, label: a.label, fix: "upload" as const, layer: a.layer }));
}

export async function getContentGaps(tenantId: string): Promise<{ gaps: Gap[]; computedAt: string | null }> {
  const { data } = await db.from("eligibility_gap").select("content_gaps, computed_at").eq("tenant_id", tenantId).maybeSingle();
  return { gaps: (data?.content_gaps ?? []) as Gap[], computedAt: data?.computed_at ?? null };
}
