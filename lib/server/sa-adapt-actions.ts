"use server";
// The three choices on a Standard Answer that auto-draft adapted for this
// funder (Auto-Draft patch 7, spec section 4b; rules in lib/sa-adapt.ts):
//   Keep for this grant only           the change stays here; the Standard Answer is unchanged
//   Also update the Standard Answer    this answer is copied into Standard Answers as that
//                                      question's new working version, unapproved until a
//                                      person approves it; until then the old approved
//                                      answer stays in use (answer.approved_blocks)
//   Go back to the Standard Answer     the Standard Answer as it was copied in is restored,
//                                      through the page's Undo
// Each is logged in card_event. For Granted only, like the rest of the drafter.
// EVERY export of a "use server" module is a public endpoint: the tenant and
// the person come from the session, and every row is checked against them.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { BLOCK_COLS, resolveBlocks, type WsBlock } from "./workspace";
import { assembleAnswer } from "@/lib/section-answer";
import { restoreAnswerAction } from "./workspace-actions";
import { saveVersionAction } from "./version-actions";
import { LOCKED_STATUSES, type DraftStatus } from "@/lib/draft-version";
import { adaptationLive, adaptationOpen, parseAdaptation, type AdaptState, type SaAdaptation } from "@/lib/sa-adapt";
import { approvedSnapshot } from "./standard-blocks";
import { randomUUID } from "node:crypto";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

interface Loaded {
  tenantId: string; userId: string;
  section: { id: string; draft_id: string; prompt: string; slug: string | null };
  draft: { id: string; title: string; status: string; purpose: string };
  /** The record as stored, which the claim below must still find. */
  record: SaAdaptation;
  /** Its state as the page sees it: "reverted" with the adapted pieces back (Undo) is open again. */
  state: AdaptState;
}

const ALREADY = "That choice has already been made for this answer. Reload the page to see it.";

/** The question, its draft and its adaptation, checked against this session; and that a choice is still open. */
async function load(sectionId: string, allowed: AdaptState[]): Promise<Result<Loaded>> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "For Granted only." };
  if (!/^[0-9a-f-]{36}$/i.test(sectionId)) return { ok: false, error: "That question could not be found." };
  const { data } = await db.from("draft_section").select("*, grant_draft!inner(id, title, status, purpose, mode)")
    .eq("tenant_id", s.tenantId).eq("id", sectionId).maybeSingle();
  const row = data as (Record<string, unknown> & { grant_draft: Loaded["draft"] & { mode: string } }) | null;
  if (!row || row.grant_draft.mode !== "cards") return { ok: false, error: "That question could not be found." };
  if (LOCKED_STATUSES.has(row.grant_draft.status as DraftStatus)) {
    return { ok: false, error: "This application has been submitted, so it is locked." };
  }
  const record = parseAdaptation(row.sa_adaptation);
  if (!record) return { ok: false, error: "This answer was not adapted from a Standard Answer." };
  const { data: pieces, error: pErr } = await db.from("section_block").select("id, proposed")
    .eq("tenant_id", s.tenantId).eq("section_id", sectionId);
  if (pErr) return { ok: false, error: `Could not read this answer: ${pErr.message}` };
  const ids = ((pieces ?? []) as { id: string; proposed: boolean | null }[]).filter(b => !b.proposed).map(b => b.id);
  if (!adaptationLive(record, ids)) {
    return { ok: false, error: "This answer no longer holds what auto-draft placed, so there is no choice to make. Reload the page." };
  }
  const state: AdaptState = adaptationOpen(record, ids) ? "open" : record.state;
  if (!allowed.includes(state)) return { ok: false, error: ALREADY };
  const slugs = row.question_slugs as string[] | null;
  return {
    ok: true, tenantId: s.tenantId, userId: s.user.id,
    section: { id: row.id as string, draft_id: row.draft_id as string, prompt: row.prompt as string, slug: slugs?.[0] ?? null },
    draft: row.grant_draft, record, state,
  };
}

/**
 * Claim the choice: the record moves to `state` only if it still stands as it
 * was loaded, so two people (or two tabs) choosing at once cannot both win.
 * False when someone else got there first.
 */
async function claim(l: Loaded, state: AdaptState): Promise<boolean> {
  const record: SaAdaptation = { ...l.record, state, decidedAt: new Date().toISOString(), decidedBy: l.userId };
  const { data, error } = await db.from("draft_section").update({ sa_adaptation: record })
    .eq("tenant_id", l.tenantId).eq("id", l.section.id).eq("sa_adaptation->>state", l.record.state)
    .select("id");
  if (error) throw new Error(`Could not save the choice: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Undo a claim whose work then failed: the record goes back to how it was loaded. */
async function unclaim(l: Loaded, state: AdaptState) {
  const { error } = await db.from("draft_section").update({ sa_adaptation: l.record })
    .eq("tenant_id", l.tenantId).eq("id", l.section.id).eq("sa_adaptation->>state", state);
  if (error) console.error(`[sa-adapt] choice not undone after a failure: ${error.message}`);
}

async function logChoice(l: Loaded, event: string, payload: Record<string, unknown> = {}) {
  const { error: evErr } = await db.from("card_event").insert({  // tenant-safe: the row carries tenant_id from the session
    tenant_id: l.tenantId, draft_id: l.section.draft_id, section_id: l.section.id, card_id: null, block_id: null,
    event, actor: l.userId, actor_role: "admin", payload: { from_section_id: l.record.fromSectionId, ...payload },
  });
  if (evErr) console.error(`[sa-adapt] ${event} not logged: ${evErr.message}`);
  revalidatePath(`/drafts/${l.section.draft_id}`);
}

/** Keep for this grant only. */
export async function keepAdaptationAction(sectionId: string): Promise<Result> {
  const l = await load(sectionId, ["open"]);
  if (!l.ok) return l;
  if (!(await claim(l, "kept"))) return { ok: false, error: ALREADY };
  await logChoice(l, "sa_kept_local");
  return { ok: true };
}

/**
 * Also update the Standard Answer: this answer becomes the Standard Answers
 * question's working version, unapproved. A version of Standard Answers is
 * saved first, and the approved answer's pieces are kept (answer.approved_blocks)
 * so it stays in use until the new version is approved.
 */
export async function updateStandardFromAdaptationAction(sectionId: string): Promise<Result<{ standardsDraftId: string }>> {
  const l = await load(sectionId, ["open", "kept"]);
  if (!l.ok) return l;
  const { data: target } = await db.from("draft_section").select("id, draft_id, question_slugs, grant_draft!inner(purpose, status)")
    .eq("tenant_id", l.tenantId).eq("id", l.record.fromSectionId).maybeSingle();
  const t = target as { id: string; draft_id: string; question_slugs: string[] | null; grant_draft: { purpose: string; status: string } } | null;
  if (!t || t.grant_draft.purpose !== "standard_answers") {
    return { ok: false, error: "The Standard Answers question this came from is no longer there." };
  }
  if (!l.section.slug || t.question_slugs?.[0] !== l.section.slug) {
    return { ok: false, error: "This question is no longer linked to the same bank question as that Standard Answer, so it cannot replace it." };
  }
  const { data: rows, error: rErr } = await db.from("section_block").select(BLOCK_COLS)
    .eq("tenant_id", l.tenantId).eq("section_id", l.section.id).order("sort_order");
  if (rErr) return { ok: false, error: `Could not read this answer: ${rErr.message}` };
  const pieces = ((rows ?? []) as Record<string, unknown>[]).filter(b => !b.proposed);
  if (!pieces.length) return { ok: false, error: "This answer is empty, so there is nothing to copy into the Standard Answer." };

  // The approved answer must stay in use. One approved before 0065 has no pieces
  // of its own yet: keep the Standard Answer's pieces as they stand now, first.
  const { data: ansRow, error: aErr } = await db.from("answer").select("*")
    .eq("tenant_id", l.tenantId).eq("draft_section_id", t.id).maybeSingle();
  if (aErr) return { ok: false, error: `Could not read the approved Standard Answer: ${aErr.message}` };
  const ans = ansRow as { id: string; status: string; approved_blocks?: unknown } | null;
  if (ans?.status === "published" && !(Array.isArray(ans.approved_blocks) && ans.approved_blocks.length)) {
    const { data: cur, error: cErr } = await db.from("section_block").select(BLOCK_COLS)
      .eq("tenant_id", l.tenantId).eq("section_id", t.id).order("sort_order");
    const { error: sErr } = cErr ? { error: cErr } : await db.from("answer").update({ approved_blocks: approvedSnapshot((cur ?? []) as Record<string, unknown>[]) })
      .eq("tenant_id", l.tenantId).eq("id", ans.id);
    if (sErr) return { ok: false, error: `Could not keep the approved Standard Answer in use, so nothing changed: ${sErr.message}` };
  }

  if (!(await claim(l, "update_requested"))) return { ok: false, error: ALREADY };
  try { await saveVersionAction(t.draft_id, `Before update from "${l.draft.title.slice(0, 80)}"`); }
  catch (e) {
    await unclaim(l, "update_requested");
    return { ok: false, error: e instanceof Error ? e.message : "Could not save a version of Standard Answers first, so nothing changed." };
  }

  // The new pieces go in first, then the old ones come out, so a failure never
  // leaves the Standard Answer empty.
  const { data: old, error: oErr } = await db.from("section_block").select("id").eq("tenant_id", l.tenantId).eq("section_id", t.id);
  if (oErr) { await unclaim(l, "update_requested"); return { ok: false, error: `Could not read the Standard Answer: ${oErr.message}` }; }
  const oldIds = ((old ?? []) as { id: string }[]).map(b => b.id);
  const base = oldIds.length + 1000;
  const newIds = pieces.map(() => randomUUID());
  const { error: iErr } = await db.from("section_block").insert(pieces.map((b, i) => ({  // tenant-safe: every row carries tenant_id from the session
    id: newIds[i], tenant_id: l.tenantId, section_id: t.id, sort_order: base + i, kind: b.kind,
    card_id: b.card_id ?? null, card_version: b.card_version ?? null, text: b.text ?? null,
    edited: !!b.edited, break_before: !!b.break_before, created_by: l.userId,
  })));
  if (iErr) {
    await unclaim(l, "update_requested");
    return { ok: false, error: `Could not write the Standard Answer's working version, so nothing changed: ${iErr.message}` };
  }
  if (oldIds.length) {
    const { error: dErr } = await db.from("section_block").delete().eq("tenant_id", l.tenantId).eq("section_id", t.id).in("id", oldIds);
    if (dErr) {
      await db.from("section_block").delete().eq("tenant_id", l.tenantId).eq("section_id", t.id).in("id", newIds);
      await unclaim(l, "update_requested");
      return { ok: false, error: `Could not clear the Standard Answer's old working version, so nothing changed: ${dErr.message}` };
    }
  }
  // Numbered from 0 again, now the old pieces are gone. Best-effort: the order already holds.
  for (let i = 0; i < newIds.length; i++) {
    const { error: oErr2 } = await db.from("section_block").update({ sort_order: i }).eq("tenant_id", l.tenantId).eq("id", newIds[i]);
    if (oErr2) { console.error(`[sa-adapt] renumbering stopped: ${oErr2.message}`); break; }
  }
  // Back to drafting: it must be approved again before it is used.
  const { error: stErr } = await db.from("draft_section").update({ status: "drafting", updated_at: new Date().toISOString() })
    .eq("tenant_id", l.tenantId).eq("id", t.id);
  if (stErr) console.error(`[sa-adapt] Standard Answer not set back to drafting: ${stErr.message}`);
  await logChoice(l, "sa_update_requested", { to_section_id: t.id, pieces: pieces.length, status_reset: !stErr });
  revalidatePath(`/drafts/${t.draft_id}`);
  return { ok: true, standardsDraftId: t.draft_id };
}

/** Go back to the Standard Answer, as it was copied in. The page remembers the answer for Undo first. */
export async function revertAdaptationAction(sectionId: string): Promise<Result<{ blocks: WsBlock[] }>> {
  const l = await load(sectionId, ["open", "kept"]);
  if (!l.ok) return l;
  if (!(await claim(l, "reverted"))) return { ok: false, error: ALREADY };
  const r = await restoreAnswerAction(sectionId, l.record.original).catch((e: unknown) =>
    ({ ok: false as const, error: e instanceof Error ? e.message : "Could not go back to the Standard Answer." }));
  if (!r.ok) { await unclaim(l, "reverted"); return r; }
  await logChoice(l, "sa_reverted");
  return { ok: true, blocks: r.blocks };
}

/**
 * See what changed: the Standard Answer as it was copied in, and this answer
 * as it is now, each as one text (proposed bridges left out).
 */
export async function compareAdaptationAction(sectionId: string): Promise<Result<{ before: string; after: string }>> {
  const l = await load(sectionId, ["open", "kept", "update_requested", "reverted"]);
  if (!l.ok) return l;
  const { data: rows } = await db.from("section_block").select(BLOCK_COLS)
    .eq("tenant_id", l.tenantId).eq("section_id", sectionId).order("sort_order");
  const now = await resolveBlocks(l.tenantId, ((rows ?? []) as Record<string, unknown>[]).filter(b => !b.proposed));
  const was = await resolveBlocks(l.tenantId, l.record.original.map((p, i) => ({
    id: p.id, section_id: sectionId, sort_order: i, kind: p.kind, card_id: p.cardId, card_version: p.cardVersion,
    text: p.text, edited: p.edited, break_before: p.breakBefore, proposed: false,
  })));
  return { ok: true, before: assembleAnswer(was), after: assembleAnswer(now) };
}
