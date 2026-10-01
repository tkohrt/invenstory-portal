"use server";
// Confirming the questions of a funder's application.
//
// Nothing proceeds to drafting until a person has checked the parse (spec
// section 6): the questions in order, each editable, merged, split, reordered
// or deleted, with the limit beside it. Confirming is also the moment every
// question becomes a question observation (spec 16.2), matched to the bank or
// marked as a new topic, which is how the bank learns what funders ask.
//
// Admin-only throughout, and every write is scoped to the admin's active
// client, so a draft id from another engagement reads as absent.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { HAND_MATCH, loadBank, matchToBank, matchFields, orgTypeOf } from "./application-parse";
import { promptInSource, SLUG_KINDS } from "@/lib/application-parse";
import { kindsFor } from "@/lib/story-card";

async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

export interface SectionInput {
  /** Absent for a question a person added. */
  id?: string;
  prompt: string;
  guidance: string | null;
  limit_value: number | null;
  limit_unit: "words" | "characters" | null;
  criteria: string | null;
  /**
   * Present only when the person chose the bank match themselves: a slug, or
   * null for "a new topic". Absent means leave the match to the model.
   */
  handSlug?: string | null;
}

interface Existing {
  id: string; prompt: string; question_slugs: string[]; wanted_kinds: string[];
  match_reason: string | null; matched_prompt: string | null;
}

const clean = (s: string | null | undefined, max: number) => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, max) : null;
};

async function draftFor(tenantId: string, draftId: string) {
  const { data, error } = await db.from("grant_draft")
    .select("id, title, funder, source_text, confirmed_at")
    .eq("tenant_id", tenantId).eq("id", draftId).eq("mode", "cards").maybeSingle();
  if (error) throw new Error(`Could not read the draft: ${error.message}`);
  if (!data) throw new Error("That application draft does not exist for this client.");
  return data as { id: string; title: string; funder: string | null; source_text: string | null; confirmed_at: string | null };
}

/** Replace a draft's questions with the edited list. Returns nothing a client could use. */
async function writeSections(tenantId: string, draftId: string, inputs: SectionInput[], orgType: string | null) {
  const draft = await draftFor(tenantId, draftId);
  if (draft.confirmed_at) throw new Error("These questions are confirmed. Reopen them to change anything.");
  if (!inputs.length) throw new Error("An application needs at least one question.");
  if (inputs.length > 120) throw new Error("That is more questions than an application holds; check for a parsing problem.");

  const { data: rows, error } = await db.from("draft_section")
    .select("id, prompt, question_slugs, wanted_kinds, match_reason, matched_prompt")
    .eq("tenant_id", tenantId).eq("draft_id", draftId);
  if (error) throw new Error(`Could not read the questions: ${error.message}`);
  const existing = new Map(((rows ?? []) as Existing[]).map(r => [r.id, r]));
  const source = draft.source_text ?? "";
  const allowedKinds = new Set(kindsFor(orgType).map(k => k.key));
  const bank = await loadBank();
  const bySlug = new Map(bank.map(q => [q.slug, q]));

  const keep = new Set<string>();
  for (const [i, q] of inputs.entries()) {
    const prompt = clean(q.prompt, 4000);
    if (!prompt) throw new Error(`Question ${i + 1} is empty. Delete it or give it the funder's wording.`);
    const unit = q.limit_unit === "words" || q.limit_unit === "characters" ? q.limit_unit : null;
    const value = q.limit_value && Number.isInteger(q.limit_value) && q.limit_value > 0 && q.limit_value < 1_000_000 ? q.limit_value : null;
    const base = {
      sort_order: i, prompt,
      guidance: clean(q.guidance, 6000), criteria: clean(q.criteria, 4000),
      limit_value: value && unit ? value : null, limit_unit: value && unit ? unit : null,
      in_source: promptInSource(prompt, source),
      confirmed: false, updated_at: new Date().toISOString(),
    };
    let match: Record<string, unknown> = {};
    if (q.handSlug !== undefined) {
      const slug = q.handSlug && bySlug.has(q.handSlug) ? q.handSlug : null;
      const own = slug ? bySlug.get(slug)?.wanted_kinds : null;
      const kinds = slug ? (own && own.length ? own : SLUG_KINDS[slug] ?? []).filter(k => allowedKinds.has(k)) : null;
      match = {
        question_slugs: slug ? [slug] : [],
        // A new topic chosen by hand keeps whatever kinds the model suggested.
        ...(kinds ? { wanted_kinds: kinds } : {}),
        match_reason: HAND_MATCH, matched_prompt: prompt,
      };
    }
    const prior = q.id ? existing.get(q.id) : undefined;
    if (prior) {
      keep.add(prior.id);
      const { error: e } = await db.from("draft_section").update({ ...base, ...match })
        .eq("tenant_id", tenantId).eq("id", prior.id);
      if (e) throw new Error(`Could not save question ${i + 1}: ${e.message}`);
    } else {
      const { data: ins, error: e } = await db.from("draft_section").insert({
        tenant_id: tenantId, draft_id: draftId, origin: "manual", ...base, ...match,
      }).select("id").single();
      if (e || !ins) throw new Error(`Could not add question ${i + 1}: ${e?.message ?? "no row"}`);
      keep.add((ins as { id: string }).id);
    }
  }

  const gone = [...existing.keys()].filter(id => !keep.has(id));
  if (gone.length) {
    // A deleted question was never asked, so it is not an observation either.
    await db.from("question_observation").delete().eq("tenant_id", tenantId).in("draft_section_id", gone);
    const { error: e } = await db.from("draft_section").delete().eq("tenant_id", tenantId).in("id", gone);
    if (e) throw new Error(`Could not remove deleted questions: ${e.message}`);
  }
}

/** Save the edits without confirming. */
export async function saveSectionsAction(draftId: string, inputs: SectionInput[]) {
  const s = await requireAdmin();
  await writeSections(s.tenantId, draftId, inputs, await orgTypeOf(s.tenantId));
  revalidatePath(`/drafts/${draftId}`);
  return { ok: true };
}

/**
 * Save, re-match anything edited since it was matched, log every question as an
 * observation, and mark the questions confirmed.
 */
export async function confirmSectionsAction(draftId: string, inputs: SectionInput[]) {
  const s = await requireAdmin();
  const tenantId = s.tenantId;
  const orgType = await orgTypeOf(tenantId);
  await writeSections(tenantId, draftId, inputs, orgType);
  const draft = await draftFor(tenantId, draftId);

  const { data: rows, error } = await db.from("draft_section")
    .select("id, prompt, guidance, limit_value, limit_unit, question_slugs, match_reason, matched_prompt")
    .eq("tenant_id", tenantId).eq("draft_id", draftId).order("sort_order");
  if (error) throw new Error(`Could not read the questions: ${error.message}`);
  const secs = (rows ?? []) as {
    id: string; prompt: string; guidance: string | null; limit_value: number | null; limit_unit: string | null;
    question_slugs: string[]; match_reason: string | null; matched_prompt: string | null;
  }[];

  // Re-match what changed. A hand-chosen match is the person's decision and stays.
  const bank = await loadBank();
  const stale = secs.filter(x => x.matched_prompt !== x.prompt && x.match_reason !== HAND_MATCH);
  let unanswered = 0;
  for (let i = 0; i < stale.length; i += 15) {
    const batch = stale.slice(i, i + 15);
    const { matches, answered } = await matchToBank(batch, bank, orgType);
    if (!answered) unanswered += batch.length;
    await Promise.all(batch.map(async (x, k) => {
      const f = matchFields(matches[k], x.prompt);
      x.question_slugs = f.question_slugs; x.match_reason = f.match_reason;
      await db.from("draft_section").update(f).eq("tenant_id", tenantId).eq("id", x.id);
    }));
  }
  if (unanswered) {
    throw new Error(`The model did not answer while matching ${unanswered} edited question(s) to the bank, so nothing was confirmed. `
      + "Your edits are saved. Try again, or choose their bank match by hand.");
  }

  // One observation per question: replace, never duplicate.
  const bankId = new Map(bank.map(q => [q.slug, q.id]));
  const ids = secs.map(x => x.id);
  const { error: delErr } = await db.from("question_observation").delete().eq("tenant_id", tenantId).in("draft_section_id", ids);
  if (delErr) throw new Error(`Could not refresh the question log: ${delErr.message}`);
  const obs = secs.map(x => {
    const slug = x.question_slugs[0] ?? null;
    return {
      tenant_id: tenantId, source: "draft", draft_id: draftId, draft_section_id: x.id,
      funder: draft.funder, prompt: x.prompt, guidance: x.guidance,
      limit_value: x.limit_value, limit_unit: x.limit_unit,
      matched_question: slug ? bankId.get(slug) ?? null : null,
      match_reason: x.match_reason,
      matched_by: x.match_reason === HAND_MATCH ? "admin" : "model",
    };
  });
  const { error: obsErr } = await db.from("question_observation").insert(obs);  // tenant-safe: each row carries tenant_id
  if (obsErr) throw new Error(`Could not log the questions: ${obsErr.message}`);

  const now = new Date().toISOString();
  await db.from("draft_section").update({ confirmed: true }).eq("tenant_id", tenantId).eq("draft_id", draftId);
  await db.from("grant_draft").update({ confirmed_at: now, confirmed_by: s.user.id }).eq("tenant_id", tenantId).eq("id", draftId);
  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: tenantId, action: "draft_questions_confirmed",
    detail: `${draft.title.slice(0, 120)}: ${secs.length} question(s), ${obs.filter(o => o.matched_question).length} matched to the bank`,
  });
  revalidatePath(`/drafts/${draftId}`);
  return { questions: secs.length, matched: obs.filter(o => o.matched_question).length };
}

/** Undo a confirmation so the questions can be edited again. Observations stay until the next confirmation replaces them. */
export async function reopenSectionsAction(draftId: string) {
  const s = await requireAdmin();
  await draftFor(s.tenantId, draftId);
  await db.from("draft_section").update({ confirmed: false }).eq("tenant_id", s.tenantId).eq("draft_id", draftId);
  await db.from("grant_draft").update({ confirmed_at: null, confirmed_by: null }).eq("tenant_id", s.tenantId).eq("id", draftId);
  revalidatePath(`/drafts/${draftId}`);
  return { ok: true };
}

/**
 * The application's details, confirmed or corrected on the confirmation
 * screen: what the reader found (title, funder, deadline) and the amount.
 */
export async function saveDraftDetailsAction(draftId: string, d: { title: string; funder: string; deadline: string; amountDollars: string }) {
  const s = await requireAdmin();
  await draftFor(s.tenantId, draftId);
  const title = (d.title ?? "").trim().slice(0, 200);
  if (!title) throw new Error("Give the application a title.");
  const amount = (d.amountDollars ?? "").replace(/[$,\s]/g, "");
  const { error } = await db.from("grant_draft").update({
    title, funder: (d.funder ?? "").trim().slice(0, 200) || null,
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(d.deadline ?? "") ? d.deadline : null,
    amount_cents: amount && Number.isFinite(Number(amount)) ? Math.round(Number(amount) * 100) : null,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", s.tenantId).eq("id", draftId).eq("mode", "cards");
  if (error) throw new Error(`Could not save the details: ${error.message}`);
  revalidatePath(`/drafts/${draftId}`);
}
