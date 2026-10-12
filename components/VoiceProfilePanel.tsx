"use client";
// The client's voice profile, for For Granted to read and correct (Auto-Draft
// patch 4). Plumbing only: nothing writes it automatically. Rules in
// lib/voice-profile.ts; reads and the save in lib/server/voice-profile.ts.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveVoiceProfileAction, type VoiceProfileView } from "@/lib/server/voice-profile";
import { PROFILE_MAX_CHARS, VOICE_KIND_LABEL, sourceWeight } from "@/lib/voice-profile";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default function VoiceProfilePanel({ v }: { v: VoiceProfileView }) {
  const router = useRouter();
  const [text, setText] = useState(v.text);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = text.trim() !== v.text.trim();
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await saveVoiceProfileAction(v.tenantId, text);
      setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    } catch { setMsg({ ok: false, text: "Could not reach the portal. Check the connection and try again." }); }
    setBusy(false);
  };
  const c = v.changed;

  if (!v.ready) return <div className="cl-error">The voice profile needs migration 0062. Its sources are listed below.</div>;
  return (
    <div className="vp">
      <p className="ov-muted vp-intro">How this client tends to build answers: where stories sit against data, how bridges open and close,
        paragraph shape, the words they reach for. <strong>Voice and structure only, never facts:</strong> every figure, name and claim in a
        draft still comes from a placed Story Card. Nothing writes this automatically yet; the guide for writing it is still to come.</p>

      <div className={`vp-min ${v.minimum.met ? "vp-ok" : "vp-no"}`} role="status">
        {v.minimum.met ? "Enough to auto-draft from: at least one approved Standard Answer or tagged past application." : v.minimum.message}
      </div>

      {c?.any && (
        <div className="vp-changed" role="status">
          <strong>The sources have changed since this profile was last saved.</strong>
          <ul>
            {c.added.map(s => <li key={`a${s.id}`}>New: {s.title} ({VOICE_KIND_LABEL[s.kind]}{s.winning ? ", winning" : ""})</li>)}
            {c.outcome.map(s => <li key={`o${s.id}`}>{s.winning ? "Now winning" : "No longer winning"}: {s.title}</li>)}
            {c.removed.map(s => <li key={`r${s.id}`}>Gone: {s.title}</li>)}
          </ul>
          Check whether the profile still holds, then save it to clear this.
        </div>
      )}

      <label htmlFor="vp-text" className="vp-label">Voice profile</label>
      <textarea id="vp-text" className="vp-text" rows={12} value={text} maxLength={PROFILE_MAX_CHARS}
        placeholder="Not written yet." onChange={e => { setText(e.target.value); setMsg(null); }} />
      <div className="vp-acts">
        <span className="ov-muted">
          {v.editedAt ? `Last saved ${day(v.editedAt)}${v.editedBy ? ` by ${v.editedBy}` : ""}.` : "Never saved."}
          {" "}{text.length.toLocaleString()} of {PROFILE_MAX_CHARS.toLocaleString()} characters.
        </span>
        {msg && <span className={msg.ok ? "vp-saved" : "cl-error vp-err"}>{msg.text}</span>}
        <button type="button" className="btn inline" disabled={busy || (!dirty && !c?.any)} onClick={() => void save()}>
          {busy ? "Saving…" : "Save the profile"}</button>
      </div>

      <h3 className="vp-h">Sources ({v.sources.length})</h3>
      {v.sources.length === 0
        ? <p className="ov-muted">None yet. Approve a Standard Answer, or tag a document Past grant application.</p>
        : <ul className="vp-sources">
            {v.sources.map(s => (
              <li key={`${s.kind}${s.id}`}>
                <span className="vp-kind">{VOICE_KIND_LABEL[s.kind]}</span>
                <span className="vp-title">{s.title}</span>
                {s.winning && <span className="win-tag">★ Winning</span>}
                <span className="ov-muted vp-weight">counts {sourceWeight(s)}×</span>
              </li>
            ))}
          </ul>}
    </div>
  );
}
