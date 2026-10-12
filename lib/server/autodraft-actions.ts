"use server";
// Auto-draft from the page (Auto-Draft patch 6): what a run would do, for the
// confirm window, and auto-drafting one question, which runs here and now
// (one model call). A whole-draft run is started through /api/jobs/autodraft.
// For Granted only. EVERY export of a "use server" module is a public
// endpoint: the tenant and the person come from the session.
import { getSession } from "./session";
import { db } from "./db";
import { resolveBlocks, BLOCK_COLS, type WsBlock } from "./workspace";
import { autodraftPreview, autodraftSection, loadRunCtx, markAutoDrafted, type AutodraftPreview, type SectionOutcome } from "./autodraft";
import { saveBeforeAutoDraftAction } from "./version-actions";
import { SKIP_LABEL } from "@/lib/autodraft";
import { runningAutodraft } from "./autodraft-run";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** What auto-drafting the draft (or one question of it) would do, or why it cannot. */
export async function autodraftPreviewAction(draftId: string, sectionId?: string | null): Promise<Result<{ preview: AutodraftPreview }>> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "For Granted only." };
  const p = await autodraftPreview(s.tenantId, draftId, sectionId ?? null);
  return "error" in p ? { ok: false, error: p.error } : { ok: true, preview: p };
}

/** Auto-draft one question now. "Before auto-draft" is saved first. */
export async function autodraftQuestionAction(draftId: string, sectionId: string): Promise<Result<{ blocks: WsBlock[]; outcome: SectionOutcome }>> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "For Granted only." };
  const p = await autodraftPreview(s.tenantId, draftId, sectionId);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.minimum.met) return { ok: false, error: p.minimum.message };
  // Never alongside a whole-draft run on the same draft (review fix, 12 October 2026).
  const running = await runningAutodraft(s.tenantId);
  if (running?.draftId === draftId) {
    return { ok: false, error: "Auto-draft is already running on this whole draft. Wait for it to finish, or stop it." };
  }
  const item = p.plan.run[0];
  if (!item) {
    const why = p.plan.skipped[0];
    return { ok: false, error: why ? `This question is ${SKIP_LABEL[why.reason]}, so auto-draft leaves it alone.` : "There is nothing to auto-draft here." };
  }
  try { await saveBeforeAutoDraftAction(draftId); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not save the version before auto-draft, so nothing was changed." }; }
  await markAutoDrafted(s.tenantId, draftId);
  const ctx = await loadRunCtx(s.tenantId, s.user.id, draftId);
  const outcome = await autodraftSection(ctx, sectionId, item.start);
  if (outcome.error) return { ok: false, error: outcome.error };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "autodraft_question", detail: `${draftId}/${sectionId}: ${outcome.placed} placed` });
  const { data } = await db.from("section_block").select(BLOCK_COLS).eq("tenant_id", s.tenantId).eq("section_id", sectionId).order("sort_order");
  return { ok: true, blocks: await resolveBlocks(s.tenantId, (data ?? []) as Record<string, unknown>[]), outcome };
}
