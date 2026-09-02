"use client";
// Attaching a verification to a grant.
//
// The funder side gets a real name search because lookup_funder exists. Grants
// have no equivalent — find_grants is semantic search over an index, not
// resolution — so this offers the two paths that genuinely resolve to the id
// the merge uses: the client's own recent matches, and the source URL.
//
// Both read our database rather than the Ledger service, so this path keeps
// working while the service is asleep.
import { useEffect, useState, useTransition } from "react";
import { listTenantMatchesAction, resolveGrantUrlAction, type GrantPickerResult } from "@/lib/server/grant-lookup";
import { STATUS_LABEL, STATUS_HELP, type GroundTruthState } from "@/lib/ledger-status";
import type { Tenant } from "@/lib/types";

// Same badge vocabulary as the funder side. Two pickers showing the same three
// states in different colours would be worse than either alone.
const BADGE_CLASS: Record<GroundTruthState, string> = {
  base: "gt-base", verified: "gt-verified", pending: "gt-pending",
};

function Badge({ state }: { state: GroundTruthState }) {
  return <span className={`ov-tag ${BADGE_CLASS[state]}`} title={STATUS_HELP[state]}>{STATUS_LABEL[state]}</span>;
}

export default function GrantPicker({ tenants, tenantId, onTenant, onAttach, onManual }: {
  tenants: Tenant[];
  tenantId: string;
  onTenant: (id: string) => void;
  /** fromList distinguishes "picked out of this client's matches" — which is
   *  real evidence the grant came up working for them — from "pasted a URL",
   *  which says nothing about any client. */
  onAttach: (r: GrantPickerResult, fromList: boolean) => void;
  onManual: () => void;
}) {
  const [rows, setRows] = useState<GrantPickerResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Switching clients twice quickly must not let the first response land on
  // the second selection — that shows one client's matches under another
  // client's name, and attaching from it files the proposal against the wrong
  // tenant.
  useEffect(() => {
    if (!tenantId) { setRows([]); setLoaded(false); return; }
    let live = true;
    start(async () => {
      try {
        const next = await listTenantMatchesAction(tenantId);
        if (!live) return;
        setRows(next); setErr(null);
      } catch (e) {
        if (!live) return;
        setErr(e instanceof Error ? e.message : "Could not read that client's matches.");
        setRows([]);
      }
      if (live) setLoaded(true);
    });
    return () => { live = false; };
  }, [tenantId]);

  const [unknownHit, setUnknownHit] = useState<GrantPickerResult | null>(null);

  const attachUrl = () => start(async () => {
    setErr(null);
    try {
      const r = await resolveGrantUrlAction(url);
      if (!r) return;
      // A URL we have never matched is a legitimate thing to record — most
      // grants a person reads about have never been through a run. But it is
      // not the same as attaching to a known record, and presenting it as one
      // is how a typo or a tracking parameter becomes an approved correction
      // that silently matches nothing forever.
      if (r.known) onAttach(r, false); else setUnknownHit(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not resolve that URL.");
    }
  });

  return (
    <div className="fp">
      <p className="ov-note">
        Attach this verification to a real opportunity so it corrects that record
        rather than sitting beside it as a duplicate.
      </p>

      <label>Whose matches?
        <select value={tenantId} onChange={e => onTenant(e.target.value)}>
          <option value="">Choose a client…</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>

      {pending && <div className="ov-muted">Loading…</div>}

      {tenantId && loaded && !rows.length && !pending && (
        <div className="empty">
          No cached matches for this client — run matching for them, or paste the
          opportunity&apos;s URL below.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="fp-results">
          {rows.map(r => (
            <li key={r.base_id}>
              <button type="button" className="fp-row" onClick={() => onAttach(r, true)}>
                <span className="fp-name">{r.title || r.base_id}</span>
                <span className="fp-meta">
                  {r.funder || "Funder unknown"}
                  {r.close_date ? ` · closes ${r.close_date}` : ""}
                  {r.verdict ? ` · ${r.verdict}` : ""}
                </span>
                <Badge state={r.status.state} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {unknownHit && (
        <div className="fp-unknown">
          <strong>We have no record of that URL.</strong>
          <p className="ov-note">
            Nothing in our match results uses this exact address, so this will be
            filed as a new opportunity rather than a correction to an existing
            one. That is right if it is genuinely new — and worth a second look
            if you expected to find it, since a trailing slash or a tracking
            parameter makes a different address.
          </p>
          <div className="al-actions">
            <button type="button" className="btn"
                    onClick={() => { const r = unknownHit; setUnknownHit(null); onAttach(r, false); }}>
              Record it as new
            </button>
            <button type="button" className="btn ghost" onClick={() => setUnknownHit(null)}>
              Let me check the address
            </button>
          </div>
        </div>
      )}

      <div className="fp-url">
        <label>…or paste the opportunity&apos;s URL
          <input value={url} onChange={e => setUrl(e.target.value)}
                 placeholder="https://grants.gov/…  — the page you verified" />
        </label>
        <p className="ov-note fp-hint">
          The source URL is how a grant is identified, so pasting the exact page
          you read attaches the correction to the right record.
        </p>
        <button type="button" className="btn" onClick={attachUrl} disabled={pending || !url.trim()}>
          Use this URL
        </button>
      </div>

      {err && <div className="ov-err">{err}</div>}

      <button type="button" className="btn ghost" onClick={onManual}>
        This is a brand-new opportunity
      </button>
    </div>
  );
}
