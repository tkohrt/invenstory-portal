"use server";
// Building the Search Profile: one pass over the Inven(s)tory, asking what
// matters for finding money.
//
// Deliberately a SEPARATE pass from doc-extract, which reads the same documents
// to grade readiness. Folding both questions into one prompt would halve the
// model cost, but the readiness prompt reached its accuracy through a
// documented evolution (two real failures, several calibrations), and a prompt
// doing two jobs usually does both worse. Not worth destabilising a working
// engine to save a call per document.
//
// What it inherits from doc-extract, on purpose: windowing long documents,
// skipping boilerplate, verbatim quotes, and the subject tag that decides
// whether a line may describe the client at all.
import { db } from "./db";
import { getSession } from "./session";
import { chatComplete, generationConfigured } from "./llm";
import {
  parseFacts, mergeFacts, assessProfile, documentFingerprint,
  type ProfileFact, type SearchProfile,
} from "@/lib/search-profile";

type Layer = "I" | "II" | "III" | null;

function isBoilerplate(title: string): boolean {
  return /\b(template|unsigned|sample|draft|boilerplate)\b/i.test(title);
}

function windows(text: string, size = 10000, overlap = 500, max = 6): string[] {
  if (text.length <= 12000) return [text];
  const out: string[] = []; let i = 0;
  while (i < text.length && out.length < max) { out.push(text.slice(i, i + size)); i += size - overlap; }
  return out;
}

const SYS =
  "You are reading ONE document from an organization's Inven(s)tory and pulling out the facts that matter " +
  "for finding this organization funding. You are not summarising the document.\n\n" +
  "Return facts under these facets:\n" +
  "  identity      what kind of organization this is, as a funder would classify it\n" +
  "  work          what it actually does: its programmes, products or services\n" +
  "  need          what it wants funded. A project, a role, capacity, equipment, a pilot\n" +
  "  evidence      what it can prove: outcomes, figures, traction, awards, contracts\n" +
  "  geography     where it operates, as specifically as the document says\n" +
  "  distinctive   what a programme officer would remember about it\n" +
  "  constraints   anything limiting eligibility: no 501(c)(3), fiscal sponsorship, no SAM.gov registration, tiny budget\n" +
  "  beneficiaries who it serves\n\n" +
  "RULES.\n" +
  "1. Every fact needs a VERBATIM quote from the document. No quote, no fact. Do not paraphrase into the quote field.\n" +
  "2. `text` is a short clause in the organization's own vocabulary, usable in a search query. Not a sentence about the document.\n" +
  "3. Say who each quote is ABOUT in `subject`: \"organization\" (this organization itself), \"competitor\" (a rival company or product), " +
  "or \"third_party\" (a client, partner, funder, hospital, school or other outside entity). Get this right. A partner's programme and a " +
  "competitor's product are NOT this organization's work, and mislabelling them sends the search after the wrong money.\n" +
  "4. Do not infer. If the document never says what they want funded, return no `need` fact. An empty facet is a useful answer.\n" +
  "5. Do not turn who they SERVE into what they ARE. A company building software for hospitals is a software company, not a hospital. " +
  "A charity serving veterans is a service provider, not a veteran.\n" +
  "6. Prefer specific over grand. \"two more case managers in Cuyahoga County\" beats \"expanding capacity\".\n\n" +
  "Return STRICT JSON only: an array of " +
  "{\"facet\":\"<one of the above>\",\"text\":\"<short clause>\",\"quote\":\"<verbatim>\",\"subject\":\"organization|competitor|third_party\"}. " +
  "Return [] if the document says nothing useful.";

async function scanWindow(title: string, text: string, src: { documentId: string; documentTitle: string; layer: Layer }) {
  const res = await chatComplete({
    system: SYS,
    user: `DOCUMENT TITLE: ${title}\n\nDOCUMENT TEXT:\n${text}`,
    maxTokens: 1800, temperature: 0,
  });
  return res ? parseFacts(res.text, src) : [];
}

export interface ProfileBuildResult {
  profile: SearchProfile;
  note: string;
  usable: boolean;
  /** Documents read, skipped as boilerplate, and how many produced nothing. */
  scanned: number; skipped: number; silent: number;
}

/**
 * Rebuild one tenant's Search Profile from every ready document.
 *
 * Admin-gated: it is an LLM pass over the whole Inven(s)tory, and a client
 * clicking it repeatedly would be an expensive way to change nothing.
 */
export async function rebuildSearchProfileAction(tenantId: string): Promise<ProfileBuildResult> {
  const s = await getSession();
  if (!s || s.role !== "admin") throw new Error("admin required");
  if (!generationConfigured()) throw new Error("No generation model is configured in this environment.");

  const { data: docs, error } = await db.from("document")
    .select("id, title, layer").eq("tenant_id", tenantId).eq("status", "ready");
  if (error) throw new Error(`document read failed: ${error.message}`);
  const docList = (docs ?? []) as { id: string; title: string; layer: string | null }[];

  const { data: chunks } = await db.from("document_chunk")
    .select("document_id, text").eq("tenant_id", tenantId);
  const textByDoc = new Map<string, string>();
  for (const c of (chunks ?? []) as { document_id: string; text: string | null }[]) {
    textByDoc.set(c.document_id, (textByDoc.get(c.document_id) ?? "") + "\n" + (c.text ?? ""));
  }

  let skipped = 0, silent = 0;
  const perDoc = await Promise.all(docList.map(async d => {
    const text = textByDoc.get(d.id) ?? "";
    if (isBoilerplate(d.title) || !text.trim()) { skipped += 1; return [] as ProfileFact[]; }
    const layer = (["I", "II", "III"].includes(d.layer ?? "") ? d.layer : null) as Layer;
    const src = { documentId: d.id, documentTitle: d.title, layer };
    const parts = await Promise.all(windows(text).map(w => scanWindow(d.title, w, src)));
    const facts = parts.flat();
    if (!facts.length) silent += 1;
    return facts;
  }));

  const facts = mergeFacts(perDoc.flat());
  const layers = [...new Set(facts.map(f => f.layer).filter(Boolean))] as ("I" | "II" | "III")[];
  const scanned = docList.length - skipped;

  const profile: SearchProfile = {
    facts,
    generatedAt: new Date().toISOString(),
    documentCount: scanned,
    layers,
  };
  const health = assessProfile(profile);

  const { error: writeErr } = await db.from("search_profile").upsert({
    tenant_id: tenantId,
    facts: profile.facts,
    document_count: profile.documentCount,
    layers: profile.layers,
    doc_fingerprint: documentFingerprint(docList),
    note: health.note,
    generated_at: profile.generatedAt,
    generated_by: s.user.id,
  }, { onConflict: "tenant_id" });
  // Loud, like every other write in this system. A profile that silently failed
  // to save would send the next run back to the eligibility profile with no
  // sign that anything was wrong.
  if (writeErr) throw new Error(`Search Profile could not be saved: ${writeErr.message}`);

  return { profile, note: health.note, usable: health.usable, scanned, skipped, silent };
}

export interface StoredProfile extends SearchProfile {
  note: string | null;
  /** True when documents have changed since this was built. */
  stale: boolean;
}

/** The cached profile, and whether the Inven(s)tory has moved on since. */
export async function getSearchProfile(tenantId: string): Promise<StoredProfile | null> {
  const { data, error } = await db.from("search_profile")
    .select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(`search profile read failed: ${error.message}`);
  if (!data) return null;

  const { data: docs } = await db.from("document")
    .select("id").eq("tenant_id", tenantId).eq("status", "ready");
  const row = data as {
    facts: ProfileFact[]; document_count: number; layers: string[];
    doc_fingerprint: string | null; note: string | null; generated_at: string;
  };

  return {
    facts: (row.facts ?? []) as ProfileFact[],
    generatedAt: row.generated_at,
    documentCount: row.document_count,
    layers: (row.layers ?? []) as ("I" | "II" | "III")[],
    note: row.note,
    stale: documentFingerprint((docs ?? []) as { id: string }[]) !== row.doc_fingerprint,
  };
}
