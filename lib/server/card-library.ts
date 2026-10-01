import "server-only";
// Reading the Card Library for the admin page.
//
// Through userClient, so the reads run under RLS as the signed-in admin. The
// tables are admin-only by policy (0039), and every query still names the
// tenant: an admin's RLS sees every client, and the page must show one.
import { userClient } from "./supabase";
import { CARD_KIND_MAP, REJECT_LABEL, type RejectReason, type RejectedCandidate } from "@/lib/story-card";

export interface LibraryEvidence {
  documentId: string; title: string; layer: string | null; quote: string; speaker: string | null;
}

export interface LibraryCard {
  id: string; kind: string; kindLabel: string; statement: string; statementOrigin: "machine" | "human";
  itemKey: string | null; layer: "I" | "II" | "III" | null; subject: "organization" | "third_party";
  strength: "covered" | "thin"; hasFigures: boolean;
  status: "suggested" | "verified" | "retired"; retiredReason: string | null;
  mergedInto: string | null; possibleDuplicateOf: string | null;
  createdFrom: string; version: number; verifiedAt: string | null; createdAt: string;
  /** 0043: who verified it, and why it was retired, in the reviewer's words. */
  verifiedByRole: "admin" | "client" | null; retiredNote: string | null;
  /** 0043: ties an identifiable person to a protected status; see lib/card-sensitivity.ts. */
  sensitive: boolean; sensitiveReason: string | null;
  sensitiveCleared: "consent" | "deidentified" | "not_sensitive" | null; sensitiveNote: string | null;
  evidence: LibraryEvidence[];
}

export interface RefusalSummary {
  reason: RejectReason; label: string; count: number;
  examples: { title: string; kind: string; statement: string; quote: string }[];
}

export interface CardLibraryData {
  cards: LibraryCard[];
  /** Documents read for cards, and ready documents there are. */
  progress: { done: number; total: number };
  /**
   * Ready documents never read for cards. Named, not counted. A document CHANGED
   * since it was read is caught by the build itself (content hash), not here.
   */
  unread: string[];
  refusals: RefusalSummary[];
}

export async function getCardLibrary(tenantId: string): Promise<CardLibraryData> {
  const s = await userClient();

  const [{ data: cardRows, error: cErr }, { data: docRows }, { data: readRows }] = await Promise.all([
    s.from("story_card")
      .select("*, story_card_evidence(document_id, quote, speaker, document:document_id(title, layer, status))")
      .eq("tenant_id", tenantId)
      .order("kind").order("created_at"),
    s.from("document").select("id, title").eq("tenant_id", tenantId).eq("status", "ready"),
    s.from("story_card_doc").select("document_id, content_hash, rejected, extracted_at").eq("tenant_id", tenantId),
  ]);
  if (cErr) throw new Error(`Card Library read failed: ${cErr.message}`);

  type EvRow = { document_id: string; quote: string; speaker: string | null; document: { title: string; layer: string | null; status: string } | null };
  const cards: LibraryCard[] = ((cardRows ?? []) as Record<string, unknown>[]).map(r => ({
    id: r.id as string,
    kind: r.kind as string,
    kindLabel: CARD_KIND_MAP[r.kind as string]?.label ?? (r.kind as string),
    statement: r.statement as string,
    statementOrigin: r.statement_origin as "machine" | "human",
    itemKey: (r.item_key as string | null) ?? null,
    layer: (r.layer as "I" | "II" | "III" | null) ?? null,
    subject: r.subject as "organization" | "third_party",
    strength: r.strength as "covered" | "thin",
    hasFigures: !!r.has_figures,
    status: r.status as LibraryCard["status"],
    retiredReason: (r.retired_reason as string | null) ?? null,
    mergedInto: (r.merged_into as string | null) ?? null,
    possibleDuplicateOf: (r.possible_duplicate_of as string | null) ?? null,
    createdFrom: r.created_from as string,
    version: r.version as number,
    verifiedAt: (r.verified_at as string | null) ?? null,
    createdAt: r.created_at as string,
    verifiedByRole: (r.verified_by_role as LibraryCard["verifiedByRole"]) ?? null,
    retiredNote: (r.retired_note as string | null) ?? null,
    sensitive: !!r.sensitive,
    sensitiveReason: (r.sensitive_reason as string | null) ?? null,
    sensitiveCleared: (r.sensitive_cleared as LibraryCard["sensitiveCleared"]) ?? null,
    sensitiveNote: (r.sensitive_note as string | null) ?? null,
    evidence: ((r.story_card_evidence as EvRow[]) ?? [])
      .filter(e => e.document?.status === "ready")
      .map(e => ({
        documentId: e.document_id, title: e.document?.title ?? "Untitled", layer: e.document?.layer ?? null,
        quote: e.quote, speaker: e.speaker,
      })),
  }));

  const ready = (docRows ?? []) as { id: string; title: string }[];
  const read = new Map(((readRows ?? []) as { document_id: string }[]).map(r => [r.document_id, true]));
  const unread = ready.filter(d => !read.has(d.id)).map(d => d.title);

  // What the checks refused, grouped by reason. The refusals are how anyone
  // judges whether the checks are too strict or too loose, so they are shown
  // rather than logged.
  const titleById = new Map(ready.map(d => [d.id, d.title]));
  const byReason = new Map<RejectReason, RefusalSummary>();
  for (const row of (readRows ?? []) as { document_id: string; rejected: RejectedCandidate[] | null }[]) {
    for (const rj of row.rejected ?? []) {
      const reason = rj.reason;
      if (!REJECT_LABEL[reason]) continue;
      const g = byReason.get(reason) ?? { reason, label: REJECT_LABEL[reason], count: 0, examples: [] };
      g.count += 1;
      if (g.examples.length < 5) {
        g.examples.push({
          title: titleById.get(row.document_id) ?? "a document no longer ready",
          kind: rj.kind, statement: rj.statement, quote: rj.quote,
        });
      }
      byReason.set(reason, g);
    }
  }

  return {
    cards,
    progress: { done: ready.length - unread.length, total: ready.length },
    unread,
    refusals: [...byReason.values()].sort((a, b) => b.count - a.count),
  };
}
