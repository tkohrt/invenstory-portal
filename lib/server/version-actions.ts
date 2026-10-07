"use server";
// Versions and statuses of a card-mode draft.
//
// Every change in the Storyboard is saved the moment it is made. Versions are
// checkpoints to come back to: saved on Completed and Submitted, before each
// stage (Before Weave, Before Polish), on demand with a name, every ten minutes
// of editing when something changed, and always before a restore, so a restore
// can itself be undone. Submitted locks the draft: what the funder received is
// never altered; editing means starting a new draft from it.
//
// Admin-only and scoped to the session's client, like the rest of the drafter.
// EVERY export here is a public endpoint, so none takes a tenant id.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { BLOCK_COLS, resolveBlocks } from "./workspace";
import { assembleAnswer } from "@/lib/section-answer";
import { describeBlockers, finishBlockers, type GateCard } from "@/lib/card-gate";
import {
  autosavesToThin, canMoveStatus, compareVersion, contentHash, versionLabel,
  type DraftStatus, type SectionDiff, type VersionContent, type VersionReason,
} from "@/lib/draft-version";

async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

interface DraftRow { id: string; title: string; status: DraftStatus; stage: "arrange" | "weave" | "polish"; purpose: string }

async function loadDraft(tenantId: string, draftId: string): Promise<DraftRow> {
  const { data, error } = await db.from("grant_draft").select("id, title, status, stage, purpose, mode")
    .eq("tenant_id", tenantId).eq("id", draftId).maybeSingle();
  if (error) throw new Error(`Could not read the draft: ${error.message}`);
  if (!data || data.mode !== "cards") throw new Error("That draft is not one of this client's applications.");
  return data as unknown as DraftRow;
}

/** The whole application as it stands now. */
async function currentContent(tenantId: string, draftId: string): Promise<VersionContent> {
  const { data: secs, error } = await db.from("draft_section").select("id, prompt, status, sort_order")
    .eq("tenant_id", tenantId).eq("draft_id", draftId).order("sort_order");
  if (error) throw new Error(`Could not read the questions: ${error.message}`);
  const sections = (secs ?? []) as { id: string; prompt: string; status: "empty" | "drafting" | "done" }[];
  let rows: Record<string, unknown>[] = [];
  if (sections.length) {
    const { data, error: bErr } = await db.from("section_block").select(BLOCK_COLS)
      .eq("tenant_id", tenantId).in("section_id", sections.map(x => x.id)).order("sort_order");
    if (bErr) throw new Error(`Could not read the answers: ${bErr.message}`);
    rows = (data ?? []) as Record<string, unknown>[];
  }
  const blocks = await resolveBlocks(tenantId, rows);
  return {
    sections: sections.map(sec => {
      const mine = blocks.filter(b => b.sectionId === sec.id);
      return {
        section_id: sec.id, prompt: sec.prompt, status: sec.status, text: assembleAnswer(mine),
        blocks: mine.map(b => ({
          kind: b.kind, card_id: b.cardId, card_version: b.cardVersion, own_text: b.ownText,
          text: b.text, edited: b.edited, break_before: b.breakBefore, ...(b.proposed ? { proposed: true } : {}),
        })),
      };
    }),
  };
}

/** Save a version. Returns null when an autosave found nothing new to keep. */
async function snapshot(tenantId: string, userId: string, d: DraftRow, reason: VersionReason, name: string | null, stage?: string) {
  const content = await currentContent(tenantId, d.id);
  const hash = contentHash(content);
  if (reason === "autosave") {
    const { data: last } = await db.from("draft_snapshot").select("content_hash")
      .eq("tenant_id", tenantId).eq("draft_id", d.id).order("taken_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.content_hash === hash) return null;
  }
  const { data, error } = await db.from("draft_snapshot").insert({
    tenant_id: tenantId, draft_id: d.id, reason, name: name?.trim().slice(0, 120) || null,
    stage: stage ?? d.stage, content, content_hash: hash, taken_by: userId,
  }).select("id, taken_at").single();
  if (error || !data) throw new Error(`Could not save a version: ${error?.message ?? "no row"}`);
  if (reason === "autosave") {
    const { data: all } = await db.from("draft_snapshot").select("id, reason, taken_at")
      .eq("tenant_id", tenantId).eq("draft_id", d.id);
    const drop = autosavesToThin(((all ?? []) as { id: string; reason: VersionReason; taken_at: string }[])
      .map(v => ({ id: v.id, reason: v.reason, takenAt: v.taken_at })));
    if (drop.length) await db.from("draft_snapshot").delete().eq("tenant_id", tenantId).eq("reason", "autosave").in("id", drop);
  }
  return data as { id: string; taken_at: string };
}

export interface VersionItem { id: string; label: string; reason: VersionReason; stage: string | null; takenAt: string; by: string | null }

export async function listVersionsAction(draftId: string): Promise<VersionItem[]> {
  const s = await requireAdmin();
  await loadDraft(s.tenantId, draftId);
  const { data, error } = await db.from("draft_snapshot")
    .select("id, reason, name, stage, taken_at, taker:taken_by(full_name)")
    .eq("tenant_id", s.tenantId).eq("draft_id", draftId).order("taken_at", { ascending: false }).limit(200);
  if (error) throw new Error(`Could not read the versions: ${error.message}`);
  return ((data ?? []) as unknown as { id: string; reason: VersionReason; name: string | null; stage: string | null; taken_at: string; taker: { full_name: string } | null }[])
    .map(v => ({ id: v.id, label: versionLabel(v), reason: v.reason, stage: v.stage, takenAt: v.taken_at, by: v.taker?.full_name ?? null }));
}

/** A version's answers, compared question by question with the draft as it is now. */
export async function compareVersionAction(draftId: string, versionId: string): Promise<{ label: string; takenAt: string; diffs: SectionDiff[] }> {
  const s = await requireAdmin();
  await loadDraft(s.tenantId, draftId);
  const { data } = await db.from("draft_snapshot").select("reason, name, stage, taken_at, content")
    .eq("tenant_id", s.tenantId).eq("draft_id", draftId).eq("id", versionId).maybeSingle();
  if (!data) throw new Error("That version no longer exists.");
  const content = data.content as VersionContent;
  return {
    label: versionLabel(data as { reason: VersionReason; name: string | null; stage: string | null }),
    takenAt: data.taken_at as string,
    diffs: compareVersion(content, await currentContent(s.tenantId, draftId)),
  };
}

/** Save a version now, with an optional name. */
export async function saveVersionAction(draftId: string, name?: string | null) {
  const s = await requireAdmin();
  const d = await loadDraft(s.tenantId, draftId);
  await snapshot(s.tenantId, s.user.id, d, "manual", name ?? null);
}

/** The ten-minute checkpoint. Skipped when nothing has changed since the last version. */
export async function autosaveVersionAction(draftId: string): Promise<boolean> {
  const s = await requireAdmin();
  const d = await loadDraft(s.tenantId, draftId);
  if (["submitted", "won", "lost"].includes(d.status)) return false;
  return !!(await snapshot(s.tenantId, s.user.id, d, "autosave", null));
}

/**
 * Move to another stage, saving a version first: entering Weave saves "Before
 * Weave", entering Polish saves "Before Polish". Weave and Polish are the next
 * build; this is in place so the version exists from their first day.
 */
export async function enterStageAction(draftId: string, stage: "arrange" | "weave" | "polish") {
  const s = await requireAdmin();
  const d = await loadDraft(s.tenantId, draftId);
  if (!["arrange", "weave", "polish"].includes(stage) || stage === d.stage) return;
  if (["submitted", "won", "lost"].includes(d.status)) throw new Error("A submitted application is locked.");
  if (stage !== "arrange") await snapshot(s.tenantId, s.user.id, d, "stage", null, stage);
  const { error } = await db.from("grant_draft").update({ stage }).eq("tenant_id", s.tenantId).eq("id", draftId);
  if (error) throw new Error(`Could not change the stage: ${error.message}`);
  // No revalidatePath here. The page holds the stage itself, and a refresh
  // triggered by this action could arrive after the weave that follows it and
  // replace the new bridges with the answer as it stood a moment earlier
  // (found 7 October 2026: the first live weave saved its bridge, and the page
  // did not show it until reloaded).
}

/**
 * The finish line (lib/card-gate.ts): every card in the application verified,
 * decided and still live. The page runs the same check first and opens the
 * cards for review; this is the backstop, so it holds whatever the page does.
 */
async function finishLineRefusal(tenantId: string, draftId: string): Promise<string | null> {
  const { data: secs, error: sErr } = await db.from("draft_section").select("id, prompt, sort_order")
    .eq("tenant_id", tenantId).eq("draft_id", draftId).order("sort_order");
  if (sErr) throw new Error(`Could not read the questions: ${sErr.message}`);
  const sections = (secs ?? []) as { id: string; prompt: string }[];
  if (!sections.length) return null;
  const { data: rows, error: bErr } = await db.from("section_block").select("id, section_id, kind, card_id, card_version, edited")
    .eq("tenant_id", tenantId).in("section_id", sections.map(x => x.id));
  if (bErr) throw new Error(`Could not read the answers: ${bErr.message}`);
  const blocks = ((rows ?? []) as { id: string; section_id: string; kind: string; card_id: string | null; card_version: number | null; edited: boolean }[])
    .map(r => ({ id: r.id, sectionId: r.section_id, kind: r.kind, cardId: r.card_id, text: "", cardVersion: r.card_version, edited: !!r.edited }));
  const ids = [...new Set(blocks.map(b => b.cardId).filter((x): x is string => !!x))];
  const cards = new Map<string, GateCard>();
  if (ids.length) {
    const { data: cs, error: cErr } = await db.from("story_card").select("id, status, sensitive, sensitive_cleared, version")
      .eq("tenant_id", tenantId).in("id", ids);
    if (cErr) throw new Error(`Could not check the cards: ${cErr.message}`);
    for (const c of (cs ?? []) as { id: string; status: string; sensitive: boolean; sensitive_cleared: string | null; version: number }[]) {
      cards.set(c.id, { status: c.status, sensitive: c.sensitive, sensitiveCleared: c.sensitive_cleared, version: c.version });
    }
  }
  const list = finishBlockers(sections, blocks, id => cards.get(id));
  return list.length ? describeBlockers(list) : null;
}

/**
 * Change a draft's status. Completed and Submitted each save a version;
 * Submitted records the date and locks the draft. Both are refused while any
 * card in the application is unverified, sensitive and undecided, or retired.
 */
export async function setDraftStatusAction(draftId: string, status: DraftStatus, submittedOn?: string | null) {
  const s = await requireAdmin();
  const d = await loadDraft(s.tenantId, draftId);
  if (d.purpose === "standard_answers") throw new Error("Standard Answers is not an application, so it has no status.");
  if (!canMoveStatus(d.status, status)) throw new Error("That change of status is not allowed. A submitted application only takes its outcome.");
  if (status === "completed" || status === "submitted") {
    const refusal = await finishLineRefusal(s.tenantId, draftId);
    if (refusal) throw new Error(`${refusal} Review them in this application before marking it ${status}.`);
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "completed") {
    await snapshot(s.tenantId, s.user.id, d, "completed", null);
    patch.completed_at = now;
  }
  if (status === "submitted") {
    await snapshot(s.tenantId, s.user.id, d, "submitted", null);
    patch.submitted_at = submittedOn && /^\d{4}-\d{2}-\d{2}$/.test(submittedOn) ? `${submittedOn}T12:00:00Z` : now;
  }
  const { error } = await db.from("grant_draft").update(patch).eq("tenant_id", s.tenantId).eq("id", draftId);
  if (error) throw new Error(`Could not change the status: ${error.message}`);
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "draft_status", detail: `${d.title.slice(0, 120)}: ${d.status} -> ${status}` });
  revalidatePath(`/drafts/${draftId}`);
  revalidatePath("/drafts");
}

/**
 * Restore a version. The draft as it stands is saved first, so the restore can
 * itself be undone. Questions that no longer exist are skipped and counted.
 */
export async function restoreVersionAction(draftId: string, versionId: string): Promise<{ restored: number; skipped: number }> {
  const s = await requireAdmin();
  const d = await loadDraft(s.tenantId, draftId);
  if (["submitted", "won", "lost"].includes(d.status)) throw new Error("A submitted application is locked. Start a new version from it instead.");
  const { data: v } = await db.from("draft_snapshot").select("reason, name, stage, content")
    .eq("tenant_id", s.tenantId).eq("draft_id", draftId).eq("id", versionId).maybeSingle();
  if (!v) throw new Error("That version no longer exists.");
  const label = versionLabel(v as { reason: VersionReason; name: string | null; stage: string | null });
  await snapshot(s.tenantId, s.user.id, d, "restore", `Before restoring "${label}"`);

  const content = v.content as VersionContent;
  const { data: secs } = await db.from("draft_section").select("id").eq("tenant_id", s.tenantId).eq("draft_id", draftId);
  const live = new Set(((secs ?? []) as { id: string }[]).map(x => x.id));
  let restored = 0, skipped = 0;
  for (const sec of content.sections) {
    if (!live.has(sec.section_id)) { skipped += 1; continue; }
    const { error: delErr } = await db.from("section_block").delete().eq("tenant_id", s.tenantId).eq("section_id", sec.section_id);
    if (delErr) throw new Error(`Could not restore a question: ${delErr.message}`);
    if (sec.blocks.length) {
      const { error } = await db.from("section_block").insert(sec.blocks.map((b, i) => ({  // tenant-safe: every row carries tenant_id from the session
        tenant_id: s.tenantId, section_id: sec.section_id, sort_order: i, kind: b.kind,
        card_id: b.card_id, card_version: b.card_version, text: b.own_text, edited: b.edited,
        break_before: b.break_before, proposed: b.kind === "bridge" && !!b.proposed, created_by: s.user.id,
      })));
      if (error) throw new Error(`Could not restore a question: ${error.message}`);
    }
    await db.from("draft_section").update({ status: sec.blocks.length ? (sec.status === "empty" ? "drafting" : sec.status) : "empty" })
      .eq("tenant_id", s.tenantId).eq("id", sec.section_id);
    restored += 1;
  }
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "draft_restore", detail: `${d.title.slice(0, 100)}: ${label}` });
  revalidatePath(`/drafts/${draftId}`);
  return { restored, skipped };
}

/**
 * Start a new, editable draft from a submitted one: same questions, same
 * answers, status Drafting. The submitted draft stays exactly as it was.
 */
export async function newDraftFromAction(draftId: string): Promise<string> {
  const s = await requireAdmin();
  const { data: src } = await db.from("grant_draft")
    .select("title, funder, amount_cents, deadline, mode, purpose, source_kind, source_url, source_text, source_filename, opportunity_ref, required_attachments, parsed_at, confirmed_at")
    .eq("tenant_id", s.tenantId).eq("id", draftId).maybeSingle();
  if (!src || src.mode !== "cards" || src.purpose === "standard_answers") throw new Error("That is not one of this client's applications.");
  const now = new Date().toISOString();
  const { data: made, error } = await db.from("grant_draft").insert({
    ...src, tenant_id: s.tenantId, title: `${src.title} (revised)`.slice(0, 200), status: "drafting",
    created_by: s.user.id, confirmed_by: s.user.id, confirmed_at: src.confirmed_at ?? now, stage: "arrange",
  }).select("id").single();
  if (error || !made) throw new Error(`Could not start the new draft: ${error?.message ?? "no row"}`);
  const newId = made.id as string;

  const { data: secs } = await db.from("draft_section")
    .select("id, sort_order, prompt, guidance, limit_value, limit_unit, criteria, question_slugs, wanted_kinds, origin, in_source, match_reason, matched_prompt, status")
    .eq("tenant_id", s.tenantId).eq("draft_id", draftId).order("sort_order");
  for (const sec of (secs ?? []) as Record<string, unknown>[]) {
    const { id: oldId, ...rest } = sec;
    const { data: ns, error: sErr } = await db.from("draft_section").insert({ ...rest, tenant_id: s.tenantId, draft_id: newId, confirmed: true })
      .select("id").single();
    if (sErr || !ns) throw new Error(`Could not copy a question: ${sErr?.message ?? "no row"}`);
    const { data: bl } = await db.from("section_block").select("sort_order, kind, card_id, card_version, text, edited, break_before, proposed")
      .eq("tenant_id", s.tenantId).eq("section_id", oldId as string);
    if (bl?.length) {
      const { error: bErr } = await db.from("section_block").insert(  // tenant-safe: every row carries tenant_id from the session
        (bl as Record<string, unknown>[]).map(b => ({ ...b, tenant_id: s.tenantId, section_id: ns.id, created_by: s.user.id })));
      if (bErr) throw new Error(`Could not copy an answer: ${bErr.message}`);
    }
  }
  revalidatePath("/drafts");
  return newId;
}
