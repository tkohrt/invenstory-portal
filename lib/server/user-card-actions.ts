"use server";
// User-generated Story Cards (8 October 2026): a writer saves something they
// typed into a draft as a Story Card.
//
// The words are filed as a "Writer's note" in the client's Inven(s)tory (a
// text document, layer as chosen, tagged writer-note) and the card quotes it,
// so the card traces to its source like every other card: here, the person who
// wrote it, on that date. The card is created_from = 'manual' and shown as
// "User-generated". Saving it is the writer's own judgement of it, so it is
// verified by them (the same rule as editing a card). A card For Granted writes
// about a client also waits for the client to confirm it on their Story Cards
// page; that does not stop it being drafted with.
//
// EVERY export of a "use server" module is a public endpoint: none takes a
// tenant id. The tenant and the person come from the session.
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { processDocument } from "./ingest";
import { orgTypeOf } from "./application-parse";
import { getTenant } from "./data";
import { CARD_KIND_MAP, cardFingerprint, figuresIn, kindsFor } from "@/lib/story-card";
import { assessSensitivity } from "@/lib/card-sensitivity";
import {
  defaultKind, isoDay, lookAlikes, mentionedFigures, sourceLine, userCardProblem, writerNote, type ExistingCard,
} from "@/lib/user-card";

async function writer() {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  // The Storyboarding Tool is For Granted's for now (Decision 1). Clients will
  // write their own cards here once they draft.
  if (s.role !== "admin") throw new Error("For Granted only, for now.");
  return s;
}

export interface UserCardDefaults {
  kind: string;
  kinds: { key: string; label: string }[];
  layer: "I" | "II" | "III";
  asOf: string;
  source: string;
  /** Numbers the text mentions: the one optional question is whether they come from a document. */
  figures: string[];
  /** Verified cards already in the library that look like this one. */
  lookAlikes: { id: string; statement: string; kindLabel: string; verified: boolean }[];
  problem: string | null;
}

/** Everything the save card needs, filled in, for the person to accept with one click. */
export async function prepareUserCardAction(text: string, sectionId: string | null): Promise<UserCardDefaults> {
  const s = await writer();
  const [orgType, tenant, sec, { data: cards }] = await Promise.all([
    orgTypeOf(s.tenantId),
    getTenant(s.tenantId),
    sectionId
      ? db.from("draft_section").select("wanted_kinds").eq("tenant_id", s.tenantId).eq("id", sectionId).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("story_card").select("id, kind, statement, status").eq("tenant_id", s.tenantId).neq("status", "retired"),
  ]);
  const allowed = kindsFor(orgType);
  const wanted = ((sec as { data: { wanted_kinds?: string[] } | null }).data?.wanted_kinds ?? []) as string[];
  const org = s.role === "admin" ? "For Granted" : (tenant?.name ?? "");
  const alike = lookAlikes(text, (cards ?? []) as ExistingCard[]);
  return {
    kind: defaultKind(wanted, allowed),
    kinds: allowed.map(k => ({ key: k.key, label: k.label })),
    layer: "III",
    asOf: isoDay(new Date()),
    source: sourceLine(s.user.full_name, org, new Date()),
    figures: mentionedFigures(text),
    lookAlikes: alike.map(c => ({ id: c.id, statement: c.statement, kindLabel: CARD_KIND_MAP[c.kind]?.label ?? c.kind, verified: c.status === "verified" })),
    problem: userCardProblem(text),
  };
}

export type SaveUserCardResult = { ok: true; cardId: string; version: number } | { ok: false; error: string; existingId?: string };

/** Save a user-generated Story Card: the Writer's note first, then the card that quotes it. */
export async function saveUserCardAction(input: {
  text: string; kind: string; layer: "I" | "II" | "III"; asOf: string | null;
  saidBy?: string | null; fromDocument?: string | null; draftId?: string | null; sectionId?: string | null;
}): Promise<SaveUserCardResult> {
  const s = await writer();
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

/** A client confirms a card For Granted wrote about them. */
export async function confirmUserCardAction(cardId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  const { data: c } = await db.from("story_card").select("id, created_from, written_by_role").eq("tenant_id", s.tenantId).eq("id", cardId).maybeSingle();
  if (!c || c.created_from !== "manual") return { ok: false, error: "That card could not be found." };
  const { error } = await db.from("story_card").update({ client_confirmed_at: new Date().toISOString(), client_confirmed_by: s.user.id })
    .eq("tenant_id", s.tenantId).eq("id", cardId);
  if (error) return { ok: false, error: "Could not record that. Please try again." };
  revalidatePath("/story-cards");
  return { ok: true };
}
