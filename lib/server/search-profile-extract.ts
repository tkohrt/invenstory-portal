import "server-only";
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
import { chatComplete, generationConfigured } from "./llm";
import {
  parseFacts, mergeFacts, assessProfile, documentFingerprint, chunkText,
  type ProfileFact, type SearchProfile,
} from "@/lib/search-profile";
import type { JobEventKind } from "@/lib/job";
import { speakerRosterFor } from "./speaker-roster";
import {
  attributeSubject, describeRoster, speakerTurns,
  type SpeakerRoster,
} from "@/lib/transcript-speakers";

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

/**
 * One window, with one retry and a bounded wait.
 *
 * chatComplete swallows every error and returns null, so a throttled call and a
 * document with nothing to say are the same value. That is survivable per
 * window and not survivable per document, so the null is reported upward here
 * rather than quietly becoming an empty result.
 */
async function scanWindow(
  title: string, text: string, src: { documentId: string; documentTitle: string; layer: Layer },
  roster: SpeakerRoster | null,
): Promise<{ answered: boolean; facts: ProfileFact[]; reattributed: number }> {
  // Told, not left to infer. A reader that cannot see who is speaking assumes
  // the client, which is how an adviser's own career became the client's
  // evidence. The code below still checks the answer.
  const who = roster?.speakers.length
    ? "\n\nWHO IS SPEAKING. This document is a recorded meeting. "
      + roster.speakers.map(sp => `${sp.label} is `
        + (sp.isClient === true ? "FROM the organization"
          : sp.isClient === false ? "NOT from the organization (an outsider: adviser, investor, partner or facilitator)"
          : "of unknown affiliation")).join("; ")
      + ". A statement in the first person describes whoever is SPEAKING. "
      + "Only a first-person statement by somebody from the organization may be tagged "
      + "\"organization\"; a first-person claim by anyone else is \"third_party\", however "
      + "impressive it sounds. A speaker describing the organization in the third person is "
      + "still describing the organization."
    : "";

  const ask = () => chatComplete({
    system: SYS + who,
    user: `DOCUMENT TITLE: ${title}\n\nDOCUMENT TEXT:\n${text}`,
    maxTokens: 1800, temperature: 0,
  });

  let res = await ask();
  // One retry, because the common failure here is a throttle from firing
  // several windows of one transcript at once, and it clears in a second.
  if (!res) { await new Promise(f => setTimeout(f, 1200)); res = await ask(); }

  if (!res) return { answered: false, facts: [], reattributed: 0 };

  // The prompt above asks; this enforces. Subject quarantine works in the
  // readiness engine because it is checked in code rather than requested in
  // wording, and the same discipline applies here. Narrow by design: it only
  // ever moves a fact away from the organization, and only when the document
  // is a transcript, the speaker is known to be an outsider, and the quote is
  // a first-person claim.
  const turns = roster ? speakerTurns(text) : [];
  let reattributed = 0;
  const facts = parseFacts(res.text, src).map(f => {
    const r = attributeSubject({
      quote: f.quote, subject: f.subject, turns, roster,
      offset: f.quote ? text.indexOf(f.quote) : -1,
    });
    if (r.reattributed) reattributed += 1;
    return r.reattributed ? { ...f, subject: r.subject } : f;
  });
  return { answered: true, facts, reattributed };
}

/** Run tasks at most `width` at a time. A six-way burst is what throttles. */
async function pool<T>(tasks: (() => Promise<T>)[], width: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, async () => {
    for (let i = next++; i < tasks.length; i = next++) out[i] = await tasks[i]();
  }));
  return out;
}

export interface ProfileBuildResult {
  /** Documents read in THIS invocation. */
  read: number;
  /** Documents still to read after it. */
  remaining: number;
  /** True when every document is read and the profile has been assembled. */
  complete: boolean;
  /** Only set once complete. */
  profile?: SearchProfile;
  note?: string;
  usable?: boolean;
}

/** Leave enough of the function's budget to write results and answer. */
const WORK_BUDGET_MS = 42_000;
/** Windows of one document read at once. Six at once is what gets throttled. */
const WINDOW_CONCURRENCY = 3;

interface DocRow {
  id: string; title: string; layer: string | null;
  /** Who speaks in this transcript, from a previous read. See 0038. */
  speaker_roster?: SpeakerRoster | null;
}

/**
 * A cheap fingerprint of a document's text.
 *
 * Documents are re-processed in place: same id, chunks deleted and rewritten.
 * Without this, a re-uploaded document keeps the facts and the verbatim quotes
 * extracted from content that no longer exists, and the profile reports itself
 * as current. For a system whose whole discipline is "no quote, no fact",
 * stored quotes that are no longer in the document are the worst failure
 * available.
 */
function contentHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** Read one document and store its facts. Idempotent: re-reading replaces. */
async function extractOne(
  tenantId: string, d: DocRow, text: string, roster: SpeakerRoster | null,
): Promise<{ facts: number; reattributed: number }> {
  const layer = (["I", "II", "III"].includes(d.layer ?? "") ? d.layer : null) as Layer;
  const src = { documentId: d.id, documentTitle: d.title, layer };
  const w = windows(text);
  const parts = await pool(w.map(win => () => scanWindow(d.title, win, src, roster)), WINDOW_CONCURRENCY);

  // Not one row saying "read, nothing found". A document whose every window
  // failed has not been read, and writing it as read is how it disappears from
  // the profile permanently: the next pass sees a row and skips it.
  if (!parts.some(p => p.answered)) {
    throw new Error(`The model did not answer for any part of "${d.title}", so it has not been read. `
      + "Nothing was saved for it; running again retries it.");
  }
  const facts = parts.flatMap(p => p.facts);
  const reattributed = parts.reduce((n, p) => n + p.reattributed, 0);

  const { error } = await db.from("search_profile_doc").upsert({
    tenant_id: tenantId, document_id: d.id, facts,
    chars: text.length, windows: w.length,
    content_hash: contentHash(text),
    extracted_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,document_id" });
  // Loud: a document silently failing to save would be re-read on every
  // continuation, and the chain would never finish.
  if (error) throw new Error(`Could not save what was read from "${d.title}": ${error.message}`);
  return { facts: facts.length, reattributed };
}

/**
 * Do as much of the build as fits in one invocation, then stop.
 *
 * The unit of work is one document, because that is the unit that is
 * independent: reading document 4 does not depend on document 3, and there is
 * no sweep for a partial pass to corrupt. Whatever is read is kept, and the
 * next call picks up the documents that are still missing.
 *
 * Returns complete:false when the budget ran out with work left. That is a
 * normal outcome, not a failure, and the caller is expected to come back.
 */
export async function continueProfileBuild(
  tenantId: string, userId: string,
  /** The client's name, so a transcript's speakers can be placed against it. */
  orgName: string,
  opts: {
    onProgress?: (p: { done: number; total: number; detail: string }) => void;
    /** A line for the run's log. Narration, never load-bearing. */
    onEvent?: (e: { kind: JobEventKind; text: string; done?: number; total?: number }) => void;
  } = {},
): Promise<ProfileBuildResult> {
  if (!generationConfigured()) throw new Error("No generation model is configured in this environment.");
  const started = Date.now();
  const step = (done: number, total: number, detail: string) => {
    try { opts.onProgress?.({ done, total, detail }); } catch { /* never fatal */ }
  };
  const say = (kind: JobEventKind, text: string, done?: number, total?: number) => {
    try { opts.onEvent?.({ kind, text, done, total }); } catch { /* never fatal */ }
  };

  const { data: docs, error } = await db.from("document")
    .select("id, title, layer, speaker_roster").eq("tenant_id", tenantId).eq("status", "ready");
  if (error) throw new Error(`document read failed: ${error.message}`);
  const docList = (docs ?? []) as DocRow[];

  const { data: doneRows } = await db.from("search_profile_doc")
    .select("document_id, content_hash").eq("tenant_id", tenantId);
  const done = new Map(((doneRows ?? []) as { document_id: string; content_hash: string | null }[])
    .map(r => [r.document_id, r.content_hash]));

  // Current text length per document, so a document that was re-processed in
  // place is re-read rather than trusted forever.
  //
  // Built through chunkText, the same function the reader uses. Computing this
  // length independently is what broke the chain before: the two answers
  // differed by one character per chunk boundary, nothing ever matched, and no
  // document was ever considered read.
  const { data: sizes } = await db.from("document_chunk")
    .select("document_id, chunk_index, text").eq("tenant_id", tenantId)
    .order("chunk_index");
  const rowsByDoc = new Map<string, { text: string | null }[]>();
  for (const c of ((sizes ?? []) as { document_id: string; text: string | null }[])) {
    const list = rowsByDoc.get(c.document_id) ?? [];
    list.push({ text: c.text });
    rowsByDoc.set(c.document_id, list);
  }
  const lenByDoc = new Map<string, number>();
  for (const [id, rows] of rowsByDoc) lenByDoc.set(id, chunkText(rows).length);

  const stale = (d: DocRow) => {
    if (!done.has(d.id)) return true;
    const h = done.get(d.id);
    if (!h || h === "boilerplate" || h === "empty") return false;   // deliberate skips stay skipped
    const len = lenByDoc.get(d.id) ?? 0;
    return !h.startsWith(`${len}:`);                                 // length changed, so content did
  };

  const todo = docList.filter(stale);
  const total = docList.length;
  const already = new Set(docList.filter(d => !stale(d)).map(d => d.id));

  if (already.size) {
    say("phase", `Carrying forward ${already.size} document(s) already read. `
      + `${todo.length} still to read.`, already.size, total);
  } else {
    say("phase", `Reading ${total} document(s).`, 0, total);
  }

  let read = 0;
  for (const d of todo) {
    // A pass ALWAYS reads at least one document. The budget decides whether to
    // read another, never whether to read at all.
    //
    // Without this a pass can return having done nothing, and a caller with no
    // way to tell "no time left" from "cannot proceed" has to guess. It guessed
    // wrong and stopped a chain that had ten documents still to read.
    if (read > 0 && Date.now() - started > WORK_BUDGET_MS) break;
    step(already.size + read, total, `reading ${d.title}`);

    if (isBoilerplate(d.title)) {
      // Recorded as read, and loudly. A skip that fails to save is re-tried on
      // every continuation and the chain never finishes.
      const { error: skipErr } = await db.from("search_profile_doc").upsert({
        tenant_id: tenantId, document_id: d.id, facts: [], chars: 0, windows: 0,
        content_hash: "boilerplate",
      }, { onConflict: "tenant_id,document_id" });
      if (skipErr) throw new Error(`Could not record skipping "${d.title}": ${skipErr.message}`);
      read += 1;
      say("skip", `Skipped ${d.title}: the title marks it as a template or draft, `
        + "so it describes nobody in particular.", already.size + read, total);
      continue;
    }

    const { data: chunks } = await db.from("document_chunk")
      .select("chunk_index, text").eq("tenant_id", tenantId).eq("document_id", d.id)
      .order("chunk_index");
    const text = chunkText((chunks ?? []) as { text: string | null }[]);
    if (!text.trim()) {
      // No chunks yet, or an extraction that produced nothing. Recording it
      // avoids a model call on empty input every time the chain comes round.
      const { error: emptyErr } = await db.from("search_profile_doc").upsert({
        tenant_id: tenantId, document_id: d.id, facts: [], chars: 0, windows: 0,
        content_hash: "empty",
      }, { onConflict: "tenant_id,document_id" });
      if (emptyErr) throw new Error(`Could not record "${d.title}" as empty: ${emptyErr.message}`);
      read += 1;
      say("skip", `Skipped ${d.title}: no readable text was extracted from it.`,
        already.size + read, total);
      continue;
    }
    // Who is in the room, before reading what they said. Only for transcripts,
    // and only once per document: the answer is stored and reused.
    let roster: SpeakerRoster | null = null;
    try {
      roster = await speakerRosterFor(
        tenantId, d.id, d.title, orgName, text, d.speaker_roster ?? null);
      if (roster) say("phase", describeRoster(roster, d.title), already.size + read, total);
    } catch (e) {
      // Never fatal. A document whose speakers could not be placed is read
      // exactly as it was before this existed.
      console.error("[speakers] roster failed", e);
    }

    const found = await extractOne(tenantId, d, text, roster);
    read += 1;
    say("progress",
      `Read and stored ${d.title}: ${found.facts} fact(s)`
      + (found.reattributed
        ? `, ${found.reattributed} reattributed to somebody other than the client.`
        : "."),
      already.size + read, total);
    // After, not only before. Reporting only before leaves the count one behind
    // the words: a bar at 27% under a line reading "5 of 15 documents read".
    step(already.size + read, total, `read ${d.title}`);
  }

  const remaining = todo.length - read;
  if (remaining > 0) {
    // Named, not counted. "Still to read: three documents" tells nobody whether
    // the one that matters is among them.
    const left = todo.slice(read).map(d => d.title);
    say("pause", `Time limit for this stage reached with ${remaining} document(s) still to read: `
      + `${left.slice(0, 6).join(", ")}${left.length > 6 ? `, and ${left.length - 6} more` : ""}. `
      + "Everything read is saved; the next stage starts here.", already.size + read, total);
    return { read, remaining, complete: false };
  }

  say("phase", "Every document is read. Working out what to search on.", total, total);
  step(total, total, "working out what to search on");
  const assembled = await assembleProfile(tenantId, userId, docList);
  return { read, remaining: 0, complete: true, ...assembled };
}

/**
 * Merge every document's facts into the profile the search actually uses.
 *
 * Cheap and pure once the reading is done, which is the other half of why the
 * split is worth it: adding one document costs one document of model time and
 * then this, rather than a full rebuild.
 */
export async function assembleProfile(
  tenantId: string, userId: string, docList?: { id: string }[],
): Promise<{ profile: SearchProfile; note: string; usable: boolean }> {
  // Joined to document, so a row for something no longer ready (re-processing,
  // archived, a failed re-ingest) does not keep contributing facts to a profile
  // that claims to describe the current Inven(s)tory.
  const { data: rows } = await db.from("search_profile_doc")
    .select("facts, chars, document:document_id!inner(status)")
    .eq("tenant_id", tenantId).eq("document.status", "ready");
  const all = ((rows ?? []) as unknown as { facts: ProfileFact[]; chars: number }[]);

  const facts = mergeFacts(all.flatMap(r => (r.facts ?? []) as ProfileFact[]));
  const layers = [...new Set(facts.map(f => f.layer).filter(Boolean))] as ("I" | "II" | "III")[];

  const docs = docList ?? (((await db.from("document")
    .select("id").eq("tenant_id", tenantId).eq("status", "ready")).data ?? []) as { id: string }[]);

  const profile: SearchProfile = {
    facts,
    generatedAt: new Date().toISOString(),
    // Documents that actually contributed text, not the raw count: a profile
    // built from twelve documents and three empty ones was built from twelve.
    documentCount: all.filter(r => r.chars > 0).length,
    layers,
  };
  const health = assessProfile(profile);

  const { error } = await db.from("search_profile").upsert({
    tenant_id: tenantId,
    facts: profile.facts,
    document_count: profile.documentCount,
    layers: profile.layers,
    doc_fingerprint: documentFingerprint(docs),
    note: health.note,
    generated_at: profile.generatedAt,
    generated_by: userId,
  }, { onConflict: "tenant_id" });
  if (error) throw new Error(`Search Profile could not be saved: ${error.message}`);

  return { profile, note: health.note, usable: health.usable };
}

/**
 * Forget what was read, so the next build starts clean.
 *
 * Used by an explicit rebuild. An ordinary continuation must never do this, or
 * the chain would restart itself forever.
 */
export async function clearProfileDocs(tenantId: string): Promise<void> {
  const { error } = await db.from("search_profile_doc").delete().eq("tenant_id", tenantId);
  if (error) throw new Error(`could not clear the previous read: ${error.message}`);
}

/** Documents read, and documents there are, for the panel and the chain. */
export async function profileBuildProgress(tenantId: string): Promise<{ done: number; total: number }> {
  const [{ count: done }, { count: total }] = await Promise.all([
    // Counted the same way as the assembly, or the panel can be handed a
    // "done" larger than its "total".
    db.from("search_profile_doc")
      .select("document_id, document:document_id!inner(status)", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("document.status", "ready"),
    db.from("document").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("status", "ready"),
  ]);
  return { done: Math.min(done ?? 0, total ?? 0), total: total ?? 0 };
}

