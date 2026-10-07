import "server-only";
// Reading the trial analysis for the admin page.
//
// Through userClient, so the reads run under RLS as the signed-in admin
// (analysis_doc and analysis_review are admin-only by policy, 0048), and every
// query names the tenant, because an admin's RLS sees every client.
//
// Everything shown is assembled here from what each document produced, with
// no model call: the would-be Card Library, the facts by key, the review
// sample and its tally. Changing how they are assembled is free.
import { userClient } from "./supabase";
import { listRefusals, type RefusalListing } from "./refusals";
import { withoutRefused } from "@/lib/refusal";
import { REJECT_LABEL } from "@/lib/story-card";
import {
  DOC_TYPE_MAP, previewLibrary, summarizeFacts, reviewSample, reviewTally, reviewTarget, duplicatePairs, rejectionLabel,
  type AnalysisCard, type AnalysisFact, type AnalysisRejection, type PreviewCard, type FactSummary,
  type ReviewTally, type ReviewMark,
} from "@/lib/analysis";

export interface TrialDoc {
  id: string; title: string; layer: string | null; docKind: string | null;
  /** The type a person gave it (decision 33), or null. */
  typeTag: string | null;
  /** Null when the document has not been analysed yet. */
  read: null | {
    docType: string | null; docTypeLabel: string; docTypeReason: string | null; docTypeQuote: string | null;
    docTypeProven: boolean; skipped: "boilerplate" | "empty" | null;
    cards: AnalysisCard[]; facts: AnalysisFact[];
    rejected: (AnalysisRejection & { label: string })[];
    windows: number; chars: number; extractedAt: string;
  };
}

export interface TrialReview extends ReviewMark { fingerprint: string; note: string | null; reviewedAt: string }

/** A remembered refusal, with the cards it is holding back from the current read. */
export interface TrialRefusal extends RefusalListing {
  blocking: { documentId: string; kind: string; statement: string; quote: string }[];
}

export interface AnalysisTrialData {
  docs: TrialDoc[];
  progress: { done: number; total: number };
  /**
   * Everything the read produced, merged. The Review samples THIS, refused cards
   * included: the gate judges the reader, and leaving out the cards a person
   * already caught would flatter it.
   */
  library: PreviewCard[];
  /** The library as it would go live: without cards resting on a refused quote (decisions 19 and 31). */
  liveLibrary: PreviewCard[];
  /** Every remembered refusal for this client, lifted ones included. */
  remembered: TrialRefusal[];
  facts: FactSummary[];
  sample: PreviewCard[];
  reviews: Record<string, TrialReview>;
  tally: ReviewTally;
  /** Every flagged possible-duplicate pair, with a person's decision when there is one. */
  pairs: { card: PreviewCard; other: PreviewCard; same: boolean | null }[];
  /** The current reads, for reference beside the trial. Phase B compares them properly. */
  current: { liveCards: number };
  refusals: { reason: string; label: string; count: number }[];
}

export async function getAnalysisTrial(tenantId: string): Promise<AnalysisTrialData> {
  const s = await userClient();
  const [{ data: docRows, error: dErr }, { data: readRows, error: rErr }, { data: revRows }, { count: liveCards }, { data: dupRows }] = await Promise.all([
    s.from("document").select("*").eq("tenant_id", tenantId).eq("status", "ready").order("title"),
    s.from("analysis_doc").select("*").eq("tenant_id", tenantId),
    s.from("analysis_review").select("fingerprint, verdict, competitor, duplicate, note, reviewed_at").eq("tenant_id", tenantId),
    s.from("story_card").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).neq("status", "retired"),
    s.from("analysis_dup_review").select("card_fp, other_fp, same").eq("tenant_id", tenantId),
  ]);
  if (dErr) throw new Error(`document read failed: ${dErr.message}`);
  if (rErr) throw new Error(`analysis read failed: ${rErr.message}`);

  const reads = new Map(((readRows ?? []) as Record<string, unknown>[]).map(r => [r.document_id as string, r]));
  const docs: TrialDoc[] = ((docRows ?? []) as { id: string; title: string; layer: string | null; doc_kind: string | null; type_tag?: string | null }[]).map(d => {
    const r = reads.get(d.id);
    if (!r) return { id: d.id, title: d.title, layer: d.layer, docKind: d.doc_kind, typeTag: d.type_tag ?? null, read: null };
    const hash = r.content_hash as string;
    const type = (r.doc_type as string | null) ?? null;
    return {
      id: d.id, title: d.title, layer: d.layer, docKind: d.doc_kind, typeTag: d.type_tag ?? null,
      read: {
        docType: type,
        docTypeLabel: type ? DOC_TYPE_MAP[type]?.label ?? type : "Not recognised",
        docTypeReason: (r.doc_type_reason as string | null) ?? null,
        docTypeQuote: (r.doc_type_quote as string | null) ?? null,
        docTypeProven: !!r.doc_type_proven,
        skipped: hash === "boilerplate" || hash === "empty" ? hash : null,
        cards: (r.cards as AnalysisCard[]) ?? [],
        facts: (r.facts as AnalysisFact[]) ?? [],
        rejected: ((r.rejected as AnalysisRejection[]) ?? []).map(x => ({ ...x, label: rejectionLabel(x.reason, REJECT_LABEL) })),
        windows: (r.windows as number) ?? 0,
        chars: (r.chars as number) ?? 0,
        extractedAt: r.extracted_at as string,
      },
    };
  });

  const readDocs = docs.filter(d => d.read);
  const readCards = readDocs.map(d => ({ documentId: d.id, cards: d.read!.cards }));
  const library = previewLibrary(readCards);
  const listed = await listRefusals(tenantId);
  const filtered = withoutRefused(readCards, listed.filter(r => !r.liftedAt));
  const liveLibrary = filtered.blocked.length ? previewLibrary(filtered.docs) : library;
  const remembered: TrialRefusal[] = listed.map(r => ({
    ...r,
    blocking: filtered.blocked.filter(b => b.refusal.id === r.id)
      .map(b => ({ documentId: b.documentId, kind: b.card.kind, statement: b.card.statement, quote: b.card.quote })),
  }));
  const facts = summarizeFacts(readDocs.map(d => ({ documentId: d.id, facts: d.read!.facts })));

  const reviews: Record<string, TrialReview> = {};
  for (const r of (revRows ?? []) as { fingerprint: string; verdict: ReviewMark["verdict"]; competitor: boolean; duplicate: boolean; note: string | null; reviewed_at: string }[]) {
    reviews[r.fingerprint] = { fingerprint: r.fingerprint, verdict: r.verdict, competitor: r.competitor, duplicate: r.duplicate, note: r.note, reviewedAt: r.reviewed_at };
  }
  const sample = reviewSample(library, tenantId, new Set(Object.keys(reviews)));
  // Counted over the sample only, so a review left over from an earlier read of
  // a card that no longer exists does not count toward the gate.
  const inSample = new Set(sample.map(c => c.fingerprint));
  const byFp = new Map(library.map(c => [c.fingerprint, c]));
  const decided = new Map(((dupRows ?? []) as { card_fp: string; other_fp: string; same: boolean }[])
    .map(r => [`${r.card_fp}|${r.other_fp}`, r.same]));
  const pairs = duplicatePairs(library).map(p => ({
    card: byFp.get(p.card)!, other: byFp.get(p.other)!, same: decided.get(`${p.card}|${p.other}`) ?? null,
  }));
  const tally = reviewTally(
    Object.values(reviews).filter(r => inSample.has(r.fingerprint)),
    reviewTarget(library.length), library.length,
    { total: pairs.length, decided: pairs.filter(p => p.same !== null).length, same: pairs.filter(p => p.same === true).length },
  );

  const counts = new Map<string, number>();
  for (const d of readDocs) for (const x of d.read!.rejected) counts.set(x.reason, (counts.get(x.reason) ?? 0) + 1);
  const refusals = [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, label: rejectionLabel(reason, REJECT_LABEL), count }));

  return {
    docs, progress: { done: readDocs.length, total: docs.length },
    library, liveLibrary, remembered, facts, sample, reviews, tally, pairs, current: { liveCards: liveCards ?? 0 }, refusals,
  };
}
