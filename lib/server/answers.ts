import "server-only";
// Answer Library generation (A3 scaffold). For each active question matching the
// tenant's audience, retrieve the tenant's most relevant passages and compose a
// short + long answer, a completeness flag, a robustness score, and citations.
// Uses the same retrieval + generation path as chat: Bedrock when available,
// honest extractive fallback while the quota is blocked. Human-edited answers are
// never overwritten by (re)generation.
import { db } from "./db";
import { retrieve, generate, type Passage } from "./rag";
import { refineExtractive } from "./refine";
import { generationConfigured } from "./llm";
import type { Audience, Completeness } from "@/lib/types";

const WORDS = (s: string, n: number) => s.split(/\s+/).slice(0, n).join(" ");

function scoreCompleteness(passages: Passage[]): { completeness: Completeness; robustness: number } {
  const strong = passages.filter(p => (p.score ?? 0) > 0.3).length;
  if (passages.length === 0) return { completeness: "missing", robustness: 0 };
  if (passages.length >= 3 && strong >= 2) return { completeness: "strong", robustness: 75 };
  if (passages.length >= 1) return { completeness: "partial", robustness: 45 };
  return { completeness: "missing", robustness: 0 };
}

export interface GenSummary { generated: number; skipped_human: number; strong: number; partial: number; missing: number }

export async function generateAnswers(tenantId: string, orgType: "nonprofit" | "startup" | null): Promise<GenSummary> {
  const audiences: Audience[] = ["both", (orgType ?? "nonprofit")];
  const { data: questions } = await db.from("grant_question")
    .select("id, prompt_text, guidance").eq("active", true).in("audience", audiences).order("sort_order");

  // Existing answers: skip regenerating anything a human has edited/reviewed.
  const { data: existing } = await db.from("answer").select("question_id, source").eq("tenant_id", tenantId);
  const humanLocked = new Set((existing ?? []).filter(a => a.source === "human").map(a => a.question_id));

  const summary: GenSummary = { generated: 0, skipped_human: 0, strong: 0, partial: 0, missing: 0 };

  for (const q of (questions ?? []) as { id: string; prompt_text: string; guidance: string | null }[]) {
    if (humanLocked.has(q.id)) { summary.skipped_human++; continue; }
    const query = [q.prompt_text, q.guidance ?? ""].join(" ").trim();
    const { passages } = await retrieve(query, 6, tenantId);
    const { completeness, robustness } = scoreCompleteness(passages);

    let short: string | null = null, long: string | null = null;
    let completenessOverride: Completeness | null = null, robustnessOverride: number | null = null;
    const citeDocs = [...new Set(passages.map(p => p.document_id))];
    if (passages.length > 0) {
      if (generationConfigured()) {
        // Generative prose when Bedrock is available.
        const ans = await generate(q.prompt_text, passages);
        long = WORDS(ans.content, 260);
        short = WORDS(ans.content, 55);
      } else {
        // No generative model: embedding-ranked, cleaned extractive refinement
        // (Supabase gte-small). Falls back to the raw digest if refinement fails.
        const refined = await refineExtractive([q.prompt_text, q.guidance ?? ""].join(" ").trim(), passages);
        if (refined && (refined.short || refined.long)) {
          short = refined.short ?? refined.long;
          long = refined.long ?? refined.short;
          if (refined.topScore >= 0.5 && refined.nGood >= 3) { completenessOverride = "strong"; robustnessOverride = 78; }
          else if (refined.topScore >= 0.35 || refined.nGood >= 1) { completenessOverride = "partial"; robustnessOverride = 52; }
          else { completenessOverride = "partial"; robustnessOverride = 40; }
        } else {
          const ans = await generate(q.prompt_text, passages);
          long = WORDS(ans.content, 260);
          short = WORDS(passages[0].text, 55);
        }
      }
    }

    // Upsert the answer row.
    const { data: row } = await db.from("answer").upsert({
      tenant_id: tenantId, question_id: q.id, short_answer: short, long_answer: long,
      completeness: completenessOverride ?? completeness, robustness_score: robustnessOverride ?? robustness, source: "auto", status: "draft",
      stale: false, updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,question_id" }).select("id").single();

    if (row) {
      await db.from("answer_citation").delete().eq("answer_id", row.id);
      if (citeDocs.length) {
        await db.from("answer_citation").insert(citeDocs.map(d => ({
          answer_id: row.id, tenant_id: tenantId, document_id: d,
        })));
      }
      await db.from("answer_event").insert({ tenant_id: tenantId, question_id: q.id, kind: "auto_generated" });
    }
    summary.generated++; summary[(completenessOverride ?? completeness)]++;
  }
  await db.from("audit_log").insert({ tenant_id: tenantId, action: "answers_generate",
    detail: `generated=${summary.generated} strong=${summary.strong} partial=${summary.partial} missing=${summary.missing}` });
  return summary;
}
