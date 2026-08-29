"use server";
// Funder Ledger overlay lifecycle. Intake is open to any signed-in session
// (FG staff verify grants while working a client), but every *decision* is
// admin-only and verified server-side. Nothing here ever writes to the Ledger
// base — the base stays frozen and immutable by design.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import type { OverlayProposal, OverlayConfidence, OverlayManualEntry } from "@/lib/types";
import { buildOverlayEntry } from "@/lib/overlay-entry";

async function requireAdmin() {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  return s;
}

function assertHttpUrl(url: string) {
  // source_url is the durable part of an overlay row: it's what a reviewer
  // clicks to verify. A row without a real one is worthless, so reject early
  // rather than filling the queue with unverifiable candidates.
  let u: URL;
  try { u = new URL(url); } catch { throw new Error("source_url must be a valid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("source_url must be http(s)");
}

/**
 * Intake. Writes a candidate into the review queue as `proposed`.
 *
 * Called when FG verifies or discovers a funder/grant while working a client
 * (application prep, RFP Scout, a funder's own site) and by the discovery bot.
 * Never writes live data: everything gates through the review queue.
 */
export async function proposeOverlayAction(p: OverlayProposal) {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  assertHttpUrl(p.source_url);
  if (p.kind !== "funder" && p.kind !== "grant") throw new Error("kind must be funder or grant");

  // Non-admins can only attribute a find to the client they're actually in,
  // and cannot dress their submission up as something a reviewer trusts more.
  // provenance and confidence both render in the review queue; letting a client
  // session set them to "scout_bot"/"high" would launder an arbitrary record
  // past the human gate, and an approved row reaches EVERY tenant's matching.
  const admin = s.role === "admin";
  const surfacedFor = admin ? (p.surfaced_for_tenant ?? s.tenantId) : s.tenantId;
  const provenance = admin ? (p.provenance ?? "manual") : "client_surfaced";
  const confidence = admin ? (p.confidence ?? null) : null;

  // fields is unbounded JSONB written by any signed-in session. Cap it.
  const fields = p.fields ?? {};
  if (JSON.stringify(fields).length > 20_000) throw new Error("fields payload too large");

  // tenant-safe: ledger_overlay is admin-only For Granted IP, not tenant data;
  // surfaced_for_tenant is provenance (which engagement found it), not an
  // isolation key, and is pinned to the caller's own tenant just above.
  const { data, error } = await db.from("ledger_overlay").insert({
    kind: p.kind,
    base_id: p.base_id ?? null,
    ein: p.ein ?? null,
    opportunity_number: p.opportunity_number ?? null,
    title: p.title ?? null,
    fields,
    source_url: p.source_url,
    provenance,
    surfaced_for_tenant: surfacedFor,
    confidence,
    proposed_by: s.user.id,
    status: "proposed",
  }).select("id").single();
  // Don't hand raw Postgres constraint text back to a client session.
  if (error) { console.error("proposeOverlayAction insert failed", error); throw new Error("Could not queue that candidate."); }

  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: surfacedFor,
    action: "overlay_propose", detail: `${p.kind}:${p.title ?? p.base_id ?? data.id}`,
  });
  revalidatePath("/admin/ledger-overlay");
  return data.id as string;
}

/** Claim a row for review, so two admins don't work the same candidate. */
export async function claimOverlayAction(id: string) {
  const s = await requireAdmin();
  // tenant-safe: admin-only overlay table, no tenant_id; row addressed by id.
  await db.from("ledger_overlay").update({ status: "in_review", reviewed_by: s.user.id })
    .eq("id", id).in("status", ["proposed"]);
  revalidatePath("/admin/ledger-overlay");
}

/**
 * Approve (optionally editing the fields first — the "edit-then-approve" path
 * is the same call with `fields` supplied).
 *
 * A newer approved verification of the same base record supersedes the older
 * one rather than deleting it, so the history of what we believed and when
 * stays intact.
 */
export async function approveOverlayAction(
  id: string, edits?: { fields?: Record<string, unknown>; title?: string; source_url?: string; confidence?: OverlayConfidence | null },
) {
  const s = await requireAdmin();
  if (edits?.source_url) assertHttpUrl(edits.source_url);

  // tenant-safe: admin-only overlay table, no tenant_id; row addressed by id.
  const { data: row } = await db.from("ledger_overlay")
    .select("id, kind, base_id, title, status").eq("id", id).single();
  if (!row) throw new Error("no such overlay row");
  if (row.status === "approved") return;                       // already live, nothing to do
  if (row.status !== "proposed" && row.status !== "in_review")
    throw new Error(`this candidate is ${row.status} — reopen it before approving`);

  const now = new Date().toISOString();

  // Supersede AFTER the approval lands, never before. The two writes are
  // separate round-trips with no transaction around them; doing it the other
  // way round means a failure between them leaves the base record with zero
  // approved corrections and every tenant silently back on stale June-2026
  // data. In this order the worst case is two approved rows for a beat, and
  // the unique partial index in 0019 refuses even that.
  // tenant-safe: admin-only overlay table, no tenant_id; row addressed by id.
  const { error: upErr } = await db.from("ledger_overlay").update({
    ...(edits?.fields ? { fields: edits.fields } : {}),
    ...(edits?.title !== undefined ? { title: edits.title } : {}),
    ...(edits?.source_url ? { source_url: edits.source_url } : {}),
    ...(edits?.confidence !== undefined ? { confidence: edits.confidence } : {}),
    status: "approved", reviewed_by: s.user.id, reviewed_at: now,
  }).eq("id", id);
  if (upErr) {
    // The unique index fires here if a prior approval is still live: supersede
    // it and retry once, so the ordering above stays safe without a transaction.
    if (row.base_id) {
      // tenant-safe: admin-only overlay table; supersedes prior approvals of the
      // same base record across all clients, which is the intended scope.
      await db.from("ledger_overlay").update({
        status: "superseded", reviewed_by: s.user.id, reviewed_at: now,
        review_note: `superseded by ${id}`,
      }).eq("kind", row.kind).eq("base_id", row.base_id).eq("status", "approved").neq("id", id);
      // tenant-safe: admin-only overlay table, no tenant_id; row addressed by id.
      const { error: retryErr } = await db.from("ledger_overlay").update({
        ...(edits?.fields ? { fields: edits.fields } : {}),
        ...(edits?.title !== undefined ? { title: edits.title } : {}),
        ...(edits?.source_url ? { source_url: edits.source_url } : {}),
        ...(edits?.confidence !== undefined ? { confidence: edits.confidence } : {}),
        status: "approved", reviewed_by: s.user.id, reviewed_at: now,
      }).eq("id", id);
      if (retryErr) throw new Error(retryErr.message);
    } else throw new Error(upErr.message);
  } else if (row.base_id) {
    // Approval landed cleanly, so no prior approval existed for this base
    // record. Sweep anyway for the rows the index can't see (base_id null
    // history, kind changes) and to stamp who superseded what.
    // tenant-safe: admin-only overlay table; supersedes prior approvals of the
    // same base record across all clients, which is the intended scope.
    await db.from("ledger_overlay").update({
      status: "superseded", reviewed_by: s.user.id, reviewed_at: now,
      review_note: `superseded by ${id}`,
    }).eq("kind", row.kind).eq("base_id", row.base_id).eq("status", "approved").neq("id", id);
  }

  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: null,
    action: edits?.fields ? "overlay_edit_approve" : "overlay_approve",
    detail: `${row.kind}:${row.title ?? row.base_id ?? id}`,
  });
  revalidatePath("/admin/ledger-overlay");
}

export async function rejectOverlayAction(id: string, note: string) {
  const s = await requireAdmin();
  if (!note.trim()) throw new Error("a reject needs a note — it's the record of why");
  // tenant-safe: admin-only overlay table, no tenant_id; row addressed by id.
  const { data: row } = await db.from("ledger_overlay").select("kind, title, base_id").eq("id", id).single();
  // tenant-safe: admin-only overlay table, no tenant_id; row addressed by id.
  await db.from("ledger_overlay").update({
    status: "rejected", review_note: note.trim(),
    reviewed_by: s.user.id, reviewed_at: new Date().toISOString(),
  }).eq("id", id);
  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: null, action: "overlay_reject",
    detail: `${row?.kind ?? "?"}:${row?.title ?? row?.base_id ?? id} — ${note.trim().slice(0, 140)}`,
  });
  revalidatePath("/admin/ledger-overlay");
}

/**
 * Manual intake: an admin recording what they just verified on a funder's site.
 *
 * This is the human half of the living overlay. For Granted already has to
 * verify at source before anything reaches a client; this is what turns that
 * work into permanent data instead of letting it evaporate into a doc.
 *
 * Lands as `proposed` like every other feed. Even a hand-entered record goes
 * through review, so approving is always a deliberate second look.
 */
export async function addOverlayRecordAction(e: OverlayManualEntry) {
  const s = await requireAdmin();
  assertHttpUrl(e.source_url);
  if (e.kind !== "funder" && e.kind !== "grant") throw new Error("kind must be funder or grant");

  const built = buildOverlayEntry(e);

  const tenant = e.surfaced_for_tenant || null;
  return proposeOverlayAction({
    kind: e.kind,
    base_id: built.base_id,
    ein: built.ein,
    opportunity_number: built.opportunity_number,
    title: built.title,
    fields: built.fields,
    source_url: e.source_url.trim(),
    // "Found while working a client" when a client is named; otherwise a
    // standalone hand entry. The distinction drives the queue's grouping.
    provenance: tenant ? "client_surfaced" : "manual",
    surfaced_for_tenant: tenant,
    confidence: e.confidence ?? null,
  });
}
