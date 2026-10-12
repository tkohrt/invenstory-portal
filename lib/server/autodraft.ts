import "server-only";
// Auto-draft on the server (Auto-Draft patch 6; rules in lib/autodraft.ts).
//
// A plain server module: every function takes the tenant and the person, and
// is called only after the caller has decided who is asking (an admin action
// or route, or a signed continuation of a run an admin started). Reads and
// writes go through the service client, each scoped by tenant, because a
// whole-draft run carries on on the server with no session.
//
// For Granted's spend: every model call is metered as feature "autodraft",
// actor admin, never the client's (spec section 11).
import { db } from "./db";
import { chatComplete } from "./llm";
import { withAiUsage } from "./ai-usage";
import { BLOCK_COLS, loadCards, resolveBlocks, type WsCard } from "./workspace";
import { currentVoiceSources, voiceProfileText } from "./voice-sources";
import { CARD_KIND_MAP } from "@/lib/story-card";
import { arrangeBudget, arrangePicks, rankCards, type Ranked } from "@/lib/story-card-rank";
import { LOCKED_STATUSES, type DraftStatus } from "@/lib/draft-version";
import { placeIssue } from "@/lib/card-gate";
import { MINIMUM_MESSAGE, minimumMet } from "@/lib/voice-profile";
import { contextNotes, type ContextPart } from "@/lib/draft-context";
import {
  ARRANGE_SYSTEM, arrangeUser, fitToBudget, keepPieces, parseArrangeReply, planRun, shortlist, words,
  type PlanSection, type RunPlan, type Start,
} from "@/lib/autodraft";

// ---------------------------------------------------------------------------
// Before a run: what it would touch, and whether it may start.
// ---------------------------------------------------------------------------

export interface AutodraftPreview {
  draftId: string;
  title: string;
  purpose: "application" | "standard_answers";
  plan: RunPlan;
  /** Questions that will start from an approved Standard Answer (no model call). */
  fromStandard: number;
  /** Questions the model will arrange: one model call each. */
  toArrange: number;
  minimum: { met: boolean; message: string };
  context: { funder: "missing" | null; client: "missing" | null };
  /** The draft has been auto-drafted before. */
  autoDrafted: boolean;
  /** The question prompt for each planned or skipped question, for the window. */
  prompts: Record<string, { n: number; prompt: string }>;
}

interface DraftRow { id: string; title: string; status: string; purpose: string; mode: string; source_text: string | null; auto_drafted_at?: string | null }

async function draftRow(tenantId: string, draftId: string): Promise<DraftRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) return null;
  // Every column (not a list), so auto_drafted_at (0064) is read if present.
  const { data } = await db.from("grant_draft").select("*").eq("tenant_id", tenantId).eq("id", draftId).maybeSingle();
  const d = data as DraftRow | null;
  return d && d.mode === "cards" ? d : null;
}

/** What a run would do, or why it cannot start. */
export async function autodraftPreview(tenantId: string, draftId: string, only?: string | null): Promise<AutodraftPreview | { error: string }> {
  const d = await draftRow(tenantId, draftId);
  if (!d) return { error: "That draft could not be found." };
  if (LOCKED_STATUSES.has(d.status as DraftStatus)) return { error: "This application is locked, so it cannot be auto-drafted. Start a new version from it first." };
  const purpose = d.purpose === "standard_answers" ? "standard_answers" : "application";

  const [{ data: secs }, { data: answers }, { data: ctx }, sources] = await Promise.all([
    db.from("draft_section").select("id, sort_order, prompt, status, question_slugs").eq("tenant_id", tenantId).eq("draft_id", draftId).order("sort_order"),
    db.from("answer").select("draft_section_id, status, question:question_id(slug)").eq("tenant_id", tenantId).eq("status", "published").not("draft_section_id", "is", null),
    db.from("draft_context").select("part").eq("tenant_id", tenantId).eq("draft_id", draftId),
    currentVoiceSources(tenantId),
  ]);
  const sections = (secs ?? []) as { id: string; sort_order: number; prompt: string; status: string; question_slugs: string[] }[];
  if (only && !sections.some(s => s.id === only)) return { error: "That question is not in this draft." };
  const ids = sections.map(s => s.id);
  const { data: blocks } = ids.length
    ? await db.from("section_block").select("section_id, proposed").eq("tenant_id", tenantId).in("section_id", ids)
    : { data: [] };
  const pieces = new Map<string, number>();
  for (const b of (blocks ?? []) as { section_id: string; proposed: boolean | null }[]) {
    if (!b.proposed) pieces.set(b.section_id, (pieces.get(b.section_id) ?? 0) + 1);
  }
  const published = (answers ?? []) as unknown as { draft_section_id: string; question: { slug: string } | null }[];
  const approvedSections = new Set(published.map(a => a.draft_section_id));
  const stdBySlug = new Map(published.filter(a => a.question?.slug).map(a => [a.question!.slug, a.draft_section_id]));

  const planSections: PlanSection[] = sections.map(s => ({
    id: s.id, status: s.status, pieces: pieces.get(s.id) ?? 0,
    approved: approvedSections.has(s.id),
    standardAnswerSectionId: s.question_slugs?.[0] ? stdBySlug.get(s.question_slugs[0]) ?? null : null,
  }));
  const plan = planRun({ purpose, sections: planSections, only });
  // When auto-drafting the Standard Answers draft itself, its approved questions are sources for the rest.
  const met = minimumMet(sources);
  return {
    draftId, title: d.title, purpose, plan,
    fromStandard: plan.run.filter(r => r.start === "standard_answer").length,
    toArrange: plan.run.filter(r => r.start === "arrange").length,
    minimum: { met, message: MINIMUM_MESSAGE },
    context: contextNotes(((ctx ?? []) as { part: ContextPart }[]).map(c => ({ part: c.part }))),
    autoDrafted: !!d.auto_drafted_at,
    prompts: Object.fromEntries(sections.map((s, i) => [s.id, { n: i + 1, prompt: s.prompt }])),
  };
}

// ---------------------------------------------------------------------------
// One run's shared inputs.
// ---------------------------------------------------------------------------

export interface RunCtx {
  tenantId: string;
  userId: string | null;
  draftId: string;
  /** Every card already placed anywhere in this draft, kept up to date as the run places more. */
  usedInDraft: Set<string>;
  cards: WsCard[];
  voice: string;
  funderContext: string;
  clientContext: string;
  application: string;
}

export async function loadRunCtx(tenantId: string, userId: string | null, draftId: string): Promise<RunCtx> {
  const d = await draftRow(tenantId, draftId);
  if (!d) throw new Error("That draft could not be found.");
  if (LOCKED_STATUSES.has(d.status as DraftStatus)) throw new Error("This application is locked, so auto-draft placed nothing more.");
  const [{ data: secs }, cards, voice, { data: ctx }] = await Promise.all([
    db.from("draft_section").select("id").eq("tenant_id", tenantId).eq("draft_id", draftId),
    loadCards(tenantId, db),
    voiceProfileText(tenantId),
    db.from("draft_context").select("part, title, body").eq("tenant_id", tenantId).eq("draft_id", draftId).order("added_at"),
  ]);
  const ids = ((secs ?? []) as { id: string }[]).map(s => s.id);
  const { data: used } = ids.length
    ? await db.from("section_block").select("card_id").eq("tenant_id", tenantId).in("section_id", ids).not("card_id", "is", null)
    : { data: [] };
  const items = (ctx ?? []) as { part: ContextPart; title: string; body: string }[];
  const join = (part: ContextPart) => items.filter(i => i.part === part).map(i => `${i.title}:\n${i.body}`).join("\n\n");
  return {
    tenantId, userId, draftId,
    usedInDraft: new Set(((used ?? []) as { card_id: string }[]).map(r => r.card_id)),
    cards, voice, funderContext: join("funder"), clientContext: join("client"), application: d.source_text ?? "",
  };
}

// ---------------------------------------------------------------------------
// One question.
// ---------------------------------------------------------------------------

export interface SectionOutcome {
  sectionId: string;
  start: Start;
  /** Cards (or, from a Standard Answer, pieces) placed by this run. */
  placed: number;
  /** The model's reply could not be used, so the code's own pick was placed. */
  fallback: boolean;
  /** Pieces of the Standard Answer left out because their card has been retired. */
  leftOut: number;
  /** Wanted kinds still not in the answer: gaps for Add it now or Ask the client. */
  gaps: number;
  error?: string;
}

type Ev = { card_id: string | null; block_id: string | null; position?: number | null; rank_score?: number | null; via: string };

async function logAdded(ctx: RunCtx, sectionId: string, evs: Ev[]) {
  if (!evs.length) return;
  const { error } = await db.from("card_event").insert(evs.map(e => ({  // tenant-safe: every row carries tenant_id from the run
    tenant_id: ctx.tenantId, draft_id: ctx.draftId, section_id: sectionId, card_id: e.card_id, block_id: e.block_id,
    event: "added", position: e.position ?? null, rank_score: e.rank_score ?? null,
    actor: ctx.userId, actor_role: "admin", payload: { via: e.via },
  })));
  if (error) console.error(`[autodraft] card_event insert failed: ${error.message}`);
}

async function settle(tenantId: string, sectionId: string, status: string, count: number) {
  if (status === "empty" && count > 0) {
    await db.from("draft_section").update({ status: "drafting", updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", sectionId);
  }
}

/**
 * Auto-draft one question: start it from its Standard Answer, or arrange cards
 * after what it already holds. Never moves or removes anything already there.
 */
export async function autodraftSection(ctx: RunCtx, sectionId: string, start: Start): Promise<SectionOutcome> {
  const out: SectionOutcome = { sectionId, start, placed: 0, fallback: false, leftOut: 0, gaps: 0 };
  const { data: sec } = await db.from("draft_section")
    .select("id, draft_id, status, prompt, guidance, wanted_kinds, limit_value, limit_unit, question_slugs")
    .eq("tenant_id", ctx.tenantId).eq("id", sectionId).maybeSingle();
  const section = sec as { id: string; draft_id: string; status: string; prompt: string; guidance: string | null; wanted_kinds: string[] | null; limit_value: number | null; limit_unit: "words" | "characters" | null; question_slugs: string[] | null } | null;
  if (!section || section.draft_id !== ctx.draftId) return { ...out, error: "That question is not in this draft." };
  if (section.status === "done") return out;
  const { data: rowData } = await db.from("section_block").select(BLOCK_COLS).eq("tenant_id", ctx.tenantId).eq("section_id", sectionId).order("sort_order");
  const rows = (rowData ?? []) as Record<string, unknown>[];
  const wanted = section.wanted_kinds ?? [];
  const cardKind = new Map(ctx.cards.map(c => [c.id, c.kind]));
  const gapsAfter = (cardIds: string[]) => wanted.filter(k => !cardIds.some(id => cardKind.get(id) === k)).length;

  // Step 1: an empty answer with an approved Standard Answer starts from it, whole.
  if (start === "standard_answer" && rows.filter(r => !r.proposed).length === 0) {
    const slug = section.question_slugs?.[0];
    const { data: q } = slug ? await db.from("grant_question").select("id").eq("slug", slug).maybeSingle() : { data: null };
    const { data: ans } = q
      ? await db.from("answer").select("draft_section_id, status").eq("tenant_id", ctx.tenantId).eq("question_id", (q as { id: string }).id).maybeSingle()
      : { data: null };
    const from = (ans as { draft_section_id: string | null; status: string } | null);
    if (from?.status === "published" && from.draft_section_id) {
      const { data: srcData } = await db.from("section_block").select(BLOCK_COLS).eq("tenant_id", ctx.tenantId).eq("section_id", from.draft_section_id).order("sort_order");
      // A bridge nobody accepted is not part of the Standard Answer; a retired card cannot come back.
      const live = new Map(ctx.cards.map(c => [c.id, c]));
      const source = ((srcData ?? []) as Record<string, unknown>[]).filter(b => !b.proposed);
      const marks = source.map(b => ({
        kind: b.kind as string, breakBefore: !!b.break_before,
        drop: b.kind === "card" && !!b.card_id && placeIssue(live.get(b.card_id as string) ?? null) === "retired",
      }));
      const keepAt = keepPieces(marks);
      const keep: Record<string, unknown>[] = keepAt.map(k => ({ ...source[k.index], break_before: k.breakBefore }));
      // Retired cards left out; bridges beside them go too, but are not counted.
      out.leftOut = marks.filter(m => m.drop).length;
      if (keep.length) {
        const { data: ins, error } = await db.from("section_block").insert(keep.map((b, i) => ({  // tenant-safe: every row carries tenant_id from the run
          tenant_id: ctx.tenantId, section_id: sectionId, sort_order: i, kind: b.kind,
          card_id: b.card_id ?? null, card_version: b.card_version ?? null, text: b.text ?? null,
          edited: !!b.edited, break_before: !!b.break_before, created_by: ctx.userId,
        }))).select("id, card_id");
        if (error) return { ...out, error: `Could not copy the Standard Answer: ${error.message}` };
        const placedCards = ((ins ?? []) as { id: string; card_id: string | null }[]).filter(b => b.card_id);
        await logAdded(ctx, sectionId, placedCards.map(b => ({ card_id: b.card_id, block_id: b.id, via: "autodraft_standard_answer" })));
        for (const b of placedCards) ctx.usedInDraft.add(b.card_id as string);
        out.placed = keep.length;
        await settle(ctx.tenantId, sectionId, section.status, keep.length);
        out.gaps = gapsAfter(placedCards.map(b => b.card_id as string));
        return out;
      }
    }
    // No usable Standard Answer after all: arrange instead.
    out.start = "arrange";
  }

  // Step 2: arrange cards after what the answer already holds.
  const existing = (await resolveBlocks(ctx.tenantId, rows, db)).filter(b => !b.proposed && b.text.trim());
  const inAnswer = new Set(rows.filter(r => r.card_id).map(r => r.card_id as string));
  const layerOf = new Map(ctx.cards.map(c => [c.id, c.layer]));
  const ranked = rankCards(ctx.cards, {
    prompt: section.prompt, guidance: section.guidance, wantedKinds: wanted, slugs: section.question_slugs ?? [],
  }, { now: new Date(), usedElsewhere: ctx.usedInDraft, inSection: inAnswer, sectionHasVoice: [...inAnswer].some(id => layerOf.get(id) === "III") });
  const offered = shortlist(ranked, { wantedKinds: wanted, inAnswer, usedInDraft: ctx.usedInDraft });
  if (!offered.length) { out.gaps = gapsAfter([...inAnswer]); return out; }

  const budget = arrangeBudget(section.limit_value, section.limit_unit);
  const byId = new Map(ctx.cards.map(c => [c.id, c]));
  const user = arrangeUser({
    question: section.prompt, guidance: section.guidance, limit: { value: section.limit_value, unit: section.limit_unit },
    budgetWords: budget, wantedKindLabels: wanted.map(k => CARD_KIND_MAP[k]?.label ?? k),
    existing: existing.map(b => b.text), voiceProfile: ctx.voice, application: ctx.application,
    funderContext: ctx.funderContext, clientContext: ctx.clientContext,
    cards: offered.map((r, i) => ({
      n: i + 1, kindLabel: CARD_KIND_MAP[r.card.kind]?.label ?? r.card.kind, layer: r.card.layer,
      words: words(r.card.statement), text: r.card.statement,
    })),
  });
  let chosen: Ranked[] = [];
  let breaks = new Set<string>();
  const res = await withAiUsage({ tenantId: ctx.tenantId, userId: ctx.userId, actor: "admin", feature: "autodraft" },
    () => chatComplete({ system: ARRANGE_SYSTEM, user, maxTokens: 300, temperature: 0 })).catch(() => null);
  const reply = res ? parseArrangeReply(res.text, offered.length, { followsExisting: existing.length > 0 }) : null;
  if (reply) {
    chosen = reply.order.map(n => offered[n - 1]);
    breaks = new Set(reply.breaksBefore.map(n => offered[n - 1].card.id));
  } else {
    if (res) console.error(`[autodraft] reply not usable: ${res.text.slice(0, 300)}`);
    // The code's own pick, from the same shortlist, with the gate lifted (a retired card is never offered).
    chosen = arrangePicks(offered, wanted, budget, () => true);
    // No card of a wanted kind on the shortlist: take the shortlist in rank order instead.
    if (!chosen.length) chosen = offered;
    out.fallback = true;
  }
  const existingWords = existing.reduce((n, b) => n + words(b.text), 0);
  chosen = chosen.slice(0, fitToBudget(chosen.map(r => words(r.card.statement)), existingWords, budget));
  if (!chosen.length) { out.gaps = gapsAfter([...inAnswer]); return out; }

  // After the largest position in use, whatever gaps the stored order may have.
  const after = rows.reduce((m, r) => Math.max(m, Number(r.sort_order ?? -1)), -1) + 1;
  const { data: ins, error } = await db.from("section_block").insert(chosen.map((r, i) => ({  // tenant-safe: every row carries tenant_id from the run
    tenant_id: ctx.tenantId, section_id: sectionId, sort_order: after + i, kind: "card",
    card_id: r.card.id, card_version: byId.get(r.card.id)?.version ?? 1,
    break_before: breaks.has(r.card.id),
    created_by: ctx.userId,
  }))).select("id, card_id");
  if (error) return { ...out, error: `Could not place the cards: ${error.message}` };
  const blockOf = new Map(((ins ?? []) as { id: string; card_id: string }[]).map(b => [b.card_id, b.id]));
  await logAdded(ctx, sectionId, chosen.map(r => ({
    card_id: r.card.id, block_id: blockOf.get(r.card.id) ?? null, position: r.position, rank_score: r.score,
    via: out.fallback ? "autodraft_code_pick" : "autodraft",
  })));
  for (const r of chosen) ctx.usedInDraft.add(r.card.id);
  out.placed = chosen.length;
  await settle(ctx.tenantId, sectionId, section.status, rows.length + chosen.length);
  out.gaps = gapsAfter([...inAnswer, ...chosen.map(r => r.card.id)]);
  return out;
}

/** Mark the draft auto-drafted (the gate change, spec section 5). Before 0064 it is a quiet no-op. */
export async function markAutoDrafted(tenantId: string, draftId: string): Promise<void> {
  const { error } = await db.from("grant_draft").update({ auto_drafted_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", draftId).is("auto_drafted_at", null);
  if (error) console.error(`[autodraft] could not mark the draft: ${error.message}`);
}

/** Whether a draft has been auto-drafted: false before 0064 or for a draft never auto-drafted. */
export async function isAutoDrafted(tenantId: string, draftId: string): Promise<boolean> {
  const d = await draftRow(tenantId, draftId);
  return !!d?.auto_drafted_at;
}
