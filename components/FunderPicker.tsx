"use client";
// Attach a verification to a real record instead of typing an id nobody knows.
//
// Before this, the form asked for a "Ledger record ID" as free text. In practice
// that gets left blank, and blank means brand-new record, so every hand entry
// became a shadow record beside the one it was meant to correct.
import { useEffect, useRef, useState, useTransition } from "react";
import { searchLedgerFundersAction, getLedgerFunderAction, type PickerResult, type FunderPrefill } from "@/lib/server/ledger-lookup";
import { STATUS_LABEL, STATUS_HELP, type GroundTruthState } from "@/lib/ledger-status";

const BADGE_CLASS: Record<GroundTruthState, string> = {
  base: "gt-base", verified: "gt-verified", pending: "gt-pending",
};

export default function FunderPicker({ onAttach, onManual }: {
  onAttach: (r: PickerResult, prefill: FunderPrefill) => void;
  onManual: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickerResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PickerResult | null>(null);
  const [profile, setProfile] = useState<FunderPrefill | null>(null);
  const [pending, start] = useTransition();
  const [loadingProfile, setLoadingProfile] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced, because each keystroke is a round trip through a service that
  // may be waking up.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) { setResults([]); setSearched(false); return; }
    timer.current = setTimeout(() => {
      start(async () => {
        const res = await searchLedgerFundersAction(q);
        setSearched(true);
        setUnavailable(res.ok ? null : res.unavailable ?? "Search unavailable.");
        setResults(res.results);
      });
    }, 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  // Confirm step: never attach a correction to a record nobody has looked at.
  // "Cleveland Foundation" returns ten near-matches including one in Palm
  // Springs, and attaching to the wrong one writes a correction onto the wrong
  // funder.
  const choose = (r: PickerResult) => {
    setConfirming(r); setProfile(null); setLoadingProfile(true);
    start(async () => {
      setProfile(await getLedgerFunderAction(r.ein));
      setLoadingProfile(false);
    });
  };

  if (confirming) {
    return (
      <div className="fp-confirm">
        <div className="fp-confirm-head">
          <strong>{confirming.name}</strong>
          <span className={`ov-tag ${BADGE_CLASS[confirming.status.state]}`} title={STATUS_HELP[confirming.status.state]}>
            {STATUS_LABEL[confirming.status.state]}
          </span>
        </div>
        <div className="ov-muted">EIN {confirming.ein}{confirming.location ? ` · ${confirming.location}` : ""}</div>

        {confirming.status.state === "verified" && (
          <div className="ov-note">
            For Granted already verified this record
            {confirming.status.verified_at ? ` on ${new Date(confirming.status.verified_at).toLocaleDateString()}` : ""}
            {confirming.status.verified_by ? ` by ${confirming.status.verified_by}` : ""}.
            What you file here will supersede that correction once approved.
          </div>
        )}
        {confirming.status.state === "pending" && (
          <div className="ov-note">
            A correction for this funder is already waiting in the queue below.
            Consider reviewing that one rather than filing a second.
          </div>
        )}

        {loadingProfile && <div className="ov-muted">Loading the current profile…</div>}
        {profile?.unavailable && <div className="ov-err">{profile.unavailable}</div>}
        {profile && !profile.unavailable && (
          <dl className="fp-profile">
            {profile.location && <><dt>Location</dt><dd>{profile.location}</dd></>}
            {profile.website && <><dt>Website</dt><dd>{profile.website}</dd></>}
            {profile.focus && <><dt>Classification</dt><dd>{profile.focus}</dd></>}
            {profile.mission && <><dt>Mission</dt><dd className="fp-mission">{profile.mission}</dd></>}
          </dl>
        )}

        <div className="al-actions">
          <button className="btn" disabled={loadingProfile}
                  onClick={() => onAttach(confirming, profile ?? { ein: confirming.ein, name: confirming.name })}>
            Attach my verification to this funder
          </button>
          <button className="btn ghost" onClick={() => { setConfirming(null); setProfile(null); }}>
            Not this one
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fp">
      <label>Which funder did you verify?
        <input value={q} onChange={e => setQ(e.target.value)}
               placeholder="Search by name, e.g. Cleveland Foundation" />
      </label>

      {pending && <div className="ov-muted">Searching… the first search after a quiet spell can take a moment.</div>}

      {unavailable && (
        <div className="ov-note">
          {unavailable}
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost" onClick={onManual}>Enter a record id by hand instead</button>
          </div>
        </div>
      )}

      {!pending && searched && !unavailable && results.length === 0 && (
        <div className="empty">
          No funder found by that name. It may not be in the base at all, in which case
          record it as a new funder.
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost" onClick={onManual}>Record as a new funder</button>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <ul className="fp-results">
          {results.map(r => (
            <li key={r.ein}>
              <button type="button" className="fp-row" onClick={() => choose(r)}>
                <span className="fp-name">{r.name}</span>
                <span className={`ov-tag ${BADGE_CLASS[r.status.state]}`} title={STATUS_HELP[r.status.state]}>
                  {STATUS_LABEL[r.status.state]}
                </span>
                <span className="fp-meta">
                  {r.location}
                  {r.funder_type ? ` · ${r.funder_type.replace(/_/g, " ")}` : ""}
                  {r.has_grant_history === false && <span className="fp-warn"> · no grant history on record</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
