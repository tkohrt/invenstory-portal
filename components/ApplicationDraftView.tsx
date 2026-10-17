"use client";
// A card-mode draft before drafting begins: reading the funder's application
// into questions, and a person confirming them.
//
// Nothing proceeds until the questions are confirmed (spec section 6). A wrong
// structure costs more later, in every card placed against the wrong question,
// than half a minute of checking now.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import JobProgress, { useJob } from "./JobProgress";
import { confirmSectionsAction, saveDraftDetailsAction, saveSectionsAction, type FormItemInput, type SectionInput } from "@/lib/server/application-actions";
import { CARD_KIND_MAP } from "@/lib/story-card";
import type { BankOption } from "@/lib/server/drafts";
import type { DraftFormItem, DraftSection, GrantDraft } from "@/lib/types";
import { ANSWER_TYPES, ANSWER_TYPE_LABEL, readOptions, reconciliationLine, type AnswerType, type FormKind } from "@/lib/form-items";
import GrantContextBox from "./GrantContextBox";
import type { ContextItem } from "@/lib/server/draft-context";

const HAND = "Chosen by hand on the confirmation screen.";
const NEW = "__new";

interface Row {
  key: string;
  id?: string;
  prompt: string;
  guidance: string;
  criteria: string;
  limit_value: string;
  limit_unit: "words" | "characters" | "";
  in_source: boolean;
  origin: "parsed" | "manual";
  slug: string | null;          // current bank match (primary), null = new topic
  kinds: string[];
  reason: string | null;
  handSlug?: string | null;     // set only when changed on this screen
  edited: boolean;              // prompt changed since the last match
  form_position: number | null; // its place on the funder's form (Form Items, 0068)
  /** What it had as a form field, kept in case it is moved back before saving. */
  asField?: { answer_type: AnswerType | null; options: string };
}

/** A fact or confirmation on this screen (Form Items step 1). */
interface FormRow {
  key: string;
  id?: string;
  kind: FormKind;
  answer_type: AnswerType | null;
  options: string;              // one per line while editing
  prompt: string;
  guidance: string;
  in_source: boolean;
  origin: "parsed" | "manual";
  form_position: number | null;
  /** What it had as a written question, kept in case it is moved back before saving. */
  asQuestion?: Pick<Row, "limit_value" | "limit_unit" | "criteria" | "handSlug">;
}

let seq = 0;
const nextKey = () => `k${++seq}`;

const toRow = (s: DraftSection): Row => ({
  key: nextKey(), id: s.id, prompt: s.prompt, guidance: s.guidance ?? "", criteria: s.criteria ?? "",
  limit_value: s.limit_value ? String(s.limit_value) : "", limit_unit: s.limit_unit ?? "",
  in_source: s.in_source, origin: s.origin,
  slug: s.question_slugs[0] ?? null, kinds: s.wanted_kinds, reason: s.match_reason,
  edited: s.matched_prompt !== s.prompt && s.match_reason !== HAND,
  form_position: s.form_position ?? null,
});

const toFormRow = (f: DraftFormItem): FormRow => ({
  key: nextKey(), id: f.id, kind: f.kind, answer_type: f.answer_type, options: (f.options ?? []).join("\n"),
  prompt: f.prompt, guidance: f.guidance ?? "", in_source: f.in_source, origin: f.origin, form_position: f.form_position,
});

const toFormInput = (f: FormRow): FormItemInput => ({
  id: f.id, kind: f.kind, answer_type: f.kind === "fact" ? (f.answer_type ?? "short_text") : null,
  options: f.answer_type === "choice" ? readOptions(f.options.split("\n")) : [],
  prompt: f.prompt, guidance: f.guidance || null, form_position: f.form_position, origin: f.origin,
});

/** Put an item where it sits on the funder's form among items that know their place; items that do not keep theirs. */
function placeByForm<T extends { form_position: number | null }>(list: T[], item: T): T[] {
  const at = item.form_position == null ? -1 : list.findIndex(x => x.form_position != null && x.form_position > item.form_position!);
  return at < 0 ? [...list, item] : [...list.slice(0, at), item, ...list.slice(at)];
}

const toInput = (r: Row): SectionInput => {
  const n = Number(r.limit_value.replace(/[,\s]/g, ""));
  return {
    id: r.id, prompt: r.prompt, guidance: r.guidance || null, criteria: r.criteria || null,
    limit_value: Number.isInteger(n) && n > 0 && r.limit_unit ? n : null,
    limit_unit: Number.isInteger(n) && n > 0 && r.limit_unit ? r.limit_unit : null,
    ...(r.handSlug !== undefined ? { handSlug: r.handSlug } : {}),
    form_position: r.form_position, origin: r.origin,
  };
};

const SOURCE_LABEL: Record<string, string> = { paste: "pasted text", pdf: "a PDF", docx: "a Word file", url: "a web page", match: "Funder Matches" };

export default function ApplicationDraftView({ tenantName, draft, sections, formItems = [], bank, sourceText, context, contextFailed = 0 }: {
  tenantName: string; draft: GrantDraft; sections: DraftSection[]; bank: BankOption[]; sourceText: string;
  /** Facts and confirmations: the form's items that are not written (Form Items step 1). */
  formItems?: DraftFormItem[];
  /** The grant context box (Auto-Draft patch 5). */
  context: { ready: boolean; items: ContextItem[] };
  /** Items that could not be added from /drafts/new. */
  contextFailed?: number;
}) {
  const router = useRouter();
  const { job, events, syncJob, gaveUp } = useJob(null);
  const [running, setRunning] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const started = useRef(false);

  const confirmed = !!draft.confirmed_at;
  const unmatched = sections.some(s => s.matched_prompt !== s.prompt && s.match_reason !== HAND);
  const needsRun = !draft.parsed_at || (!confirmed && unmatched);

  const runChain = useCallback(async (restart: boolean) => {
    setChainError(null); setRunning(true);
    const post = (body: Record<string, unknown>) => fetch("/api/jobs/parse-application", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draft.id, ...body }),
    });
    try {
      const b = await post({ begin: true, restart });
      const br = await b.json().catch(() => ({}));
      if (!b.ok) throw new Error(br.error ?? "Could not start reading the application.");
      if (br.jobId) await syncJob(br.jobId).catch(() => null);
      let cutShort = 0;
      for (let pass = 0; pass < 30; pass++) {
        const res = await post({});
        const r = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (r.error) throw new Error(r.error);
          if (++cutShort >= 3) throw new Error("Three passes in a row were cut off before they could report back. What was read is saved; try again to carry on.");
          await new Promise(f => setTimeout(f, 1500));
          continue;
        }
        cutShort = 0;
        if (r.jobId) await syncJob(r.jobId).catch(() => null);
        if (r.complete) { router.refresh(); return; }
        if (r.busy) { await new Promise(f => setTimeout(f, 3000)); continue; }
      }
      throw new Error("Stopped after many passes without finishing. What was read is saved; try again to carry on.");
    } catch (e) {
      setChainError(e instanceof Error ? e.message : "Reading the application failed.");
    } finally {
      setRunning(false);
    }
  }, [draft.id, router, syncJob]);

  // Start reading as soon as the draft opens, once. A failure waits for a person.
  useEffect(() => {
    if (needsRun && !started.current) { started.current = true; void runChain(false); }
  }, [needsRun, runChain]);

  const money = draft.amount_cents == null ? null : "$" + (draft.amount_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const stats = draft.parse_state?.stats;

  return (
    <div className="ap">
      <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · {tenantName} · For Granted only</div>
      <div className="page-head">
        <div>
          <button className="btn ghost" style={{ padding: "2px 4px", marginBottom: 4 }} onClick={() => router.push("/drafts")}>← Drafts</button>
          <h2>{draft.title}</h2>
          <p>{[draft.funder, money, draft.deadline ? `due ${new Date(draft.deadline + "T12:00:00").toLocaleDateString()}` : null].filter(Boolean).join(" · ")}</p>
          <p className="ov-muted" style={{ marginTop: 2 }}>
            From {SOURCE_LABEL[draft.source_kind ?? "paste"] ?? "an application"}
            {draft.source_filename ? `: ${draft.source_filename}` : ""}
            {draft.source_url ? <>: <a href={draft.source_url} target="_blank" rel="noopener noreferrer">{draft.source_url.replace(/^https?:\/\//, "").slice(0, 70)}</a></> : null}
          </p>
        </div>
      </div>

      <details className="gc-wrap" open={contextFailed > 0 || context.items.length > 0 || undefined}>
        <summary>Grant context{context.items.length ? ` (${context.items.length})` : ""}
          <span className="ov-muted"> · the funder&rsquo;s overview and what the client wants this application to say. Optional; auto-draft reads it.</span></summary>
        {contextFailed > 0 && (
          <div className="ap-error" role="alert">{contextFailed} item{contextFailed === 1 ? "" : "s"} of grant context could not be added. Add {contextFailed === 1 ? "it" : "them"} again here.</div>
        )}
        <GrantContextBox mode="live" draftId={draft.id} items={context.items} ready={context.ready} locked={false} />
      </details>

      {job && (running || needsRun) && <JobProgress job={job} events={events} lostContact={gaveUp} />}
      {running && !job && <div className="ov-note">Starting to read the application&hellip;</div>}
      {chainError && (
        <div className="ap-error" role="alert">
          {chainError}{" "}
          <button className="btn ghost" onClick={() => void runChain(false)}>Try again</button>
        </div>
      )}

      {/* Once confirmed, the page opens the drafting workspace instead (DraftWorkspace). */}
      {draft.parsed_at && !running && !confirmed && (
        <ConfirmQuestions draft={draft}
              key={sections.map(s => s.id + s.matched_prompt).join("|") + "#" + formItems.map(f => f.id).join("|")}
              draftId={draft.id} sections={sections} formItems={formItems} bank={bank}
              attachments={draft.required_attachments ?? []} stats={stats}
              truncated={!!draft.parse_state?.truncated}
              onReread={() => { if (confirm("Read the application again from the start? Your edits on this screen will be replaced by a fresh reading.")) void runChain(true); }}
            />
      )}

      <details className="ap-source">
        <summary>The funder&rsquo;s application text ({sourceText.length.toLocaleString()} characters)</summary>
        <pre>{sourceText}</pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KindChips({ kinds }: { kinds: string[] }) {
  if (!kinds.length) return <span className="ov-muted">No card kinds yet</span>;
  return <>{kinds.map(k => <span key={k} className="ov-tag ap-kind">{CARD_KIND_MAP[k]?.label ?? k}</span>)}</>;
}

function ConfirmQuestions({ draft, draftId, sections, formItems, bank, attachments, stats, truncated, onReread }: {
  draft: GrantDraft; draftId: string; sections: DraftSection[]; formItems: DraftFormItem[]; bank: BankOption[]; attachments: string[];
  stats?: Record<string, number>; truncated: boolean; onReread: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => sections.map(toRow));
  const [formRows, setFormRows] = useState<FormRow[]>(() => formItems.map(toFormRow));
  // The application's details, as read: confirm them rather than type them.
  const [details, setDetails] = useState({
    title: draft.title ?? "", funder: draft.funder ?? "", deadline: draft.deadline ?? "",
    amountDollars: draft.amount_cents == null ? "" : String(Math.round(draft.amount_cents / 100)),
  });
  const [busy, setBusy] = useState<"save" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const areas = useRef(new Map<string, HTMLTextAreaElement>());

  const update = (key: string, patch: Partial<Row>) => {
    setDirty(true);
    setRows(rs => rs.map(r => {
      if (r.key !== key) return r;
      // Editing the wording means the model's match no longer describes it;
      // a match chosen by hand stays the person's decision.
      const rematch = patch.prompt !== undefined && r.handSlug === undefined && r.reason !== HAND;
      return { ...r, ...patch, edited: patch.edited ?? (rematch ? true : r.edited) };
    }));
  };
  const move = (i: number, d: -1 | 1) => { setDirty(true); setRows(rs => { const a = [...rs]; const j = i + d; if (j < 0 || j >= a.length) return rs; [a[i], a[j]] = [a[j], a[i]]; return a; }); };
  const remove = (i: number) => { setDirty(true); setRows(rs => rs.filter((_, k) => k !== i)); };
  const blank = (): Row => ({ key: nextKey(), prompt: "", guidance: "", criteria: "", limit_value: "", limit_unit: "", in_source: false, origin: "manual", slug: null, kinds: [], reason: null, edited: true, form_position: null });
  const addAfter = (i: number) => { setDirty(true); setRows(rs => [...rs.slice(0, i + 1), blank(), ...rs.slice(i + 1)]); };
  const merge = (i: number) => {
    setDirty(true);
    setRows(rs => {
      if (i + 1 >= rs.length) return rs;
      const a = rs[i], b = rs[i + 1];
      const join = (x: string, y: string, sep: string) => [x.trim(), y.trim()].filter(Boolean).join(sep);
      const merged: Row = {
        ...a, prompt: join(a.prompt, b.prompt, " "), guidance: join(a.guidance, b.guidance, "\n"),
        criteria: join(a.criteria, b.criteria, "\n"),
        limit_value: a.limit_value || b.limit_value, limit_unit: a.limit_value ? a.limit_unit : b.limit_unit,
        in_source: a.in_source && b.in_source, handSlug: undefined, reason: a.reason === HAND ? null : a.reason, edited: true,
      };
      return [...rs.slice(0, i), merged, ...rs.slice(i + 2)];
    });
  };
  /** Split at the cursor in the question box; with no cursor inside it, add an empty question after. */
  const split = (i: number) => {
    const r = rows[i];
    const el = areas.current.get(r.key);
    const at = el && document.activeElement === el ? el.selectionStart : -1;
    if (at <= 0 || at >= r.prompt.length) { addAfter(i); return; }
    setDirty(true);
    const first: Row = { ...r, prompt: r.prompt.slice(0, at).trim(), handSlug: undefined, reason: r.reason === HAND ? null : r.reason, edited: true };
    const second: Row = { ...blank(), prompt: r.prompt.slice(at).trim(), in_source: r.in_source, origin: r.origin };
    setRows(rs => [...rs.slice(0, i), first, second, ...rs.slice(i + 1)]);
  };

  // Form Items step 1: moving an item between the questions and the form fields.
  const updateForm = (key: string, patch: Partial<FormRow>) => { setDirty(true); setFormRows(fs => fs.map(f => f.key === key ? { ...f, ...patch } : f)); };
  const removeForm = (key: string) => { setDirty(true); setFormRows(fs => fs.filter(f => f.key !== key)); };
  const addForm = () => { setDirty(true); setFormRows(fs => [...fs, { key: nextKey(), kind: "fact", answer_type: "short_text", options: "", prompt: "", guidance: "", in_source: false, origin: "manual", form_position: null }]); };
  const toForm = (i: number) => {
    const r = rows[i];
    setDirty(true);
    setRows(rs => rs.filter((_, k) => k !== i));
    setFormRows(fs => placeByForm(fs, {
      key: nextKey(), kind: "fact", answer_type: r.asField?.answer_type ?? "short_text", options: r.asField?.options ?? "",
      prompt: r.prompt, guidance: r.guidance, in_source: r.in_source, origin: r.origin, form_position: r.form_position,
      asQuestion: { limit_value: r.limit_value, limit_unit: r.limit_unit, criteria: r.criteria, handSlug: r.handSlug },
    }));
  };
  const toWritten = (key: string) => {
    const f = formRows.find(x => x.key === key);
    if (!f) return;
    setDirty(true);
    setFormRows(fs => fs.filter(x => x.key !== key));
    setRows(rs => placeByForm(rs, {
      ...blank(), ...(f.asQuestion ?? {}),
      prompt: f.prompt, guidance: f.guidance, in_source: f.in_source, origin: f.origin, form_position: f.form_position,
      asField: { answer_type: f.answer_type, options: f.options },
    }));
  };

  const inputs = () => rows.map(toInput);
  const formInputs = () => formRows.map(toFormInput);
  const empty = rows.findIndex(r => !r.prompt.trim());
  const emptyForm = formRows.findIndex(f => !f.prompt.trim());
  const blocked = empty >= 0 ? `Question ${empty + 1} is empty` : emptyForm >= 0 ? `Form field ${emptyForm + 1} is empty` : null;
  const facts = formRows.filter(f => f.kind === "fact").length;

  const save = async () => {
    setBusy("save"); setError(null);
    try { await saveDraftDetailsAction(draftId, details); await saveSectionsAction(draftId, inputs(), formInputs()); setDirty(false); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(null); }
  };
  const confirmAll = async () => {
    setBusy("confirm"); setError(null);
    try { await saveDraftDetailsAction(draftId, details); await confirmSectionsAction(draftId, inputs(), formInputs()); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not confirm."); setBusy(null); }
  };

  const flagged = rows.filter(r => !r.in_source && r.origin === "parsed").length;
  const noLimit = rows.filter(r => !r.limit_value).length;

  return (
    <div className="ap-confirm">
      <div className="ap-grid ap-details">
        <label>Opportunity<input value={details.title} onChange={e => { setDirty(true); setDetails({ ...details, title: e.target.value }); }} /></label>
        <label>Funder<input value={details.funder} onChange={e => { setDirty(true); setDetails({ ...details, funder: e.target.value }); }} placeholder="Not found in the application" /></label>
        <label>Deadline<input type="date" value={details.deadline} onChange={e => { setDirty(true); setDetails({ ...details, deadline: e.target.value }); }} /></label>
        <label>Amount (USD)<input value={details.amountDollars} inputMode="decimal" placeholder="40000" onChange={e => { setDirty(true); setDetails({ ...details, amountDollars: e.target.value }); }} /></label>
      </div>
      <div className="ap-summary">
        <strong>{reconciliationLine({ written: rows.length, facts, confirmations: formRows.length - facts, attachments: attachments.length })}</strong>
        <span>
          Check them against the application before drafting. Only the questions to write are drafted with Story Cards;
          form fields are kept below so every item on the funder&rsquo;s form is accounted for.
          Merge anything split in two, split anything that asks two things, move anything in the wrong list,
          and add anything missed.
          {flagged ? ` ${flagged} could not be found word for word in the application and are marked; fix their wording or confirm them as they are.` : ""}
          {noLimit ? ` ${noLimit} have no limit; add one where the funder states it.` : ""}
          {stats?.limitsRemoved ? ` ${stats.limitsRemoved} limit(s) the reader proposed were removed because the application does not state them.` : ""}
          {truncated ? " The application was longer than the reader takes, so the end was not read: check its last questions by hand." : ""}
        </span>
        <div className="ap-reread">
          <button type="button" className="btn secondary ap-mini" disabled={!!busy} onClick={onReread}>Read the application again</button>
          <span className="ov-muted">Starts the reading over. Edits on this screen are replaced.</span>
        </div>
      </div>

      <ol className="ap-list">
        {rows.map((r, i) => {
          const current = r.handSlug !== undefined ? r.handSlug : r.slug;
          return (
            <li key={r.key} className={`ap-q${!r.in_source && r.origin === "parsed" ? " ap-flag" : ""}`}>
              <div className="ap-q-head">
                <span className="ap-num">{i + 1}</span>
                {!r.in_source && r.origin === "parsed" && <span className="ov-tag ap-warn" title="The reader's wording could not be found in the application text. It may be paraphrased, or joined from two places.">Not found word for word</span>}
                {r.origin === "manual" && <span className="ov-tag">Added by hand</span>}
                {r.form_position != null && <span className="ov-muted ap-pos">Form item {r.form_position}</span>}
                <span className="spacer" />
                <button type="button" className="btn ghost ap-mini" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button type="button" className="btn ghost ap-mini" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button type="button" className="btn ghost ap-mini" disabled={i === rows.length - 1} onClick={() => merge(i)} title="Join this question with the next one">Merge with next</button>
                <button type="button" className="btn ghost ap-mini" onClick={() => split(i)} title="Put the cursor in the question where it should split, then press Split">Split</button>
                <button type="button" className="btn ghost ap-mini" onClick={() => toForm(i)} title="Move it to the form fields: a single value or a checkbox, not something to write">Not a written question</button>
                <button type="button" className="btn ghost ap-mini ap-del" onClick={() => remove(i)}>Delete</button>
              </div>
              <label>Question, in the funder&rsquo;s words
                <textarea rows={2} value={r.prompt} ref={el => { if (el) areas.current.set(r.key, el); else areas.current.delete(r.key); }}
                  onChange={e => update(r.key, { prompt: e.target.value })} />
              </label>
              <div className="ap-row">
                <label className="ap-limit">Limit
                  <span>
                    <input value={r.limit_value} inputMode="numeric" placeholder="none"
                      onChange={e => update(r.key, { limit_value: e.target.value.replace(/[^\d,]/g, "") })} />
                    <select value={r.limit_unit} onChange={e => update(r.key, { limit_unit: e.target.value as Row["limit_unit"] })}>
                      <option value="">unit</option><option value="words">words</option><option value="characters">characters</option>
                    </select>
                  </span>
                </label>
                <label className="ap-match">Question bank
                  <select value={current ?? NEW} onChange={e => update(r.key, { handSlug: e.target.value === NEW ? null : e.target.value, edited: false })}>
                    <option value={NEW}>A new topic (not in the bank)</option>
                    {bank.map(q => <option key={q.slug} value={q.slug}>{q.category}: {q.prompt_text.slice(0, 70)}</option>)}
                  </select>
                  <span className="ov-muted">
                    {r.handSlug !== undefined || r.reason === HAND ? "Chosen by hand."
                      : r.edited ? "Edited: matched again when you confirm."
                      : r.reason ?? ""}
                  </span>
                </label>
              </div>
              <details className="ap-more" open={!!(r.guidance || r.criteria)}>
                <summary>Guidance and scoring</summary>
                <label>Guidance and sub-prompts<textarea rows={2} value={r.guidance} onChange={e => update(r.key, { guidance: e.target.value })} /></label>
                <label>Scoring criteria<textarea rows={2} value={r.criteria} onChange={e => update(r.key, { criteria: e.target.value })} /></label>
              </details>
              <div className="ap-kinds"><span className="ov-muted">Card kinds it calls for:</span> <KindChips kinds={r.kinds} /></div>
            </li>
          );
        })}
      </ol>

      <button type="button" className="btn secondary" onClick={() => addAfter(rows.length - 1)}>＋ Add a question</button>

      <section className="ap-fields" aria-labelledby="ap-fields-head">
        <h3 id="ap-fields-head">Form fields ({formRows.length})</h3>
        <p className="ov-muted">
          Items on the funder&rsquo;s form that take a single value (a website, a number, a choice, yes or no) or a tick.
          They are not drafted with Story Cards. Change a field&rsquo;s type, or make it a written question if it needs prose.
        </p>
        {formRows.length > 0 && (
          <ol className="ap-list">
            {formRows.map((f, i) => (
              <li key={f.key} className={`ap-q ap-field${!f.in_source && f.origin === "parsed" ? " ap-flag" : ""}`}>
                <div className="ap-q-head">
                  <span className="ap-num">{i + 1}</span>
                  {!f.in_source && f.origin === "parsed" && <span className="ov-tag ap-warn" title="The reader's wording could not be found in the application text.">Not found word for word</span>}
                  {f.origin === "manual" && <span className="ov-tag">Added by hand</span>}
                  {f.form_position != null && <span className="ov-muted ap-pos">Form item {f.form_position}</span>}
                  <span className="spacer" />
                  <button type="button" className="btn ghost ap-mini" onClick={() => toWritten(f.key)} title="Move it to the questions, to be drafted with Story Cards">Make it a written question</button>
                  <button type="button" className="btn ghost ap-mini ap-del" onClick={() => removeForm(f.key)}>Delete</button>
                </div>
                <label>Field, in the funder&rsquo;s words
                  <textarea rows={1} value={f.prompt} onChange={e => updateForm(f.key, { prompt: e.target.value })} />
                </label>
                <div className="ap-row ap-field-row">
                  <label>Kind
                    <select value={f.kind} onChange={e => {
                      const kind = e.target.value as FormKind;
                      updateForm(f.key, { kind, answer_type: kind === "fact" ? (f.answer_type ?? "short_text") : null });
                    }}>
                      <option value="fact">Form fact: a value to fill in</option>
                      <option value="confirmation">Confirmation: a box to tick</option>
                    </select>
                  </label>
                  {f.kind === "fact" && (
                    <label>Answer
                      <select value={f.answer_type ?? "short_text"} onChange={e => updateForm(f.key, { answer_type: e.target.value as AnswerType })}>
                        {ANSWER_TYPES.map(t => <option key={t} value={t}>{ANSWER_TYPE_LABEL[t]}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                {f.kind === "fact" && f.answer_type === "choice" && (
                  <label>Choices, one per line
                    <textarea rows={Math.min(6, Math.max(2, f.options.split("\n").length))} value={f.options}
                      onChange={e => updateForm(f.key, { options: e.target.value })} />
                  </label>
                )}
                {f.guidance && <div className="ap-guidance">{f.guidance}</div>}
              </li>
            ))}
          </ol>
        )}
        <button type="button" className="btn secondary" onClick={addForm}>＋ Add a form field</button>
      </section>

      {attachments.length > 0 && (
        <div className="ap-attach"><strong>Attachments the application asks for:</strong> {attachments.join("; ")}</div>
      )}

      {error && <div className="ap-error" role="alert">{error}</div>}
      <div className="ap-actions">
        <button type="button" className="btn inline ap-go" disabled={!!busy || !!blocked || !rows.length} onClick={() => void confirmAll()} aria-busy={busy === "confirm"}
          title={blocked ?? (!rows.length ? "An application needs at least one question to write" : undefined)}>
          {busy === "confirm" ? "Confirming…" : `Confirm ${rows.length} question${rows.length === 1 ? "" : "s"}`}
        </button>
        <button type="button" className="btn secondary" disabled={!!busy || !dirty || !!blocked} onClick={() => void save()}>
          {busy === "save" ? "Saving…" : dirty ? "Save without confirming" : "Saved"}
        </button>
      </div>
    </div>
  );
}
