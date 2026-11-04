"use client";
// For Granted's view of a client's company setup (patch 14, onboarding build,
// 3 November 2026): how far it got, what the client told us, teammate logins
// to make, and a way to finish or restart it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminSetSetupAction, createTeammateLoginAction } from "@/lib/server/setup-actions";
import { SETUP_STEPS, RELATIONSHIP_LABEL, ROLES, GOALS, type SetupState } from "@/lib/setup";

export default function AdminSetupPanel({ tenantId, state, ownerName }: { tenantId: string; state: SetupState; ownerName: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [made, setMade] = useState<{ email: string; pw: string } | null>(null);
  const a = state.answers;

  const set = async (to: "complete" | "reset") => {
    if (to === "reset" && !window.confirm("Send this client back to the start of setup? Their answers stay; the steps are cleared.")) return;
    setBusy(true); setMsg(null);
    const r = await adminSetSetupAction(tenantId, to).catch(() => ({ ok: false as const, error: "That did not save." }));
    setBusy(false);
    if (!r.ok) setMsg(r.error); else router.refresh();
  };
  const login = async (email: string) => {
    setBusy(true); setMsg(null); setMade(null);
    const r = await createTeammateLoginAction(tenantId, email).catch(() => ({ ok: false as const, error: "That did not work." }));
    setBusy(false);
    if (!r.ok) setMsg(r.error); else { setMade({ email: r.email, pw: r.tempPassword }); router.refresh(); }
  };

  return (
    <section className="card su-admin" aria-label="Company setup">
      <div className="su-group-head">
        <h3>Company setup</h3>
        <span className="spacer" />
        <span className="su-small">
          {state.legacy ? "Client from before setup existed" : state.status === "complete" ? `Complete${state.completedAt ? `, ${new Date(state.completedAt).toLocaleDateString()}` : ""}` : state.ownerUserId ? `In progress, by ${ownerName ?? "the client"}` : "Not started"}
        </span>
        {state.status !== "complete" && <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busy} onClick={() => set("complete")}>Mark complete</button>}
        <button type="button" className="sb-btn sb-quiet sb-sm" disabled={busy} onClick={() => set("reset")}>Restart setup</button>
      </div>
      {!state.legacy && (
        <ol className="su-admin-steps">
          {SETUP_STEPS.map(s => <li key={s.key} className={state.steps[s.key] ?? ""}>{s.label}: {state.steps[s.key] === "done" ? "done" : state.steps[s.key] === "skipped" ? "later" : "not yet"}</li>)}
        </ol>
      )}
      {a.role && <p className="su-small">Role: {ROLES.find(r => r.v === a.role)?.l}</p>}
      {a.goal && <p className="su-small">Wants help first with: {GOALS.find(g => g.v === a.goal)?.title}</p>}
      {a.interview_requested_at && <p className="su-small"><b>Asked for a founder interview</b> on {new Date(a.interview_requested_at).toLocaleDateString()}.</p>}
      {(a.known_funders?.length ?? 0) > 0 && <>
        <h4>Funders they already know</h4>
        <ul className="su-list">{a.known_funders!.map(f => <li key={f.name}>{f.name}: {RELATIONSHIP_LABEL[f.relationship]}</li>)}</ul>
      </>}
      {(a.deadlines?.length ?? 0) > 0 && <>
        <h4>Deadlines they are working toward</h4>
        <ul className="su-list">{a.deadlines!.map((d, i) => <li key={i}>{d.what}{d.date ? `: ${d.date}` : ""}</li>)}</ul>
      </>}
      {(a.invites?.length ?? 0) > 0 && <>
        <h4>Teammates to add</h4>
        <ul className="su-list">{a.invites!.map(i => (
          <li key={i.email}>{i.email}{" "}
            {i.created ? <span className="su-small">login made</span>
              : <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busy} onClick={() => login(i.email)}>Create login</button>}
          </li>
        ))}</ul>
        {made && <p className="su-note" role="status">Login made for {made.email}. Temporary password, shown once: <code>{made.pw}</code>. Email it to them yourself.</p>}
      </>}
      {msg && <p className="cl-error" role="alert">{msg}</p>}
    </section>
  );
}
