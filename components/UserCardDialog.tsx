"use client";
// Saving what a writer typed as a user-generated Story Card (8 October 2026).
//
// Nothing is asked while typing. Here, everything is already filled in (the
// kind the question asks for, Living voice, "Written by", today) and the writer
// presses Save, or changes a field first. The one optional question appears
// only when the text has a number: is it from a document? If a card in the
// library already says the same thing, it is offered instead.
import { useEffect, useState } from "react";
import { prepareUserCardAction, saveUserCardAction, type UserCardDefaults } from "@/lib/server/user-card-actions";
import { USER_GENERATED } from "@/lib/user-card";

const LAYERS: { key: "I" | "II" | "III"; label: string }[] = [
  { key: "III", label: "Living voice (a person's own account)" },
  { key: "II", label: "Internal (how the organization works)" },
  { key: "I", label: "Public story (anything the world can see)" },
];

export default function UserCardDialog({ text, sectionId, preferKind, onSaved, onUseExisting, onCancel }: {
  text: string; sectionId: string | null;
  /** The kind the gap panel's Add it now was pressed for. */
  preferKind?: string | null;
  onSaved: (cardId: string) => void;
  /** A verified card already in the library says the same thing: use it instead. */
  onUseExisting: (cardId: string) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<UserCardDefaults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState("");
  const [layer, setLayer] = useState<"I" | "II" | "III">("III");
  const [asOf, setAsOf] = useState("");
  const [saidBy, setSaidBy] = useState("");
  const [fromDoc, setFromDoc] = useState("");
  const [more, setMore] = useState(false);

  useEffect(() => {
    let live = true;
    prepareUserCardAction(text, sectionId).then(x => {
      if (!live) return;
      setD(x); setLayer(x.layer); setAsOf(x.asOf);
      setKind(preferKind && x.kinds.some(k => k.key === preferKind) ? preferKind : x.kind);
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : "Could not open the card."); });
    return () => { live = false; };
  }, [text, sectionId, preferKind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const save = async () => {
    if (!d) return;
    setSaving(true); setError(null);
    const r = await saveUserCardAction({ text, kind, layer, asOf, saidBy, fromDocument: fromDoc, sectionId }).catch(() => null);
    setSaving(false);
    if (!r) { setError("Could not save the card. Please try again."); return; }
    if (!r.ok) {
      if (r.existingId) { onUseExisting(r.existingId); return; }
      setError(r.error); return;
    }
    onSaved(r.cardId);
  };

  return (
    <div className="ws-modal-back" role="presentation" onClick={onCancel}>
      <div className="ws-modal uc-modal" role="dialog" aria-modal="true" aria-labelledby="uc-title" onClick={e => e.stopPropagation()}>
        <h3 id="uc-title">Save as a Story Card</h3>
        <div className="ws-card l3 uc-preview">
          <div className="cl-card-head"><span className="cl-kind">{d?.kinds.find(k => k.key === kind)?.label ?? "Story Card"}</span><span className="uc-tag">{USER_GENERATED}</span></div>
          <p className="cl-statement">{text}</p>
        </div>
        {!d && !error && <p className="ov-muted">Getting it ready…</p>}
        {d && d.problem && <div className="ap-error">{d.problem}</div>}
        {d && !d.problem && (
          <>
            {d.lookAlikes.length > 0 && (
              <div className="ws-warn ws-soft uc-alike">
                <strong>This looks like {d.lookAlikes.length === 1 ? "a card" : "cards"} already in the library.</strong>
                {d.lookAlikes.map(c => (
                  <div key={c.id} className="uc-alike-row">
                    <span>{c.kindLabel}: {c.statement.slice(0, 160)}{c.statement.length > 160 ? "…" : ""}</span>
                    {c.verified
                      ? <button type="button" className="btn secondary ap-mini" onClick={() => onUseExisting(c.id)}>Use this one</button>
                      : <span className="ov-muted">(not yet verified)</span>}
                  </div>
                ))}
                <span className="ov-muted">Or save yours anyway.</span>
              </div>
            )}
            <div className="uc-fields">
              <label>Kind
                <select className="cl-select" value={kind} onChange={e => setKind(e.target.value)}>
                  {d.kinds.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </label>
              <p className="uc-source">{d.source}.</p>
              {d.figures.length > 0 && (
                <label>Is {d.figures.slice(0, 3).join(", ")} from a document? <span className="ov-muted">(optional)</span>
                  <input value={fromDoc} onChange={e => setFromDoc(e.target.value)} placeholder="For example: 2025 annual report, page 4" />
                </label>
              )}
              {!more
                ? <button type="button" className="cl-link uc-more" onClick={() => setMore(true)}>More details (layer, whose words, date)</button>
                : <>
                    <label>Layer
                      <select className="cl-select" value={layer} onChange={e => setLayer(e.target.value as "I" | "II" | "III")}>
                        {LAYERS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
                      </select>
                    </label>
                    <label>In someone else&rsquo;s words? <span className="ov-muted">(optional)</span>
                      <input value={saidBy} onChange={e => setSaidBy(e.target.value)} placeholder="For example: Ashley Barrow, CEO. Leave blank if they are yours." />
                    </label>
                    <label>True as of
                      <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} />
                    </label>
                  </>}
            </div>
            <p className="ov-muted uc-note">Saved to the Story Cards with a {USER_GENERATED} label, and filed in the Inven(s)tory as a Writer&rsquo;s note, so the card has a source like every other.</p>
          </>
        )}
        {error && <div className="ap-error">{error}</div>}
        <div className="ws-modal-acts">
          <button type="button" className="btn secondary" onClick={onCancel}>Keep as my words</button>
          {d && !d.problem && <button type="button" className="btn inline ap-go" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save to Story Cards"}</button>}
        </div>
      </div>
    </div>
  );
}
