"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase-browser";
import { changePasswordAction, requestAccountClosureAction } from "@/lib/server/account-actions";

interface Factor { id: string; friendly_name?: string; status: string }

export default function AccountView({ fullName, email, role, orgName, website, contactName }: {
  fullName: string; email: string; role: "client" | "admin";
  orgName: string | null; website: string | null; contactName: string | null;
}) {
  const isClient = role === "client";

  // --- change password ---
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changePw = async () => {
    setPwMsg(null);
    if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: "New passwords don't match." }); return; }
    setPwBusy(true);
    const r = await changePasswordAction(pw.current, pw.next);
    setPwBusy(false);
    if (r.ok) { setPwMsg({ ok: true, text: "Password updated." }); setPw({ current: "", next: "", confirm: "" }); }
    else setPwMsg({ ok: false, text: r.error ?? "Couldn't update password." });
  };

  // --- MFA (TOTP) ---
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState<string | null>(null);
  const loadFactors = async () => {
    const supabase = browserClient();
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  };
  useEffect(() => { loadFactors(); }, []);
  const startEnroll = async () => {
    setMfaMsg(null);
    const supabase = browserClient();
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${Date.now()}` });
    if (error || !data) { setMfaMsg(error?.message ?? "Couldn't start setup."); return; }
    setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const verifyEnroll = async () => {
    if (!enroll) return;
    const supabase = browserClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: mfaCode.trim() });
    if (error) { setMfaMsg(error.message); return; }
    setEnroll(null); setMfaCode(""); setMfaMsg("Two-factor authentication is on.");
    loadFactors();
  };
  const removeFactor = async (id: string) => {
    const supabase = browserClient();
    await supabase.auth.mfa.unenroll({ factorId: id });
    loadFactors();
  };

  // --- closure ---
  const [closeReason, setCloseReason] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeDone, setCloseDone] = useState(false);
  const requestClose = async () => {
    setCloseBusy(true);
    await requestAccountClosureAction(closeReason);
    setCloseBusy(false); setCloseDone(true); setCloseOpen(false);
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-head"><div><h2>Account</h2><p>Manage your login and your data.</p></div></div>

      <section className="acct-card">
        <h3>Profile</h3>
        <div className="kv"><div className="k">Name</div><div>{fullName}</div></div>
        <div className="kv"><div className="k">Email</div><div>{email}</div></div>
        {isClient && orgName && <div className="kv"><div className="k">Organization</div><div>{orgName}</div></div>}
        {isClient && contactName && <div className="kv"><div className="k">Primary contact</div><div>{contactName}</div></div>}
        {isClient && website && <div className="kv"><div className="k">Website</div><div>{website}</div></div>}
        {isClient && <p className="acct-note">Organization details are maintained by the For Granted team.</p>}
      </section>

      <section className="acct-card">
        <h3>Change password</h3>
        <label>Current password</label>
        <input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
        <label>New password (12+ characters)</label>
        <input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
        <label>Confirm new password</label>
        <input type="password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
        {pwMsg && <div className={pwMsg.ok ? "gap-note" : "metric-gap"} style={{ marginTop: 10 }}>{pwMsg.text}</div>}
        <button className="btn" onClick={changePw} disabled={pwBusy || !pw.current || !pw.next}>{pwBusy ? "Updating…" : "Update password"}</button>
      </section>

      <section className="acct-card">
        <h3>Two-factor authentication</h3>
        {factors.length > 0 && (
          <div>
            {factors.map(f => (
              <div key={f.id} className="kv"><div className="k">Authenticator</div>
                <div>✓ Enabled{f.status !== "verified" ? " (pending)" : ""} <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => removeFactor(f.id)}>Remove</button></div></div>
            ))}
          </div>
        )}
        {factors.length === 0 && !enroll && (
          <div>
            <p className="acct-note">Add a code from an authenticator app for an extra layer of security.</p>
            <button className="btn secondary" onClick={startEnroll}>Set up two-factor</button>
          </div>
        )}
        {enroll && (
          <div>
            <p className="acct-note">Scan this with your authenticator app, then enter the 6-digit code.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enroll.qr} alt="Authenticator QR code" style={{ width: 180, height: 180, background: "#fff", border: "1px solid var(--line)", borderRadius: 8 }} />
            <p className="acct-note">Or enter this key manually: <code>{enroll.secret}</code></p>
            <div className="tag-input-row" style={{ maxWidth: 260 }}>
              <input value={mfaCode} onChange={e => setMfaCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" />
              <button className="btn inline" onClick={verifyEnroll}>Verify</button>
            </div>
          </div>
        )}
        {mfaMsg && <div className="gap-note" style={{ marginTop: 10 }}>{mfaMsg}</div>}
      </section>

      {isClient && (
        <section className="acct-card">
          <h3>Your data</h3>
          <p className="acct-note">Your Inven(s)tory belongs to you. Download a complete copy of your documents anytime.</p>
          <a className="btn secondary" href="/api/export" style={{ display: "inline-block", textDecoration: "none" }}>Export my Inven(s)tory (.zip)</a>
        </section>
      )}

      {isClient && (
        <section className="acct-card danger">
          <h3>Close account</h3>
          {closeDone
            ? <div className="gap-note">Your request has been sent to the For Granted team. They&rsquo;ll be in touch to help you wind down and export your data.</div>
            : !closeOpen
              ? <div><p className="acct-note">Requesting closure notifies the For Granted team, who will help you offboard and export your data. It won&rsquo;t delete anything automatically.</p>
                  <button className="btn secondary" style={{ color: "#c0492f", borderColor: "#e7c3ba" }} onClick={() => setCloseOpen(true)}>Request account closure</button></div>
              : <div>
                  <label>Anything you&rsquo;d like the team to know? (optional)</label>
                  <textarea value={closeReason} onChange={e => setCloseReason(e.target.value)} style={{ minHeight: 70 }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="btn inline" style={{ background: "#c0492f" }} onClick={requestClose} disabled={closeBusy}>{closeBusy ? "Sending…" : "Send closure request"}</button>
                    <button className="btn secondary" onClick={() => setCloseOpen(false)}>Cancel</button>
                  </div>
                </div>}
        </section>
      )}
    </div>
  );
}
