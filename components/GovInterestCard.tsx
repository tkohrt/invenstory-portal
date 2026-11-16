"use client";
// The one question every client is asked about government buyers (patch 53,
// 16 Nov 2026). A yes tells For Granted and turns nothing on: switching the
// RFP Engine on is For Granted's decision, made from the client's admin page.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { answerGovInterestAction } from "@/lib/server/gov-readiness-actions";
import { GOV_INTEREST_QUESTION } from "@/lib/gov-readiness";

export default function GovInterestCard({ interest: initial, adminViewing }: { interest: "yes" | "no" | null; adminViewing: boolean }) {
  const router = useRouter();
  const [interest, setInterest] = useState(initial);
  const [editing, setEditing] = useState(initial === null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const answer = async (a: "yes" | "no") => {
    setBusy(true); setErr(null);
    const r = await answerGovInterestAction(a).catch(() => ({ ok: false as const, error: "That did not save. Reload the page and try again." }));
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setInterest(a); setEditing(false);
    router.refresh();
  };
  return (
    <section className="acct-card gov-interest">
      <h3>Government buyers</h3>
      <p className="gov-q">{GOV_INTEREST_QUESTION}</p>
      {editing ? (
        <div className="fe-choice">
          <button type="button" className={`chip ${interest === "yes" ? "active" : ""}`} aria-pressed={interest === "yes"} disabled={busy} onClick={() => answer("yes")}>Yes</button>
          <button type="button" className={`chip ${interest === "no" ? "active" : ""}`} aria-pressed={interest === "no"} disabled={busy} onClick={() => answer("no")}>No</button>
        </div>
      ) : (
        <p className="acct-note" role="status" style={{ margin: 0 }}>
          {interest === "yes"
            ? (adminViewing
              ? "Answered yes. Nothing is switched on by this answer: the RFP Engine switch is on this client's admin page."
              : "You answered yes. Your For Granted team has been told and will talk with you about whether government contracts fit your work. Nothing changes on your account until then.")
            : "You answered no. You can change this at any time."}{" "}
          <button type="button" className="gov-link" onClick={() => setEditing(true)}>Change answer</button>
        </p>
      )}
      {err && <p className="cl-error" role="alert" style={{ marginTop: 8 }}>{err}</p>}
    </section>
  );
}
