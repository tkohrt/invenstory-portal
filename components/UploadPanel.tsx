"use client";
// The unified upload panel (P1.5, patch 38): the onboarding uploader, grown up
// and shared. One component now carries every upload in the portal: drag or
// choose several files, reading starts as soon as each arrives, the title
// comes from the filename, and the layer, document type, tags and (for a past
// application) outcome are set once and apply to what you drop. Onboarding
// fixes the layer per step; the portal drawer lets you pick it.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCEPT_ATTR, ACCEPTED_LABEL, SUPPORT_EMAIL, isAccepted } from "@/lib/uploads";
import { browserClient } from "@/lib/supabase-browser";
import { DOC_TYPES } from "@/lib/analysis";
import { OUTCOMES, asksOutcomeAtUpload } from "@/lib/doc-outcome";

export interface PanelDoc { id: string; title: string; status: string }
interface Pending { key: string; name: string; state: "uploading" | "failed"; error?: string }

export default function UploadPanel({ fixedLayer, initialLayer = "I", typeTag: typeTagDefault = "", tagsDefault = "", allowLinks = false, showTypePicker = true, docs = [], addLink, onUploaded, onLayerChange }: {
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
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [layer, setLayer] = useState<"I" | "II" | "III">(fixedLayer ?? initialLayer);
  const [typeTag, setTypeTag] = useState(typeTagDefault);
  const [tags, setTags] = useState(tagsDefault);
  const [outcome, setOutcome] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const effLayer = fixedLayer ?? layer;

  const one = async (file: File) => {
    const key = `${file.name}-${file.size}-${Math.random()}`;
    if (!isAccepted(file.name)) {
      setPending(x => [...x, { key, name: file.name, state: "failed", error: `Not a type the portal reads. Email it to ${SUPPORT_EMAIL} and we will add it.` }]);
      return;
    }
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
  const many = (files: FileList | null) => { if (files) for (const f of Array.from(files)) void one(f); };

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
      {(!fixedLayer || showTypePicker) && (
        <div className="up-settings">
          {!fixedLayer && (
            <label>Layer
              <select value={layer} onChange={e => { const v = e.target.value as "I" | "II" | "III"; setLayer(v); onLayerChange?.(v); }}>
                <option value="I">Layer I — Public Story</option>
                <option value="II">Layer II — Internal Strategy</option>
                <option value="III">Layer III — Living Voice</option>
              </select>
            </label>
          )}
          {showTypePicker && (
            <label>What kind of document?
              <select value={typeTag} onChange={e => setTypeTag(e.target.value)}>
                <option value="">Not sure (we&rsquo;ll suggest one)</option>
                {DOC_TYPES.filter(t => t.key !== "other").map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
          )}
          {showTypePicker && asksOutcomeAtUpload(typeTag) && (
            <label>How did it turn out?
              <select value={outcome} onChange={e => setOutcome(e.target.value)}>
                <option value="">Not set</option>
                {OUTCOMES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </label>
          )}
          {!fixedLayer && (
            <label>Tags
              <input value={tags} onChange={e => setTags(e.target.value)} placeholder="comma-separated, e.g. budget, transportation" />
            </label>
          )}
        </div>
      )}
      <div className={`su-drop ${over ? "over" : ""}`}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); many(e.dataTransfer.files); }}>
        <b>Drag files here</b>
        <span className="su-small">{ACCEPTED_LABEL}. Up to 25 MB each. The title comes from the filename.</span>
        <button type="button" className="sb-btn sb-secondary sb-sm" onClick={() => input.current?.click()}>Choose files</button>
        <input ref={input} type="file" multiple hidden accept={ACCEPT_ATTR} onChange={e => { many(e.target.files); e.target.value = ""; }} />
      </div>
      {allowLinks && addLink && effLayer === "I" && (
        <div className="su-link">
          <input value={link} onChange={e => setLink(e.target.value)} placeholder="Or paste a web link, e.g. a press article"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void doLink(); } }} />
          <button type="button" className="sb-btn sb-secondary sb-sm" disabled={linkBusy || !link.trim()} onClick={doLink}>{linkBusy ? "Reading…" : "Add link"}</button>
        </div>
      )}
      {linkErr && <p className="cl-error">{linkErr}</p>}
      {(pending.length > 0 || docs.length > 0) && (
        <div className="su-files">
          <h4>Being read now</h4>
          <p className="su-small">We start reading as soon as a file arrives. Carry on; nothing waits for this.</p>
          <ul>
            {pending.map(f => <li key={f.key} className={f.state}><span>{f.name}</span><em>{f.state === "uploading" ? "Uploading" : f.error}</em></li>)}
            {docs.map(d => <li key={d.id} className={d.status}><span>{d.title}</span><em>{label(d.status)}</em></li>)}
          </ul>
        </div>
      )}
      <div className="hint">Have an image, slide deck, or another file type? Email it to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&rsquo;ll add it for you.</div>
    </div>
  );
}
