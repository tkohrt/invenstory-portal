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
import { confirmSectionsAction, reopenSectionsAction, saveSectionsAction, type SectionInput } from "@/lib/server/application-actions";
import { CARD_KIND_MAP } from "@/lib/story-card";
import type { BankOption } from "@/lib/server/drafts";
import type { DraftSection, GrantDraft } from "@/lib/types";

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
}

let seq = 0;
const nextKey = () => `k${++seq}`;

const toRow = (s: DraftSection): Row => ({
  key: nextKey(), id: s.id, prompt: s.prompt, guidance: s.guidance ?? "", criteria: s.criteria ?? "",
  limit_value: s.limit_value ? String(s.limit_value) : "", limit_unit: s.limit_unit ?? "",
  in_source: s.in_source, origin: s.origin,
  slug: s.question_slugs[0] ?? null, kinds: s.wanted_kinds, reason: s.match_reason,
  edited: s.matched_prompt !== s.prompt && s.match_reason !== HAND,
});

const toInput = (r: Row): SectionInput => {
  const n = Number(r.limit_value.replace(/[,\s]/g, ""));
  return {
    id: r.id, prompt: r.prompt, guidance: r.guidance || null, criteria: r.criteria || null,
    limit_value: Number.isInteger(n) && n > 0 && r.limit_unit ? n : null,
    limit_unit: Number.isInteger(n) && n > 0 && r.limit_unit ? r.limit_unit : null,
    ...(r.handSlug !== undefined ? { handSlug: r.handSlug } : {}),
  };
};

const SOURCE_LABEL: Record<string, string> = { paste: "pasted text", pdf: "a PDF", docx: "a Word file", url: "a web page", match: "Funder Matches" };

export default function ApplicationDraftView({ tenantName, draft, sections, bank, sourceText }: {
  tenantName: string; draft: GrantDraft; sections: DraftSection[]; bank: BankOption[]; sourceText: string;
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
          <button className="btn ghost" style={{ padding: "2px 4px", marginBottom: 4 }} onClick={() => router.push("/drafts")}>← In the Works</button>
          <h2>{draft.title}</h2>
          <p>{[draft.funder, money, draft.deadline ? `due ${new Date(draft.deadline + "T12:00:00").toLocaleDateString()}` : null].filter(Boolean).join(" · ")}</p>
          <p className="ov-muted" style={{ marginTop: 2 }}>
            From {SOURCE_LABEL[draft.source_kind ?? "paste"] ?? "an application"}
            {draft.source_filename ? `: ${draft.source_filename}` : ""}
            {draft.source_url ? <>: <a href={draft.source_url} target="_blank" rel="noopener noreferrer">{draft.source_url.replace(/^https?:\/\//, "").slice(0, 70)}</a></> : null}
          </p>
        </div>
      </div>

      {job && (running || needsRun) && <JobProgress job={job} events={events} lostContact={gaveUp} />}
      {running && !job && <div className="ov-note">Starting to read the application&hellip;</div>}
      {chainError && (
        <div className="ap-error" role="alert">
          {chainError}{" "}
          <button className="btn ghost" onClick={() => void runChain(false)}>Try again</button>
        </div>
      )}

      {draft.parsed_at && !running && (
        confirmed
          ? <ConfirmedQuestions draftId={draft.id} sections={sections} bank={bank} attachments={draft.required_attachments ?? []} />
          : <ConfirmQuestions
              key={sections.map(s => s.id + s.matched_prompt).join("|")}
              draftId={draft.id} sections={sections} bank={bank}
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

function ConfirmQuestions({ draftId, sections, bank, attachments, stats, truncated, onReread }: {
  draftId: string; sections: DraftSection[]; bank: BankOption[]; attachments: string[];
  stats?: Record<string, number>; truncated: boolean; onReread: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => sections.map(toRow));
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
  const blank = (): Row => ({ key: nextKey(), prompt: "", guidance: "", criteria: "", limit_value: "", limit_unit: "", in_source: false, origin: "manual", slug: null, kinds: [], reason: null, edited: true });
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

  const inputs = () => rows.map(toInput);
  const empty = rows.findIndex(r => !r.prompt.trim());

  const save = async () => {
    setBusy("save"); setError(null);
    try { await saveSectionsAction(draftId, inputs()); setDirty(false); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(null); }
  };
  const confirmAll = async () => {
    setBusy("confirm"); setError(null);
    try { await confirmSectionsAction(draftId, inputs()); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not confirm."); setBusy(null); }
  };

  const flagged = rows.filter(r => !r.in_source && r.origin === "parsed").length;
  const noLimit = rows.filter(r => !r.limit_value).length;

  return (
    <div className="ap-confirm">
      <div className="ap-summary">
        <strong>{rows.length} question{rows.length === 1 ? "" : "s"} found. Check them against the application before drafting.</strong>
        <span>
          Merge anything split in two, split anything that asks two things, delete anything that is not a question,
          and add anything missed.
          {flagged ? ` ${flagged} could not be found word for word in the application and are marked; fix their wording or confirm them as they are.` : ""}
          {noLimit ? ` ${noLimit} have no limit; add one where the funder states it.` : ""}
          {stats?.limitsRemoved ? ` ${stats.limitsRemoved} limit(s) the reader proposed were removed because the application does not state them.` : ""}
          {truncated ? " The application was longer than the reader takes, so the end was not read: check its last questions by hand." : ""}
        </span>
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
                <span className="spacer" />
                <button type="button" className="btn ghost ap-mini" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button type="button" className="btn ghost ap-mini" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button type="button" className="btn ghost ap-mini" disabled={i === rows.length - 1} onClick={() => merge(i)} title="Join this question with the next one">Merge with next</button>
                <button type="button" className="btn ghost ap-mini" onClick={() => split(i)} title="Put the cursor in the question where it should split, then press Split">Split</button>
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

      {attachments.length > 0 && (
        <div className="ap-attach"><strong>Attachments the application asks for:</strong> {attachments.join("; ")}</div>
      )}

      {error && <div className="ap-error" role="alert">{error}</div>}
      <div className="ap-actions">
        <button type="button" className="btn inline ap-go" disabled={!!busy || empty >= 0 || !rows.length} onClick={() => void confirmAll()} aria-busy={busy === "confirm"}
          title={empty >= 0 ? `Question ${empty + 1} is empty` : undefined}>
          {busy === "confirm" ? "Confirming…" : `Confirm ${rows.length} question${rows.length === 1 ? "" : "s"}`}
        </button>
        <button type="button" className="btn secondary" disabled={!!busy || !dirty || empty >= 0} onClick={() => void save()}>
          {busy === "save" ? "Saving…" : dirty ? "Save without confirming" : "Saved"}
        </button>
        <span className="spacer" />
        <button type="button" className="btn ghost" disabled={!!busy} onClick={onReread}>Read the application again</button>
      </div>
    </div>
  );
}

function ConfirmedQuestions({ draftId, sections, bank, attachments }: {
  draftId: string; sections: DraftSection[]; bank: BankOption[]; attachments: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const bySlug = new Map(bank.map(q => [q.slug, q]));
  const matched = sections.filter(s => s.question_slugs[0]).length;
  const reopen = async () => {
    setBusy(true);
    try { await reopenSectionsAction(draftId); router.refresh(); } finally { setBusy(false); }
  };
  return (
    <div className="ap-confirm">
      <div className="ap-summary ap-done">
        <strong>{sections.length} question{sections.length === 1 ? "" : "s"} confirmed.</strong>
        <span>{matched} match a question in the bank; {sections.length - matched} are new topics, logged so the bank can learn them.
          Drafting from Story Cards opens here in the next release.</span>
      </div>
      <ol className="ap-list">
        {sections.map((s, i) => (
          <li key={s.id} className="ap-q ap-q-done">
            <div className="ap-q-head">
              <span className="ap-num">{i + 1}</span>
              <span className="ap-prompt">{s.prompt}</span>
              <span className="spacer" />
              {s.limit_value && <span className="ov-tag">{s.limit_value.toLocaleString()} {s.limit_unit}</span>}
            </div>
            {s.guidance && <div className="ap-guidance">{s.guidance}</div>}
            <div className="ap-kinds">
              <span className="ov-muted">{s.question_slugs[0] ? `Bank: ${bySlug.get(s.question_slugs[0])?.category ?? s.question_slugs[0]}` : "New topic"} · </span>
              <KindChips kinds={s.wanted_kinds} />
            </div>
          </li>
        ))}
      </ol>
      {attachments.length > 0 && <div className="ap-attach"><strong>Attachments the application asks for:</strong> {attachments.join("; ")}</div>}
      <div className="ap-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void reopen()}>Reopen the questions to edit</button>
      </div>
    </div>
  );
}
