// Merging each document's candidates into the Card Library: the pure half.
//
// remergeLibrary() in lib/server/card-extract.ts reads the stored candidates and
// the current library, calls planMerge(), and writes what it says. Every rule
// about what a rebuild may and may not do to a card lives here, where it can be
// tested without a database:
//
//   - A new claim becomes a SUGGESTED card. Nothing is ever verified by a merge.
//   - An existing card gains or loses evidence, and its strength, layer,
//     figures and subject follow its evidence.
//   - A card's identity is its fingerprint, or failing that its PROOF: a
//     reworded claim of the same kind, proven by a quote already on record from
//     the same document, is the same card. Wording drifts between reads; a
//     verbatim quote does not.
//   - A human-edited statement is never touched (this module never writes
//     statements of existing cards at all).
//   - A card an admin merged forwards its evidence to the card it was merged
//     into, so the merge survives every later rebuild.
//   - A card left with no evidence is RETIRED as source_removed, never deleted,
//     and comes back as suggested if its evidence returns. A card retired by a
//     person for any other reason stays retired.
//   - Possible duplicates are flagged, never merged.
import {
  CARD_KIND_MAP, cardFingerprint, normalizeText, displayLayer, strongest, findPossibleDuplicates,
  type CardLayer, type CardStrength,
} from "./story-card";

export interface MergeCandidate {
  kind: string; statement: string; quote: string;
  subject: "organization" | "third_party"; strength: CardStrength;
  hasFigures?: boolean; speaker?: string | null; layer?: string | null;
}

export interface MergeCard {
  id: string; kind: string; statement: string; fingerprint: string;
  status: "suggested" | "verified" | "retired"; retired_reason: string | null;
  merged_into: string | null; created_from: string; created_at: string;
  duplicate_dismissed: boolean; possible_duplicate_of: string | null;
  strength: string; layer: string | null; has_figures: boolean; subject: string;
}

export interface MergeEvidence { id: string; card_id: string; document_id: string; quote: string }

/** A card that does not exist yet is referred to as NEW + its fingerprint until it is inserted. */
export const NEW = "new:";

export interface PlannedEvidence {
  target: string;            // an existing card id, or NEW + fingerprint
  documentId: string; quote: string; speaker: string | null;
}

export interface CardPatch {
  strength: CardStrength; layer: CardLayer | null; has_figures: boolean;
  subject: "organization" | "third_party";
  status: "suggested" | "verified" | "retired"; retired_reason: string | null;
  possible_duplicate_of: string | null;
}

export interface MergePlan {
  create: { fingerprint: string; kind: string; statement: string; itemKey: string | null; patch: CardPatch }[];
  /** Existing cards whose derived fields change. Only the fields in CardPatch are ever written. */
  update: { id: string; patch: CardPatch }[];
  evidence: PlannedEvidence[];
  dropEvidence: string[];
  summary: { cards: number; created: number; revived: number; retired: number; evidence: number; duplicates: number };
}

interface Ev { documentId: string; quote: string; speaker: string | null; layer: string | null; strength: CardStrength; hasFigures: boolean; subject: "organization" | "third_party" }

const derive = (ev: Ev[]) => ({
  strength: ev.reduce<CardStrength>((s, e) => strongest(s, e.strength), "thin"),
  layer: displayLayer(ev.map(e => e.layer)),
  has_figures: ev.some(e => e.hasFigures),
  subject: (ev.some(e => e.subject === "organization") ? "organization" : "third_party") as "organization" | "third_party",
});

export function planMerge(input: {
  docs: { documentId: string; candidates: MergeCandidate[] }[];
  cards: MergeCard[];
  evidence: MergeEvidence[];
}): MergePlan {
  // 1. Group every document's candidates by claim.
  const groups = new Map<string, { kind: string; statement: string; ev: Ev[] }>();
  for (const d of input.docs) {
    for (const c of d.candidates ?? []) {
      if (!CARD_KIND_MAP[c.kind]) continue;
      const fp = cardFingerprint(c.kind, c.statement);
      const g = groups.get(fp) ?? { kind: c.kind, statement: c.statement, ev: [] };
      // A new card starts with the first SPECIFIC wording found.
      if (c.strength === "covered" && !g.ev.some(e => e.strength === "covered")) g.statement = c.statement;
      if (!g.ev.some(e => e.documentId === d.documentId)) {
        g.ev.push({
          documentId: d.documentId, quote: c.quote, speaker: c.speaker ?? null, layer: c.layer ?? null,
          strength: c.strength, hasFigures: !!c.hasFigures, subject: c.subject,
        });
      }
      groups.set(fp, g);
    }
  }

  const byId = new Map(input.cards.map(c => [c.id, c]));
  const byFp = new Map(input.cards.map(c => [c.fingerprint, c]));
  const byProof = new Map<string, string>();
  for (const e of input.evidence) byProof.set(`${e.document_id}|${normalizeText(e.quote)}`, e.card_id);

  // 2. Which existing card each claim belongs to, by fingerprint or by proof.
  const owner = new Map<string, MergeCard>();
  for (const [fp, g] of groups) {
    const direct = byFp.get(fp);
    if (direct) { owner.set(fp, direct); continue; }
    for (const e of g.ev) {
      const id = byProof.get(`${e.documentId}|${normalizeText(e.quote)}`);
      const card = id ? byId.get(id) : undefined;
      if (card && card.kind === g.kind) { owner.set(fp, card); break; }
    }
  }

  // Follow an admin's merges. Bounded, so a hand-written cycle cannot hang a build.
  const resolve = (c: MergeCard): MergeCard => {
    let cur = c;
    for (let i = 0; i < 5 && cur.merged_into; i++) {
      const next = byId.get(cur.merged_into);
      if (!next) break;
      cur = next;
    }
    return cur;
  };

  // 3. Evidence per target.
  const evByTarget = new Map<string, Ev[]>();
  const add = (target: string, ev: Ev[]) => {
    const list = evByTarget.get(target) ?? [];
    for (const e of ev) if (!list.some(x => x.documentId === e.documentId)) list.push(e);
    evByTarget.set(target, list);
  };
  const create: MergePlan["create"] = [];
  for (const [fp, g] of groups) {
    const o = owner.get(fp);
    if (o) { add(resolve(o).id, g.ev); continue; }
    add(NEW + fp, g.ev);
    create.push({
      fingerprint: fp, kind: g.kind, statement: g.statement,
      itemKey: CARD_KIND_MAP[g.kind]?.itemKey ?? null,
      patch: { ...derive(g.ev), status: "suggested", retired_reason: null, possible_duplicate_of: null },
    });
  }

  // 4. Existing cards: derived fields, revival, retirement.
  let revived = 0; let retired = 0;
  const patched = new Map<string, CardPatch>();
  for (const c of input.cards) {
    const ev = evByTarget.get(c.id) ?? [];
    const base: CardPatch = {
      strength: c.strength === "covered" ? "covered" : "thin",
      layer: (c.layer === "I" || c.layer === "II" || c.layer === "III") ? c.layer : null,
      has_figures: c.has_figures,
      subject: c.subject === "third_party" ? "third_party" : "organization",
      status: c.status, retired_reason: c.retired_reason,
      possible_duplicate_of: c.possible_duplicate_of,
    };
    const next: CardPatch = { ...base };
    if (ev.length) {
      Object.assign(next, derive(ev));
      if (c.status === "retired" && c.retired_reason === "source_removed") {
        next.status = "suggested"; next.retired_reason = null; revived += 1;
      }
    } else if (c.status !== "retired" && c.created_from === "extraction" && !c.merged_into) {
      next.status = "retired"; next.retired_reason = "source_removed"; retired += 1;
    }
    patched.set(c.id, next);
  }

  // 5. Possible duplicates among live cards, new ones counted as newest.
  const live = [
    ...input.cards.filter(c => patched.get(c.id)!.status !== "retired").map(c => ({
      id: c.id, kind: c.kind, statement: c.statement, createdAt: c.created_at, dismissed: c.duplicate_dismissed,
    })),
    ...create.map(n => ({
      id: NEW + n.fingerprint, kind: n.kind, statement: n.statement, createdAt: "9999-12-31", dismissed: false,
    })),
  ];
  const dups = findPossibleDuplicates(live);
  for (const c of input.cards) {
    const p = patched.get(c.id)!;
    p.possible_duplicate_of = p.status === "retired" ? null : (dups.get(c.id) ?? null);
  }
  for (const n of create) n.patch.possible_duplicate_of = dups.get(NEW + n.fingerprint) ?? null;

  const update: MergePlan["update"] = [];
  const same = (a: CardPatch, c: MergeCard) =>
    a.strength === c.strength && a.layer === c.layer && a.has_figures === c.has_figures && a.subject === c.subject
    && a.status === c.status && a.retired_reason === c.retired_reason && a.possible_duplicate_of === c.possible_duplicate_of;
  for (const c of input.cards) {
    const p = patched.get(c.id)!;
    if (!same(p, c)) update.push({ id: c.id, patch: p });
  }

  // 6. Evidence rows wanted, and rows to drop.
  const evidence: PlannedEvidence[] = [...evByTarget.entries()].flatMap(([target, list]) =>
    list.map(e => ({ target, documentId: e.documentId, quote: e.quote, speaker: e.speaker })));
  const want = new Set(evidence.filter(e => !e.target.startsWith(NEW)).map(e => `${e.target}|${e.documentId}`));
  const dropEvidence = input.evidence.filter(e => !want.has(`${e.card_id}|${e.document_id}`)).map(e => e.id);

  const liveExisting = input.cards.filter(c => patched.get(c.id)!.status !== "retired").length;
  return {
    create, update, evidence, dropEvidence,
    summary: {
      cards: liveExisting + create.length, created: create.length, revived, retired,
      evidence: evidence.length, duplicates: dups.size,
    },
  };
}
