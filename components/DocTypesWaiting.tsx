"use client";
// Documents waiting for a type, on the Inven(s)tory page (patch 52). The
// picker is the Analyze page's own; this puts it where a client already is.
import DocTypePicker from "./DocTypePicker";
import type { TypeWaiting } from "@/lib/analysis-client";

export default function DocTypesWaiting({ types }: { types: TypeWaiting[] }) {
  if (types.length === 0) return null;
  const n = types.length;
  return (
    <section className="acct-card types-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Confirm what each document is</h3>
        <div className="spacer" style={{ flex: 1 }} />
        <span className="su-badge">{n} to confirm</span>
      </div>
      <p className="acct-note" style={{ marginTop: 8 }}>
        {n === 1 ? "One document needs its type confirmed." : `${n} documents need their type confirmed.`} This
        is what marks items such as your 990, budget and board roster as covered on your Readiness list. One click each.
      </p>
      {types.some(d => !d.suggested) && <p className="acct-note">Where we could not tell what a document is, choose its type from the list. Other is a fine answer.</p>}
      <div className="types-list">
        {types.map(d => (
          <div key={d.id} className="types-row">
            <span className="types-title">{d.title}</span>
            <DocTypePicker documentId={d.id} tag={null} suggested={d.suggested} />
          </div>
        ))}
      </div>
    </section>
  );
}
