"use client";
// The unified upload panel (P1.5, patch 38): the onboarding uploader, grown up
// and shared. One component now carries every upload in the portal: drag or
// choose several files, the title comes from the filename, and the layer and
// tags are set once and apply to what you add. Onboarding fixes the layer per
// step; the portal drawer lets you pick it.
//
// Since patch 59 (17 Nov 2026, Shane, walking setup as a test client) nothing
// uploads on choosing: files wait in a "Ready to add" list, each with its own
// document type (and outcome, for a past application) and a Remove button,
// and one Add button sends them. Before, a wrong file was stored and read
// before anybody could stop it, and the type had to be picked BEFORE choosing
// files, one type for the whole batch. Reading still starts as each arrives.
// The rules are in lib/upload-stage.ts (tested).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCEPT_ATTR, ACCEPTED_LABEL, SUPPORT_EMAIL } from "@/lib/uploads";
import { browserClient } from "@/lib/supabase-browser";
import { DOC_TYPES, DOC_TYPE_MAP } from "@/lib/analysis";
import { OUTCOMES, asksOutcomeAtUpload } from "@/lib/doc-outcome";
import { addLabel, sizeLabel, stageFiles, stageKey, type StagedInfo } from "@/lib/upload-stage";
import { NOT_SURE_LABEL, removeQuestion } from "@/lib/setup-docs";

export interface PanelDoc {
  id: string; title: string; status: string;
  /** The type a person gave it, if any (for the row's type select). */
  typeTag?: string | null;
  /** True when this person may remove it (setup: their own organization's uploads). */
  removable?: boolean;
  /** What the analysis thinks it is, offered for one-click confirming (patch 61). Never applied by itself. */
  suggested?: string | null;
}
type RowResult = { ok: true } | { ok: false; error: string };
interface Pending { key: string; name: string; state: "uploading" | "failed"; error?: string }

export default function UploadPanel({ fixedLayer, initialLayer = "I", typeTag: typeTagDefault = "", tagsDefault = "", allowLinks = false, showTypePicker = true, docs = [], addLink, onUploaded, onLayerChange, onStagedChange, onSetType, onRemove }: {
  /** Onboarding fixes the layer per step; without it the panel shows the layer select. */
  fixedLayer?: "I" | "II" | "III";
  initialLayer?: "I" | "II" | "III";
  /** Pre-set document type (e.g. funder_form in setup step 6). */
  typeTag?: string;
  tagsDefault?: string;
  /** Layer I only: paste a web link instead of a file. Needs addLink. */
  allowLinks?: boolean;
  /** Onboarding's funder-form box hides the picker; everywhere else it shows. */
  showTypePicker?: boolean;
  /** Already-arrived documents to show in the "Being read now" list (onboarding passes its step's docs). */
  docs?: PanelDoc[];
  /** Server action for a pasted link, scoped by the caller (setup vs portal). */
  addLink?: (url: string, layer: "I" | "II") => Promise<{ ok: true; message?: string } | { ok: false; error: string }>;
  /** Called after each successful upload, beyond the router refresh. */
  onUploaded?: () => void;
  /** The drawer shows the Living Voice prompts when Layer III is picked. */
  onLayerChange?: (layer: "I" | "II" | "III") => void;
  /** How many chosen files are waiting to be added, so the page can stop somebody leaving them behind. */
  onStagedChange?: (count: number) => void;
  /** Setup only (patch 60): change the type of a document that has already arrived. */
  onSetType?: (id: string, type: string | null) => Promise<RowResult>;
  /** Setup only (patch 60): remove a document that has already arrived. Asked for twice on the row. */
  onRemove?: (id: string) => Promise<RowResult>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [layer, setLayer] = useState<"I" | "II" | "III">(fixedLayer ?? initialLayer);
  const [tags, setTags] = useState(tagsDefault);
  // Chosen, not yet sent. The File objects live beside the list, by key.
  const [staged, setStaged] = useState<StagedInfo[]>([]);
  const files = useRef(new Map<string, File>());
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const effLayer = fixedLayer ?? layer;

  // Arrived documents (patch 60): the type shown at once while it saves, the
  // row being asked "remove?", rows already removed, and a row's own error.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);
  const changeType = async (d: PanelDoc, value: string) => {
    if (!onSetType) return;
    setRowErr(null); setRowBusy(d.id);
    setTyped(t => ({ ...t, [d.id]: value }));
    const r = await onSetType(d.id, value || null).catch((): RowResult => ({ ok: false, error: "The type could not be saved. Please try again." }));
    if (!r.ok) {
      setTyped(t => { const n = { ...t }; delete n[d.id]; return n; });
      setRowErr({ id: d.id, text: r.error });
    }
    setRowBusy(null);
  };
  const removeDoc = async (d: PanelDoc) => {
    if (!onRemove) return;
    setRowErr(null); setRowBusy(d.id);
    const r = await onRemove(d.id).catch((): RowResult => ({ ok: false, error: "That document could not be removed. Please try again." }));
    if (r.ok) setGone(g => new Set(g).add(d.id));
    else setRowErr({ id: d.id, text: r.error });
    setAsking(null); setRowBusy(null);
  };
  const shown = docs.filter(d => !gone.has(d.id));

  const stagedCount = staged.length;
  const tell = useRef(onStagedChange);
  useEffect(() => { tell.current = onStagedChange; });
  useEffect(() => { tell.current?.(stagedCount); }, [stagedCount]);
  useEffect(() => () => { tell.current?.(0); }, []);

  const one = async (file: File, typeTag: string, outcome: string) => {
    const key = `${file.name}-${file.size}-${Math.random()}`;
    setPending(x => [...x, { key, name: file.name, state: "uploading" }]);
    try {
      // Straight to storage with a one-time URL: posting the file to the portal
      // hit Vercel's 4.5 MB request limit well below the promised 25 MB.
      const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const s = await fetch("/api/upload/sign", json({ filename: file.name, size: file.size }));
      const sb = await s.json().catch(() => ({}));
      if (!s.ok) throw new Error(sb.error ?? `Upload failed (${s.status})`);
      const { error: upErr } = await browserClient().storage.from("documents")
        .uploadToSignedUrl(sb.path, sb.token, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) throw new Error(`The file could not be stored: ${upErr.message}`);
      const c = await fetch("/api/upload/complete", json({
        docId: sb.docId, filename: file.name, contentType: file.type,
        title: file.name.replace(/\.[^.]+$/, ""), layer: effLayer, tags, typeTag,
        outcome: asksOutcomeAtUpload(typeTag) ? outcome : "",
      }));
      const cb = await c.json().catch(() => ({}));
      if (!c.ok) throw new Error(cb.error ?? `Upload failed (${c.status})`);
      setPending(x => x.filter(p => p.key !== key));
      onUploaded?.();
      router.refresh();
    } catch (e) {
      setPending(x => x.map(p => p.key === key ? { ...p, state: "failed", error: e instanceof Error ? e.message : "Upload failed." } : p));
    }
  };
  /** Chosen or dropped: into the waiting list. Nothing is sent yet. */
  const many = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const r = stageFiles(staged, incoming, typeTagDefault);
    for (const f of incoming) { const k = stageKey(f); if (!files.current.has(k)) files.current.set(k, f); }
    setStaged(r.staged);
    if (r.refused.length) {
      setPending(x => [...x, ...r.refused.map(n => ({ key: `${n.name}-${Math.random()}`, name: n.name, state: "failed" as const, error: n.reason }))]);
    }
  };
  const setOne = (key: string, patch: Partial<StagedInfo>) => setStaged(x => x.map(s => s.key === key ? { ...s, ...patch } : s));
  const removeOne = (key: string) => { files.current.delete(key); setStaged(x => x.filter(s => s.key !== key)); };
  const clearAll = () => { files.current.clear(); setStaged([]); };
  /** The one moment anything is sent: each waiting file, with the type on its own row. */
  const addAll = () => {
    const batch = staged;
    setStaged([]);
    for (const s of batch) {
      const file = files.current.get(s.key);
      files.current.delete(s.key);
      if (file) void one(file, s.typeTag, asksOutcomeAtUpload(s.typeTag) ? s.outcome : "");
    }
  };

  const doLink = async () => {
    if (!addLink || effLayer === "III" || !link.trim()) return;
    setLinkBusy(true); setLinkErr(null);
    try {
      const r = await addLink(link, effLayer);
      if (!r.ok) setLinkErr(r.error); else { setLink(""); onUploaded?.(); router.refresh(); }
    } catch { setLinkErr("That link could not be added. Please try again."); }
    finally { setLinkBusy(false); }
  };

  const label = (s: string) => s === "ready" ? "Read" : s === "failed" ? "Needs attention" : s === "processing" ? "Reading" : "Waiting";

  return (
    <div className="su-upload">
      {!fixedLayer && (
        <div className="up-settings">
          <label>Layer
            <select value={layer} onChange={e => { const v = e.target.value as "I" | "II" | "III"; setLayer(v); onLayerChange?.(v); }}>
              <option value="I">Layer I — Public Story</option>
              <option value="II">Layer II — Internal Strategy</option>
              <option value="III">Layer III — Living Voice</option>
            </select>
          </label>
          <label>Tags
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="comma-separated, e.g. budget, transportation" />
          </label>
        </div>
      )}
      <div className={`su-drop ${over ? "over" : ""}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); many(e.dataTransfer.files); }}>
        <b>Drag files here</b>
        <span className="su-small">{ACCEPTED_LABEL}. Up to 25 MB each. The title comes from the filename. Nothing uploads until you press Add.</span>
        <button type="button" className="sb-btn sb-secondary sb-sm" onClick={() => input.current?.click()}>Choose files</button>
        <input ref={input} type="file" multiple hidden accept={ACCEPT_ATTR} onChange={e => { many(e.target.files); e.target.value = ""; }} />
      </div>
      {staged.length > 0 && (
        <div className="su-staged" role="group" aria-label="Files ready to add">
          <h4>Ready to add</h4>
          <p className="su-small">Nothing has been uploaded yet. Check these are the right files{showTypePicker ? ", say what each one is if you know," : ""} then add them.</p>
          <ul>
            {staged.map(sf => (
              <li key={sf.key}>
                <span className="su-st-name"><b>{sf.name}</b><i>{sizeLabel(sf.size)}</i></span>
                <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => removeOne(sf.key)} aria-label={`Remove ${sf.name}`}>Remove</button>
                {showTypePicker && (
                  <span className="su-st-picks">
                    <select aria-label={`What kind of document is ${sf.name}?`} value={sf.typeTag} onChange={e => setOne(sf.key, { typeTag: e.target.value })}>
                      <option value="">{NOT_SURE_LABEL}</option>
                      {DOC_TYPES.filter(t => t.key !== "other").map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                    {asksOutcomeAtUpload(sf.typeTag) && (
                      <select aria-label={`How did ${sf.name} turn out?`} value={sf.outcome} onChange={e => setOne(sf.key, { outcome: e.target.value })}>
                        <option value="">Outcome not set</option>
                        {OUTCOMES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="su-st-foot">
            {staged.length > 1 && <button type="button" className="sb-btn sb-quiet sb-sm" onClick={clearAll}>Remove all</button>}
            <button type="button" className="sb-btn sb-primary" onClick={addAll}>{addLabel(staged.length)}</button>
          </div>
        </div>
      )}
      {allowLinks && addLink && effLayer === "I" && (
        <div className="su-link">
          <input value={link} onChange={e => setLink(e.target.value)} placeholder="Or paste a web link, e.g. a press article"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void doLink(); } }} />
          <button type="button" className="sb-btn sb-secondary sb-sm" disabled={linkBusy || !link.trim()} onClick={doLink}>{linkBusy ? "Reading…" : "Add link"}</button>
        </div>
      )}
      {linkErr && <p className="cl-error">{linkErr}</p>}
      {(pending.length > 0 || shown.length > 0) && (
        <div className="su-files">
          <h4>Being read now</h4>
          <p className="su-small">We start reading as soon as a file arrives. Carry on; nothing waits for this.</p>
          <ul>
            {pending.map(f => <li key={f.key} className={f.state}><span>{f.name}</span><em>{f.state === "uploading" ? "Uploading" : f.error}</em></li>)}
            {/* A document that has been read is plainly finished (patch 57,
                17 Nov 2026, Shane): a light green row and a round green tick
                after "Read". The tick is decoration; the word carries it. */}
            {/* And it can still be put right (patch 60): where the page
                passes onSetType / onRemove (setup does), each arrived row
                carries its own type select and a Remove that asks first. */}
            {shown.map(d => {
              const canType = !!onSetType && showTypePicker;
              const canRemove = !!onRemove && !!d.removable;
              const reading = d.status === "processing";
              // A suggestion is on offer only while nobody has typed the document.
              const offered = canType && !(typed[d.id] ?? d.typeTag) && !!d.suggested && !!DOC_TYPE_MAP[d.suggested];
              return (
                <li key={d.id} className={`${d.status}${canType || canRemove ? " su-managed" : ""}`}>
                  <span className="su-doc-title">{d.title}</span>
                  <em>{label(d.status)}{d.status === "ready" && (
                    <svg className="su-tick" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <circle cx="8" cy="8" r="8" fill="currentColor" />
                      <path d="M4.4 8.3l2.3 2.3 4.9-5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}</em>
                  {(canType || canRemove) && (
                    <span className="su-doc-ctl">
                      {/* The analysis's suggestion, confirmed here with one
                          click (patch 61). A person makes it the type; the
                          select beside it is "something else". */}
                      {offered && d.suggested && (
                        <span className="su-suggest">
                          <span>Looks like: <b>{DOC_TYPE_MAP[d.suggested].label}</b></span>
                          <button type="button" className="sb-btn sb-secondary sb-sm" disabled={rowBusy === d.id}
                            onClick={() => void changeType(d, d.suggested!)} aria-label={`Confirm ${d.title} is ${DOC_TYPE_MAP[d.suggested].label}`}>Confirm</button>
                        </span>
                      )}
                      {canType && (
                        <select aria-label={`What kind of document is ${d.title}?`} disabled={rowBusy === d.id}
                          className={offered ? "su-else" : undefined}
                          value={typed[d.id] ?? d.typeTag ?? ""} onChange={e => void changeType(d, e.target.value)}>
                          <option value="">{offered ? "Something else" : NOT_SURE_LABEL}</option>
                          {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                      )}
                      {canRemove && asking !== d.id && (
                        <button type="button" className="sb-btn sb-quiet sb-sm" disabled={reading || rowBusy === d.id}
                          title={reading ? "Available once this document has been read." : undefined}
                          onClick={() => { setRowErr(null); setAsking(d.id); }} aria-label={`Remove ${d.title}`}>Remove</button>
                      )}
                    </span>
                  )}
                  {canRemove && asking === d.id && (
                    <span className="su-doc-ask" role="alert">
                      <span>{removeQuestion(d.title)}</span>
                      <span className="su-unadded-btns">
                        <button type="button" className="sb-btn sb-secondary sb-sm" disabled={rowBusy === d.id} onClick={() => setAsking(null)}>Keep it</button>
                        <button type="button" className="sb-btn sb-danger sb-sm" disabled={rowBusy === d.id} onClick={() => void removeDoc(d)}>{rowBusy === d.id ? "Removing" : "Yes, remove it"}</button>
                      </span>
                    </span>
                  )}
                  {rowErr?.id === d.id && <span className="su-doc-err" role="alert">{rowErr.text}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="hint">Have an image, slide deck, or another file type? Email it to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&rsquo;ll add it for you.</div>
    </div>
  );
}
