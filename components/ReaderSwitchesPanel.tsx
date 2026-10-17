"use client";
// The client's activity page, Document reader tab: what this client sees in the
// Document Reader (decision 1, 17 October 2026; mockup third artboard). For
// Granted always sees everything; these decide what the client sees. Each
// switch saves at once and is enforced on the server (lib/server/reader.ts).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { READER_FEATURES, switchBlocked, type ReaderFeatureKey } from "@/lib/reader-features";
import { setReaderFeatureAction } from "@/lib/server/reader-actions";

export default function ReaderSwitchesPanel({ tenantId, tenantName, switches, workspace }: {
  tenantId: string; tenantName: string;
  switches: Record<ReaderFeatureKey, boolean>; workspace: Record<string, boolean>;
}) {
  const router = useRouter();
  const [on, setOn] = useState(switches);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const flip = (key: ReaderFeatureKey) => start(async () => {
    setErr(null);
    const next = !on[key];
    setOn(o => ({ ...o, [key]: next }));
    const r = await setReaderFeatureAction(tenantId, key, next);
    if (!r.ok) { setOn(o => ({ ...o, [key]: !next })); setErr(r.error); return; }
    router.refresh();
  });

  return (
    <section className="rs-panel" aria-labelledby="rs-h">
      <h3 id="rs-h">Document reader · {tenantName}</h3>
      <p className="rs-intro">For Granted always sees everything. These decide what this client sees when they open one of their documents.</p>
      {err && <p className="ap-error">{err}</p>}
      <div className="rs-row">
        <div className="rs-copy"><span className="rs-name">Full text and search</span><span className="rs-hint">Always on: the text of their own documents</span></div>
        <button type="button" role="switch" aria-checked="true" aria-label="Full text and search" className="rs-switch" disabled title="Always on" />
      </div>
      {READER_FEATURES.map(f => {
        const blocked = switchBlocked(f, workspace);
        const hint = [f.hint, f.later ? "Comes with a later release; saved now, no effect yet" : null,
          f.defaultOn === "card_review" ? "Starts on for clients who have Story Cards" : null,
          blocked && on[f.key] ? `${blocked}, so it has no effect yet` : blocked].filter(Boolean).join(". ");
        return (
          <div className="rs-row" key={f.key}>
            <div className="rs-copy"><span className="rs-name">{f.label}</span><span className="rs-hint">{hint}</span></div>
            <button type="button" role="switch" aria-checked={on[f.key]} aria-label={f.label} className="rs-switch"
              disabled={pending} onClick={() => flip(f.key)} />
          </div>
        );
      })}
    </section>
  );
}
