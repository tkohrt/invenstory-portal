"use client";
// The welcome screen's admin side (patch 43): the note and optional video
// Shane and Tyler pre-set per client, shown once on that client's first
// sign-in. Blank keeps the default welcome.
import { useState } from "react";
import { saveWelcomeAction } from "@/lib/server/admin-actions";

export default function WelcomeCard({ tenantId, note: initialNote, videoUrl: initialVideo, setupDone }: {
  tenantId: string; note: string; videoUrl: string;
  /** True once the client has finished setup (the screen will not show again). */
  setupDone: boolean;
}) {
  const [note, setNote] = useState(initialNote);
  const [video, setVideo] = useState(initialVideo);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    const r = await saveWelcomeAction({ tenantId, note, videoUrl: video }).catch(() => ({ ok: false as const, error: "That did not save. Try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setMsg(note.trim() ? "Saved. They will see it on their first sign-in." : "Saved. They will see the default welcome.");
  };
  return (
    <section className="wc-card">
      <h3>Their welcome</h3>
      <p className="wc-sub">
        Shown once, on this client&rsquo;s first sign-in, above the setup steps. Blank means the standard welcome.
        {setupDone && " This client has already finished setup, so a note set now will not be seen unless setup is reopened."}
      </p>
      <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={2000}
        placeholder={"e.g. Emily, we built this portal with organizations like CurioLab in mind. Everything you add here compounds; nothing you write is ever wasted again."} />
      <input value={video} onChange={e => setVideo(e.target.value)}
        placeholder="Welcome video link (optional, https; a Loom or a hosted mp4)" />
      <div className="wc-foot">
        <button type="button" className="sb-btn sb-primary sb-sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save welcome"}</button>
        {msg && <span className="wc-ok">{msg}</span>}
        {err && <span className="cl-error">{err}</span>}
      </div>
    </section>
  );
}
