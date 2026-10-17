import "server-only";
// What the Document Reader shows (Phase 1; /documents/<id>).
//
// One read for the page: the document, its stored text (lib/server/doc-text.ts)
// and where each Story Card's quote sits in it (lib/locate.ts), filtered by
// what this person may see (lib/reader-features.ts). The switches are checked
// HERE, on the server, so a feature switched off for a client is never sent to
// the page at all: no card, no quote, no draft name.
//
// The document is resolved under RLS (userClient), so a client reaches only its
// own documents. Everything after that is read with the service client and
// scoped to the document's own tenant, which is the session's (an admin viewing
// another client's document is asked to switch to that client first).
import { db } from "./db";
import { userClient } from "./supabase";
import { storedText } from "./doc-text";
import { getWorkspaceVisibility } from "./data";
import { toLibraryCard, type LibraryCard } from "./card-library";
import type { PortalSession } from "./session";
import { CARD_KIND_MAP } from "@/lib/story-card";
import { DOC_TYPE_MAP } from "@/lib/analysis";
import { pageAt, type PageSpan } from "@/lib/doc-text";
import { locateQuote, prepare, type Span } from "@/lib/locate";
import { READER_FEATURES, readerAccess, readerSwitches, type ReaderAccess, type ReaderFeatureKey } from "@/lib/reader-features";

export const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };

export interface ReaderUse { draftId: string; draftTitle: string; question: number; sectionId: string }

export interface ReaderCard {
  id: string;
  kind: string;
  kindLabel: string;
  statement: string;
  layer: "I" | "II" | "III" | null;
  status: "suggested" | "verified" | "retired";
  verifiedByRole: "admin" | "client" | null;
  /** The quote this card was read from, in this document. */
  quote: string;
  /** Where it sits; empty when it could not be placed. */
  spans: Span[];
  /** How many places in the text the quote matches (more than one: the nearest was chosen). */
  places: number;
  page: number | null;
  /** The card's sources in other documents, for "also from". */
  otherSources: { documentId: string; title: string }[];
  /** Only when links to drafts are allowed for this person. */
  usedIn: ReaderUse[];
}

export interface ReaderData {
  doc: {
    id: string; title: string; layer: string | null; layerName: string | null;
    typeLabel: string | null; docKind: string; pageCount: number | null; won: boolean;
  };
  text: string;
  pages: PageSpan[];
  /** "rebuilt": the backfill has not reached this document; the text is rebuilt from its passages. */
  textSource: "stored" | "rebuilt";
  access: ReaderAccess;
  /** Cards placed in the text, in reading order. */
  placed: ReaderCard[];
  /** Cards whose quote is no longer in the text. */
  unplaced: ReaderCard[];
  /** For Granted: each card as the Card Library shows it, for the same review card. */
  library: Record<string, LibraryCard>;
  /** Where to open: a card, or a passage (a readiness source). */
  focus: { cardId: string | null; span: Span | null; label: string | null };
}

export type ReaderResult =
  | { kind: "ok"; data: ReaderData }
  | { kind: "missing" }
  | { kind: "other_client"; tenantId: string; tenantName: string }
  | { kind: "not_ready"; title: string; status: string };

/** The client's reader switches as stored (no defaults applied). */
export async function readerRows(tenantId: string): Promise<Record<string, boolean>> {
  const { data } = await db.from("feature_visibility").select("feature_key, visible")
    .eq("tenant_id", tenantId).in("feature_key", READER_FEATURES.map(f => f.key));
  return Object.fromEntries(((data ?? []) as { feature_key: string; visible: boolean }[]).map(r => [r.feature_key, r.visible]));
}

/** What this session may do in the reader for its own tenant. */
export async function accessFor(session: PortalSession): Promise<ReaderAccess> {
  if (session.role === "admin") return readerAccess(true, {}, {});
  const [rows, ws] = await Promise.all([readerRows(session.tenantId), getWorkspaceVisibility(session.tenantId)]);
  return readerAccess(false, rows, ws);
}

/** The switches as the activity page shows them, for one client. Admin only: the caller checks. */
export async function readerSwitchesFor(tenantId: string): Promise<{ switches: Record<ReaderFeatureKey, boolean>; workspace: Record<string, boolean> }> {
  const [rows, ws] = await Promise.all([readerRows(tenantId), getWorkspaceVisibility(tenantId)]);
  return { switches: readerSwitches(rows, ws), workspace: ws };
}

/** Text rebuilt from passages, for a document the backfill has not reached (as the old viewer did). */
async function rebuiltText(tenantId: string, documentId: string): Promise<string> {
  const { data: chunks } = await db.from("document_chunk").select("text, char_start, char_end")
    .eq("tenant_id", tenantId).eq("document_id", documentId).order("char_start");
  let text = "";
  let coveredEnd = 0;
  for (const c of (chunks ?? []) as { text: string; char_start: number; char_end: number }[]) {
    if (c.char_end <= coveredEnd) continue;
    const overlap = Math.max(0, coveredEnd - c.char_start);
    text += c.text.slice(overlap);
    coveredEnd = c.char_end;
  }
  return text.trim();
}

type CardRow = Record<string, unknown> & {
  id: string; kind: string; statement: string; layer: string | null; status: string; verified_by_role: string | null;
  story_card_evidence: { document_id: string; quote: string; speaker: string | null; document: { title: string; layer: string | null; status: string } | null }[];
};

export async function getReaderData(
  session: PortalSession, documentId: string, opts: { card?: string | null; item?: string | null } = {},
): Promise<ReaderResult> {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return { kind: "missing" };
  const s = await userClient();
  const { data: doc } = await s.from("document")
    .select("id, tenant_id, title, layer, doc_kind, status, type_tag, outcome")
    .eq("id", documentId).maybeSingle();
  if (!doc) return { kind: "missing" };
  if (doc.tenant_id !== session.tenantId) {
    // Only an admin's RLS reaches another client's document.
    if (session.role !== "admin") return { kind: "missing" };
    const { data: t } = await s.from("tenant").select("name").eq("id", doc.tenant_id).maybeSingle();
    return { kind: "other_client", tenantId: doc.tenant_id as string, tenantName: (t?.name as string) ?? "another client" };
  }
  if (doc.status !== "ready") return { kind: "not_ready", title: doc.title as string, status: doc.status as string };
  const tenantId = session.tenantId;
  const access = await accessFor(session);

  const stored = await storedText(tenantId, documentId);
  const text = stored ? stored.text : await rebuiltText(tenantId, documentId);
  const pages = stored ? stored.pages.filter(p => p.page !== null) : [];
  const typeTag = (doc.type_tag as string | null) ?? null;

  const data: ReaderData = {
    doc: {
      id: documentId, title: doc.title as string, layer: (doc.layer as string | null) ?? null,
      layerName: doc.layer ? LAYER_NAME[doc.layer as string] ?? null : null,
      typeLabel: typeTag ? DOC_TYPE_MAP[typeTag]?.label ?? null : null,
      docKind: doc.doc_kind as string, pageCount: pages.length || null, won: doc.outcome === "won",
    },
    text, pages, textSource: stored ? "stored" : "rebuilt", access,
    placed: [], unplaced: [], library: {},
    focus: { cardId: null, span: null, label: null },
  };

  const prepared = prepare(text);

  // A readiness source opened at its passage (?item=<checklist key>).
  if (opts.item && /^[a-z0-9_]{1,60}$/.test(opts.item)) {
    const { data: gap } = await db.from("eligibility_gap").select("content_gaps").eq("tenant_id", tenantId).maybeSingle();
    const entry = (gap?.content_gaps as Record<string, { sources?: { id: string; quote?: string }[] }> | null)?.[opts.item];
    const quote = entry?.sources?.find(x => x.id === documentId)?.quote;
    if (quote) {
      const l = locateQuote(prepared, quote);
      if (l.status === "found") data.focus = { cardId: null, span: { start: l.spans[0].start, end: l.spans[l.spans.length - 1].end }, label: "The passage the readiness check used" };
    }
  }

  if (!access.highlights) return { kind: "ok", data };

  // The cards drawn from this document. Clients read their own by RLS (0043).
  const { data: evRows } = await s.from("story_card_evidence").select("card_id")
    .eq("tenant_id", tenantId).eq("document_id", documentId);
  const ids = [...new Set(((evRows ?? []) as { card_id: string }[]).map(r => r.card_id))];
  if (!ids.length) return { kind: "ok", data };
  let cq = s.from("story_card")
    .select("*, story_card_evidence(document_id, quote, speaker, document:document_id(title, layer, status))")
    .eq("tenant_id", tenantId).in("id", ids);
  if (!access.showRetired) cq = cq.neq("status", "retired");
  const { data: cardRows } = await cq;
  const rows = (cardRows ?? []) as CardRow[];

  // Where each card is used in a draft, only when that is allowed.
  const usedBy = new Map<string, ReaderUse[]>();
  if (access.draftLinks && rows.length) {
    const { data: blocks } = await db.from("section_block").select("card_id, section_id")
      .eq("tenant_id", tenantId).in("card_id", rows.map(r => r.id));
    const sectionIds = [...new Set(((blocks ?? []) as { section_id: string }[]).map(b => b.section_id))];
    if (sectionIds.length) {
      const { data: secs } = await db.from("draft_section").select("id, draft_id")
        .eq("tenant_id", tenantId).in("id", sectionIds);
      const draftIds = [...new Set(((secs ?? []) as { draft_id: string }[]).map(x => x.draft_id))];
      const [{ data: drafts }, { data: allSecs }] = await Promise.all([
        db.from("grant_draft").select("id, title").eq("tenant_id", tenantId).in("id", draftIds),
        db.from("draft_section").select("id, draft_id, sort_order").eq("tenant_id", tenantId).in("draft_id", draftIds),
      ]);
      const title = new Map(((drafts ?? []) as { id: string; title: string }[]).map(d => [d.id, d.title]));
      const position = new Map<string, number>();
      const byDraft = new Map<string, { id: string; sort_order: number }[]>();
      for (const x of (allSecs ?? []) as { id: string; draft_id: string; sort_order: number }[]) {
        byDraft.set(x.draft_id, [...(byDraft.get(x.draft_id) ?? []), x]);
      }
      for (const list of byDraft.values()) list.sort((a, b) => a.sort_order - b.sort_order).forEach((x, i) => position.set(x.id, i + 1));
      const draftOf = new Map(((secs ?? []) as { id: string; draft_id: string }[]).map(x => [x.id, x.draft_id]));
      for (const b of (blocks ?? []) as { card_id: string; section_id: string }[]) {
        const draftId = draftOf.get(b.section_id);
        if (!draftId || !title.has(draftId)) continue;
        const list = usedBy.get(b.card_id) ?? [];
        if (!list.some(u => u.sectionId === b.section_id)) {
          list.push({ draftId, draftTitle: title.get(draftId)!, question: position.get(b.section_id) ?? 0, sectionId: b.section_id });
        }
        usedBy.set(b.card_id, list);
      }
    }
  }

  for (const r of rows) {
    const here = r.story_card_evidence.find(e => e.document_id === documentId);
    if (!here) continue;
    const l = locateQuote(prepared, here.quote);
    const spans = l.status === "found" ? l.spans : [];
    const card: ReaderCard = {
      id: r.id, kind: r.kind, kindLabel: CARD_KIND_MAP[r.kind]?.label ?? r.kind, statement: r.statement,
      layer: (r.layer === "I" || r.layer === "II" || r.layer === "III") ? r.layer : null,
      status: r.status as ReaderCard["status"],
      verifiedByRole: (r.verified_by_role as ReaderCard["verifiedByRole"]) ?? null,
      quote: here.quote, spans, places: l.status === "found" ? l.places : 0,
      page: spans.length && pages.length ? pageAt(pages, spans[0].start) : null,
      otherSources: r.story_card_evidence
        .filter(e => e.document_id !== documentId && e.document?.status === "ready")
        .map(e => ({ documentId: e.document_id, title: e.document?.title ?? "Untitled" })),
      usedIn: (usedBy.get(r.id) ?? []).sort((a, b) => a.draftTitle.localeCompare(b.draftTitle) || a.question - b.question),
    };
    (spans.length ? data.placed : data.unplaced).push(card);
    if (access.admin) data.library[r.id] = toLibraryCard(r);
  }
  data.placed.sort((a, b) => a.spans[0].start - b.spans[0].start || a.spans[0].end - b.spans[0].end);
  data.unplaced.sort((a, b) => a.kindLabel.localeCompare(b.kindLabel));

  if (opts.card && (data.placed.some(c => c.id === opts.card) || data.unplaced.some(c => c.id === opts.card))) {
    data.focus = { cardId: opts.card, span: null, label: null };
  }
  return { kind: "ok", data };
}
