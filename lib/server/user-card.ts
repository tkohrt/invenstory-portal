import "server-only";
// Making a user-generated Story Card (8 October 2026), shared by the writer's
// save in the Storyboard (user-card-actions.ts) and a client's answer to a
// question For Granted asked them (ask-actions.ts, 9 October 2026).
//
// The words are filed as a "Writer's note" in the client's Inven(s)tory and the
// card quotes it, so the card traces to its source: the person who wrote it, on
// that date. Saving it is the writer's own judgement of it, so it is verified by
// them. The caller has already decided who may write.
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { db } from "./db";
import { processDocument } from "./ingest";
import { orgTypeOf } from "./application-parse";
import { getTenant } from "./data";
import type { PortalSession } from "./session";
import { CARD_KIND_MAP, cardFingerprint, figuresIn, kindsFor } from "@/lib/story-card";
import { assessSensitivity } from "@/lib/card-sensitivity";
import { isoDay, sourceLine, userCardProblem, writerNote } from "@/lib/user-card";

export type SaveUserCardResult = { ok: true; cardId: string; version: number } | { ok: false; error: string; existingId?: string };

/** Save a user-generated Story Card: the Writer's note first, then the card that quotes it. */
export async function createUserCard(s: PortalSession, input: {
  text: string; kind: string; layer: "I" | "II" | "III"; asOf: string | null;
  saidBy?: string | null; fromDocument?: string | null; draftId?: string | null; sectionId?: string | null;
}): Promise<SaveUserCardResult> {
  const text = (input.text ?? "").trim().replace(/[ \t]+/g, " ");
  const problem = userCardProblem(text);
  if (problem) return { ok: false, error: problem };
  const allowed = kindsFor(await orgTypeOf(s.tenantId));
  if (!allowed.some(k => k.key === input.kind)) return { ok: false, error: "Choose a kind of card from the list." };
  if (!["I", "II", "III"].includes(input.layer)) return { ok: false, error: "Choose a layer." };
  const asOf = input.asOf && /^\d{4}-\d{2}-\d{2}$/.test(input.asOf) ? input.asOf : isoDay(new Date());

  const fingerprint = cardFingerprint(input.kind, text);
  const { data: same } = await db.from("story_card").select("id, status").eq("tenant_id", s.tenantId).eq("fingerprint", fingerprint).maybeSingle();
  if (same && same.status !== "retired") {
    return { ok: false, error: "That card is already in the library.", existingId: same.id as string };
  }

  // Draft and question, checked against this client.
  let draftId: string | null = null, sectionId: string | null = null;
  if (input.sectionId) {
    const { data: sec } = await db.from("draft_section").select("id, draft_id").eq("tenant_id", s.tenantId).eq("id", input.sectionId).maybeSingle();
    if (sec) { sectionId = sec.id as string; draftId = sec.draft_id as string; }
  }

  const tenant = await getTenant(s.tenantId);
  const org = s.role === "admin" ? "For Granted" : (tenant?.name ?? "");
  const source = input.fromDocument?.trim()
    ? `${sourceLine(s.user.full_name, org, new Date())}, from ${input.fromDocument.trim()}`
    : sourceLine(s.user.full_name, org, new Date());
  const note = writerNote({ text, kind: input.kind, source, saidBy: input.saidBy, fromDocument: input.fromDocument, asOf });
  const kind = CARD_KIND_MAP[input.kind];

  // 1. The Writer's note, filed and indexed like any upload.
  const docId = crypto.randomUUID();
  const storageKey = `${s.tenantId}/${docId}/1`;
  const up = await db.storage.from("documents").upload(storageKey, Buffer.from(note.body, "utf8"), { contentType: "text/plain" });
  if (up.error) return { ok: false, error: `Could not file the Writer's note: ${up.error.message}` };
  const { error: dErr } = await db.from("document").insert({
    id: docId, tenant_id: s.tenantId, title: note.title, layer: input.layer,
    storage_key: storageKey, mime_type: "text/plain", doc_kind: "note", status: "pending",
    uploaded_by: s.user.id, source: s.role === "admin" ? "for_granted" : "client",
  });
  if (dErr) return { ok: false, error: `Could not file the Writer's note: ${dErr.message}` };
  await db.from("document_version").insert({ document_id: docId, tenant_id: s.tenantId, version: 1, storage_key: storageKey, uploaded_by: s.user.id });
  await db.from("document_tag").insert([
    { document_id: docId, tenant_id: s.tenantId, tag: "writer-note" },
    ...(kind?.itemKey ? [{ document_id: docId, tenant_id: s.tenantId, tag: kind.itemKey }] : []),
  ]);

  // 2. The card, quoting the note. Verified by its writer: saving it is their judgement of it.
  const now = new Date().toISOString();
  const sens = assessSensitivity({ kind: input.kind, subject: "organization", statement: text, quotes: [note.quote], modelFlag: false });
  const { data: card, error: cErr } = await db.from("story_card").insert({
    tenant_id: s.tenantId, kind: input.kind, statement: text, statement_origin: "human",
    item_key: kind?.itemKey ?? null, layer: input.layer, subject: "organization", strength: "covered",
    has_figures: figuresIn(text).length > 0, status: "verified", fingerprint, created_from: "manual", version: 1,
    verified_by: s.user.id, verified_by_role: s.role === "admin" ? "admin" : "client", verified_at: now,
    sensitive: sens.sensitive, sensitive_reason: sens.reason,
    written_by: s.user.id, written_by_role: s.role === "admin" ? "admin" : "client", source_line: source,
    said_by: input.saidBy?.trim() || null, as_of: asOf, origin_draft_id: draftId, origin_section_id: sectionId,
  }).select("id").single();
  if (cErr || !card) return { ok: false, error: `Could not save the card: ${cErr?.message ?? "no row"}. Has migration 0057 been run?` };
  const cardId = card.id as string;
  await db.from("story_card_version").insert({ card_id: cardId, tenant_id: s.tenantId, version: 1, statement: text, origin: "human", created_by: s.user.id });
  await db.from("story_card_evidence").insert({ tenant_id: s.tenantId, card_id: cardId, document_id: docId, quote: note.quote, speaker: input.saidBy?.trim() || null });
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "user_card", detail: `${input.kind}: ${text.slice(0, 160)}` });

  // 3. Index the note (readiness and the analysis read it, the same as any upload).
  try { await processDocument(docId, { actor: s.role === "admin" ? "admin" : "client" }); } catch { /* the card stands; the note is retried with Process again */ }
  for (const p of ["/story-cards", "/admin/card-library", "/invenstory"]) revalidatePath(p);
  return { ok: true, cardId, version: 1 };
}

