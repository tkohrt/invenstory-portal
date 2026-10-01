import "server-only";
// Reading a card-mode draft for the drafting workspace (Story Card Drafter,
// Phase 3: Arrange).
//
// Through userClient, so the reads run under RLS as the signed-in admin. Every
// table here is admin-only by policy (0039, 0041, 0042), and every query still
// names the tenant: an admin's RLS sees every client, and the page shows one.
//
// What the page gets is the whole working set for one application: its
// questions, the blocks already placed, and the client's live Card Library with
// each card's evidence. Ranking happens in the browser with the pure
// lib/story-card-rank.ts, so placing a card re-ranks the panel at once and the
// position logged with a `shown` event is the position the writer saw.
import { userClient } from "./supabase";
import { CARD_KIND_MAP } from "@/lib/story-card";
import type { RankCard } from "@/lib/story-card-rank";

export interface WsEvidence { title: string; layer: string | null; quote: string; speaker: string | null }

export interface WsCard extends RankCard {
  kindLabel: string;
  version: number;
  newestSource: string | null;
  subject: "organization" | "third_party";
  /** 0043: an identifiable person's protected information, and whether a person has decided it. */
  sensitive: boolean; sensitiveReason: string | null;
  sensitiveCleared: "consent" | "deidentified" | "not_sensitive" | null;
  evidence: WsEvidence[];
}

export interface WsBlock {
  id: string;
  sectionId: string;
  kind: "card" | "bridge" | "human";
  cardId: string | null;
  cardVersion: number | null;
  /** The text as it reads in this draft: the edit if edited, else the placed version's wording. */
  text: string;
  edited: boolean;
  breakBefore: boolean;
}

export interface WsSection {
  id: string;
  sortOrder: number;
  prompt: string;
  guidance: string | null;
  criteria: string | null;
  limitValue: number | null;
  limitUnit: "words" | "characters" | null;
  slugs: string[];
  wantedKinds: string[];
  status: "empty" | "drafting" | "done";
  createdAt: string;
}

/** A client's approved standard answer, by bank slug. */
export interface WsStandard {
  slug: string;
  answerId: string;
  /** The Standard Answers section it was built from, when it was built from cards. */
  sectionId: string | null;
  text: string;
  approvedAt: string | null;
}

export interface Workspace {
  purpose: "application" | "standard_answers";
  sections: WsSection[];
  blocks: WsBlock[];
  cards: WsCard[];
  standards: WsStandard[];
  /** Bank question stats by slug, for recommending Standard Answers sections. */
  bank: Record<string, { origin: "seed" | "observed"; observed: number }>;
}

type Raw = Record<string, unknown>;

/**
 * Resolve the text of a set of block rows.
 *
 * A card block stores text only when it was edited in this draft (spec 3.2).
 * Otherwise its words are the card's wording AT THE VERSION IT WAS PLACED, read
 * from story_card_version, so a later edit in the library never silently
 * rewrites an answer someone already arranged. The page offers the newer wording
 * instead.
 */
export async function resolveBlocks(tenantId: string, rows: Raw[]): Promise<WsBlock[]> {
  const s = await userClient();
  const want = rows.filter(r => r.kind === "card" && !r.edited && r.card_id);
  const texts = new Map<string, string>();
  if (want.length) {
    const ids = [...new Set(want.map(r => r.card_id as string))];
    const { data, error } = await s.from("story_card_version").select("card_id, version, statement")
      .eq("tenant_id", tenantId).in("card_id", ids);
    if (error) throw new Error(`Could not read card wording: ${error.message}`);
    for (const v of (data ?? []) as { card_id: string; version: number; statement: string }[]) {
      texts.set(`${v.card_id}:${v.version}`, v.statement);
    }
  }
  return rows.map(r => {
    const edited = !!r.edited;
    const text = r.kind === "card" && !edited
      ? texts.get(`${r.card_id}:${r.card_version}`) ?? (r.text as string | null) ?? ""
      : (r.text as string | null) ?? "";
    return {
      id: r.id as string, sectionId: r.section_id as string, kind: r.kind as WsBlock["kind"],
      cardId: (r.card_id as string | null) ?? null, cardVersion: (r.card_version as number | null) ?? null,
      text, edited, breakBefore: !!r.break_before,
    };
  });
}

export const BLOCK_COLS = "id, section_id, sort_order, kind, card_id, card_version, text, edited, break_before";


/** The client's live cards, with what ranking and placement need. */
export async function loadCards(tenantId: string): Promise<WsCard[]> {
  const s = await userClient();
  const { data: cardRows, error: cErr } = await s.from("story_card")
      .select("id, kind, item_key, strength, status, layer, subject, statement, version, sensitive, sensitive_reason, sensitive_cleared, story_card_evidence(quote, speaker, document:document_id(title, layer, status, created_at))")
      .eq("tenant_id", tenantId).neq("status", "retired");
  if (cErr) throw new Error(`Could not read the Card Library: ${cErr.message}`);
  type Ev = { quote: string; speaker: string | null; document: { title: string; layer: string | null; status: string; created_at: string } | null };
  return ((cardRows ?? []) as Raw[]).map(r => {
    const ev = ((r.story_card_evidence as Ev[]) ?? []).filter(e => e.document?.status === "ready");
    const newest = ev.reduce<Ev | null>((a, e) => (!a || (e.document!.created_at > a.document!.created_at) ? e : a), null);
    return {
      id: r.id as string, kind: r.kind as string, kindLabel: CARD_KIND_MAP[r.kind as string]?.label ?? (r.kind as string),
      itemKey: (r.item_key as string | null) ?? null, strength: r.strength as WsCard["strength"],
      status: r.status as WsCard["status"], layer: (r.layer as WsCard["layer"]) ?? null,
      subject: r.subject as WsCard["subject"], statement: r.statement as string, version: r.version as number,
      sensitive: !!r.sensitive, sensitiveReason: (r.sensitive_reason as string | null) ?? null,
      sensitiveCleared: (r.sensitive_cleared as WsCard["sensitiveCleared"]) ?? null,
      // The upload date of the newest document behind the card: the closest the
      // portal holds to "how current is this evidence". A document's own date is
      // not recorded anywhere yet.
      newestEvidenceAt: newest?.document?.created_at ?? null,
      newestSource: newest?.document?.title ?? null,
      evidence: ev.map(e => ({ title: e.document!.title, layer: e.document!.layer, quote: e.quote, speaker: e.speaker })),
    };
  });
}

export async function getWorkspace(tenantId: string, draftId: string): Promise<Workspace> {
  const s = await userClient();

  const [{ data: draft }, { data: secRows, error: sErr }, cards, { data: ansRows }, { data: bankRows }] = await Promise.all([
    s.from("grant_draft").select("purpose").eq("tenant_id", tenantId).eq("id", draftId).maybeSingle(),
    s.from("draft_section")
      .select("id, sort_order, prompt, guidance, criteria, limit_value, limit_unit, question_slugs, wanted_kinds, status, created_at")
      .eq("tenant_id", tenantId).eq("draft_id", draftId).order("sort_order"),
    loadCards(tenantId),
    s.from("answer")
      .select("id, long_answer, status, source, reviewed_at, draft_section_id, question:question_id(slug)")
      .eq("tenant_id", tenantId).eq("status", "published"),
    s.from("grant_question").select("slug, origin, observed"),
  ]);
  if (sErr) throw new Error(`Could not read the questions: ${sErr.message}`);

  const sections: WsSection[] = ((secRows ?? []) as Raw[]).map(r => ({
    id: r.id as string, sortOrder: r.sort_order as number, prompt: r.prompt as string,
    guidance: (r.guidance as string | null) ?? null, criteria: (r.criteria as string | null) ?? null,
    limitValue: (r.limit_value as number | null) ?? null, limitUnit: (r.limit_unit as WsSection["limitUnit"]) ?? null,
    slugs: (r.question_slugs as string[]) ?? [], wantedKinds: (r.wanted_kinds as string[]) ?? [],
    status: (r.status as WsSection["status"]) ?? "empty",
    createdAt: (r.created_at as string | null) ?? "",
  }));

  let blocks: WsBlock[] = [];
  if (sections.length) {
    const { data: bRows, error: bErr } = await s.from("section_block").select(BLOCK_COLS)
      .eq("tenant_id", tenantId).in("section_id", sections.map(x => x.id)).order("sort_order");
    if (bErr) throw new Error(`Could not read the answers: ${bErr.message}`);
    blocks = await resolveBlocks(tenantId, (bRows ?? []) as Raw[]);
  }

  const standards: WsStandard[] = ((ansRows ?? []) as Raw[])
    .filter(r => (r.question as { slug?: string } | null)?.slug && r.long_answer)
    .map(r => ({
      slug: (r.question as { slug: string }).slug, answerId: r.id as string,
      sectionId: (r.draft_section_id as string | null) ?? null, text: r.long_answer as string,
      approvedAt: (r.reviewed_at as string | null) ?? null,
    }));

  const bank: Record<string, { origin: "seed" | "observed"; observed: number }> = Object.fromEntries(
    ((bankRows ?? []) as { slug: string; origin: "seed" | "observed"; observed: number }[]).map(q => [q.slug, { origin: q.origin, observed: q.observed }]));
  return { purpose: ((draft?.purpose as Workspace["purpose"]) ?? "application"), sections, blocks, cards, standards, bank };
}

/** The client's Standard Answers draft, if it has been opened before. */
export async function getStandardAnswersId(tenantId: string): Promise<string | null> {
  const s = await userClient();
  const { data } = await s.from("grant_draft").select("id")
    .eq("tenant_id", tenantId).eq("purpose", "standard_answers").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
