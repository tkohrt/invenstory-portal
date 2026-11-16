"use client";
// Eligibility answers found in the client's documents, on the Funding
// Eligibility page (patch 52). They used to appear only on the Analyze page,
// which is off unless For Granted turns it on.
//
// Nothing reaches the profile without a person's click: the client's, or For
// Granted's while viewing the client, which is recorded under their name.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideSuggestionAction } from "@/lib/server/analysis-client-actions";
import type { OpenSuggestion } from "@/lib/analysis-client";

export default function FoundInDocuments({ suggestions, adminViewing, onConfirmed }: {
  suggestions: OpenSuggestion[];
  adminViewing: boolean;
  /** Tell the form, so the field shows the confirmed answer and a later Save does not undo it. */
  onConfirmed: (field: string, value: string) => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Decided here, hidden at once; the page's own refresh then drops them for good.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const k = (field: string, value: string) => `${field}|${value}`;
  const decide = (field: string, value: string, decision: "confirmed" | "rejected") => start(async () => {
    setErr(null);
    try {
      await decideSuggestionAction(field, value, decision);
      if (decision === "confirmed") onConfirmed(field, value);
      setGone(g => new Set(g).add(k(field, value)));
      router.refresh();
    } catch {
      // Production hides a thrown reason, so say the useful thing ourselves.
      setErr("That did not save. Reload the page and try again.");
    }
  });
  const open = suggestions
    .map(s => ({ ...s, open: s.open.filter(v => !gone.has(k(s.field, v.value))) }))
    .filter(s => s.open.length > 0);
  if (open.length === 0) return null;
  const count = open.reduce((n, s) => n + s.open.length, 0);

  return (
    <section className="acct-card found-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Found in your documents</h3>
        <div className="spacer" style={{ flex: 1 }} />
        <span className="su-badge">{count} to confirm</span>
      </div>
      <p className="acct-note" style={{ marginTop: 8 }}>
        We read your documents and found {count === 1 ? "an answer" : "answers"} to the questions on this page, each shown with the line it came from.
        Nothing is saved to your profile until you confirm it.
      </p>
      {adminViewing && <p className="acct-note"><b>For Granted view:</b> confirming here answers on the client&rsquo;s behalf, and is recorded under your name.</p>}
      {err && <div className="cl-error">{err}</div>}
      <div className="found-list">
        {open.map(s => (
          <div key={s.field} className="found-item">
            <div><b>{s.label}</b>{s.current.length > 0 && <span className="found-now"> · on your profile now: {s.current.join(", ")}</span>}</div>
            {s.conflicting && <div className="found-warn">Your documents give more than one answer. Confirm the right one.</div>}
            {s.open.map(v => (
              <div key={v.value} className="found-val">
                <div className="found-val-head">
                  <span className="found-val-text">{v.display}</span>
                  {(
                    <span className="found-acts">
                      <button type="button" className="btn inline found-yes" disabled={busy} onClick={() => decide(s.field, v.value, "confirmed")}>Confirm</button>
                      <button type="button" className="btn ghost found-no" disabled={busy} onClick={() => decide(s.field, v.value, "rejected")}>Not right</button>
                    </span>
                  )}
                </div>
                {v.sources.slice(0, 2).map(src => (
                  <div key={src.id} className="found-src">{`“${src.quote.slice(0, 200)}”`} · {src.title}</div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
