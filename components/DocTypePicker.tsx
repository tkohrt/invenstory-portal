"use client";
// A document's type, as a person sets it (decision 33): the analysis suggests,
// a person confirms with one click or picks another. File items on the
// readiness checklist count only once a document is tagged.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DOC_TYPES, DOC_TYPE_MAP } from "@/lib/analysis";
import { setDocTypeAction } from "@/lib/server/doc-type-actions";

export default function DocTypePicker({ documentId, tag, suggested, locked = false }: {
  documentId: string;
  /** The type a person gave it, if any. */
  tag: string | null;
  /** The analysis's suggestion, if any. */
  suggested: string | null;
  /** True when a client is looking at a type For Granted set. */
  locked?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choosing, setChoosing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = (type: string | null) => start(async () => {
    setErr(null);
    const r = await setDocTypeAction(documentId, type);
    if (!r.ok) { setErr(r.error); return; }
    setChoosing(false);
    router.refresh();
  });
  const label = (k: string | null) => (k ? DOC_TYPE_MAP[k]?.label ?? k : "");
  const select = (
    <select className="cl-select" disabled={pending} defaultValue="" aria-label="Document type"
      onChange={e => { if (e.target.value) save(e.target.value); }}>
      <option value="" disabled>Choose a type</option>
      {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
    </select>
  );

  if (tag && !choosing) {
    return (
      <span className="dt-pick">
        <span className="dt-tag">{label(tag)}</span>
        {!locked && <button type="button" className="fc-link" disabled={pending} onClick={() => setChoosing(true)}>change</button>}
        {err && <span className="cl-error">{err}</span>}
      </span>
    );
  }
  return (
    <span className="dt-pick">
      {!tag && suggested && !choosing && (
        <>
          <span className="dt-suggest">Looks like: {label(suggested)}</span>
          <button type="button" className="btn secondary ap-mini" disabled={pending} onClick={() => save(suggested)}>Confirm</button>
          <button type="button" className="fc-link" disabled={pending} onClick={() => setChoosing(true)}>something else</button>
        </>
      )}
      {(choosing || (!tag && !suggested)) && select}
      {choosing && <button type="button" className="fc-link" disabled={pending} onClick={() => setChoosing(false)}>cancel</button>}
      {tag && choosing && <button type="button" className="fc-link" disabled={pending} onClick={() => save(null)}>clear the type</button>}
      {err && <span className="cl-error">{err}</span>}
    </span>
  );
}
