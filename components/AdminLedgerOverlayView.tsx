"use client";
// The Funder Ledger review queue. Nothing reaches client-facing matching
// without passing through this page: the bot and client-surfaced verifications
// only ever write `proposed` rows, and an admin decides each one.
// Since patch 67 (review at the point of use) one thing is seen by clients
// before a decision: an opportunity a first-party source produced, on the
// "Added by For Granted" list only, labelled as not yet reviewed. The queue
// is ordered by who is waiting (lib/trust.ts).
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveOverlayAction, rejectOverlayAction, claimOverlayAction,
} from "@/lib/server/overlay-actions";
import OverlayEntryForm from "./OverlayEntryForm";
import type { OverlayQueueRow, LedgerScoutRun, OverlayKind, OverlayProvenance, Tenant } from "@/lib/types";
import { filterQueue, queueCounts, type KindFilter, type TypeFilter } from "@/lib/overlay-queue";
import { bandQueue, demandLine, BAND_LABEL, BAND_WHY, NO_DEMAND, type Demand, type Band } from "@/lib/trust";

const PROVENANCE_LABEL: Record<OverlayProvenance, string> = {
  client_surfaced: "Found working a client",
  scout_bot: "Discovery bot",
  manual: "Entered by hand",
  // Patch 5 (1 Nov 2026): found by a client's web search, checked only against
  // the pages the search returned. Read the page before approving.
  web_discovery: "Found by the web search",
  // P2.5 (patch 39): loaded from a curated list For Granted found.
  curated_list: "Curated list",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Field table. With a base record it's a diff; without one, the proposal alone. */
function Fields({ fields, base }: { fields: Record<string, unknown>; base?: Record<string, unknown> | null }) {
  const keys = Array.from(new Set([...Object.keys(base ?? {}), ...Object.keys(fields)])).sort();
  if (!keys.length) return <div className="empty">No fields on this proposal.</div>;
  return (
    <table className="ov-fields">
      <thead><tr><th>Field</th>{base && <th>Ledger base (June 2026)</th>}<th>{base ? "Proposed" : "Value"}</th></tr></thead>
      <tbody>
        {keys.map(k => {
          const changed = base ? fmt(base[k]) !== fmt(fields[k]) && k in fields : false;
          return (
            <tr key={k} className={changed ? "ov-changed" : ""}>
              <td className="ov-key">{k}</td>
              {base && <td className="ov-was">{fmt(base[k])}</td>}
              <td>{k in fields ? fmt(fields[k]) : <span className="ov-muted">unchanged</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Row({ row, base, demand = NO_DEMAND }: { row: OverlayQueueRow; base?: Record<string, unknown> | null; demand?: Demand }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(JSON.stringify(row.fields, null, 2));
  // The row survives router.refresh() (keyed by id), so re-sync the editor when
  // the persisted fields change or an admin sees their own pre-approval draft.
  useEffect(() => { setDraft(JSON.stringify(row.fields, null, 2)); setEditing(false); }, [row.updated_at, row.fields]);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<void>) => start(async () => {
    setErr(null);
    try { await fn(); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); }
  });

  const approve = () => run(async () => {
    if (!editing) return approveOverlayAction(row.id);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(draft); }
    catch { throw new Error("The edited fields aren't valid JSON."); }
    await approveOverlayAction(row.id, { fields: parsed });
  });
  const reject = () => run(async () => {
    if (!note.trim()) throw new Error("Add a note saying why before rejecting.");
    await rejectOverlayAction(row.id, note);
  });
  const claim = () => run(() => claimOverlayAction(row.id));

  const isCorrection = !!row.base_id;
  const wanted = demandLine(demand);
  return (
    <div className={`ov-row${open ? " ov-open" : ""}`}>
      <div className="ov-head" onClick={() => setOpen(o => !o)}>
        <span className={`ov-pill ov-${row.kind}`}>{row.kind}</span>
        <span className="ov-title">{row.title || row.opportunity_number || row.ein || row.base_id || "Untitled candidate"}</span>
        <span className={`ov-tag ${isCorrection ? "ov-fix" : "ov-new"}`}>{isCorrection ? "correction" : "new record"}</span>
        {row.confidence && <span className={`ov-conf ov-conf-${row.confidence}`}>{row.confidence}</span>}
        {row.status === "in_review" && <span className="ov-tag">in review</span>}
        {row.published_at && <span className="ov-tag gt-pending" title="A matched client can already see this, labelled as not yet reviewed by For Granted. Approving removes the label; rejecting takes it away from them.">live to clients, unreviewed</span>}
        {wanted && <span className="ov-tag sg-warn" title="Who is waiting on this entry.">{wanted}</span>}
        <span className="ov-spacer" />
        {row.source_label && <span className="ov-muted">from {row.source_label}</span>}
        {row.proposed_by_role === "client" && <span className="ov-tag ov-client">client-submitted</span>}
        {row.tenant_name && <span className="ov-muted">via {row.tenant_name}</span>}
        <span className="ov-muted">{new Date(row.created_at).toLocaleDateString()}</span>
        <span className="ov-chev">{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div className="ov-body">
          <div className="ov-meta">
            <span>{row.source_label ? `Read from ${row.source_label}${row.source_trust === "first_party" ? " (the funder's own)" : " (news or an aggregator)"}` : PROVENANCE_LABEL[row.provenance]}</span>
            <span>·</span>
            <span>
              proposed by {row.proposed_by_name ?? "unknown"}
              {row.proposed_by_role === "client" && <span className="ov-warn"> (client account)</span>}
            </span>
            <span>·</span>
            <a href={row.source_url} target="_blank" rel="noopener noreferrer">Verify at source ↗</a>
          </div>

          {isCorrection && !base && (
            <div className="ov-note">
              Showing the proposed values only. The side-by-side against the frozen base
              record appears once the Ledger service is wired (<code>FUNDER_LEDGER_URL</code>).
            </div>
          )}

          {editing
            ? <label className="ov-edit">Fields (JSON)
                <textarea rows={12} value={draft} onChange={e => setDraft(e.target.value)} />
              </label>
            : <Fields fields={row.fields} base={isCorrection ? base : null} />}

          {err && <div className="ov-err">{err}</div>}

          <div className="ov-actions">
            <button className="btn" onClick={approve} disabled={pending}>
              {pending ? "Working…" : editing ? "Save & approve" : "Approve"}
            </button>
            <button className="btn ghost" onClick={() => setEditing(e => !e)} disabled={pending}>
              {editing ? "Cancel edit" : "Edit fields"}
            </button>
            {row.status === "proposed" && (
              <button className="btn ghost" onClick={claim} disabled={pending}>Claim for review</button>
            )}
            <span className="ov-spacer" />
            <input className="ov-note-in" placeholder="Why reject?" value={note}
                   onChange={e => setNote(e.target.value)} />
            <button className="btn ghost" onClick={reject} disabled={pending || !note.trim()}>Reject</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tab({ on, onClick, label, n, hint }: {
  on: boolean; onClick: () => void; label: string; n: number; hint?: string;
}) {
  return (
    <button type="button" onClick={onClick} title={hint}
            aria-pressed={on} className={`ov-tab${on ? " on" : ""}`}>
      {label} <span className="badge-count">{n}</span>
    </button>
  );
}

export default function AdminLedgerOverlayView({
  queue, decided, lastRun, tenants, base = {}, demand = {},
}: {
  queue: OverlayQueueRow[]; decided: OverlayQueueRow[]; lastRun: LedgerScoutRun | null;
  tenants: Tenant[]; base?: Record<string, Record<string, unknown>>;
  /** Patch 67: who is waiting on each entry (matched, following, asked), by entry id. */
  demand?: Record<string, Demand>;
}) {
  const [adding, setAdding] = useState(false);
  const [kindF, setKindF] = useState<KindFilter>("all");
  const [typeF, setTypeF] = useState<TypeFilter>("all");

  const counts = queueCounts(queue, kindF, typeF);
  const visible = filterQueue(queue, kindF, typeF);

  // Provenance stays a grouping inside the filtered list rather than a third
  // filter. Where a record came from tells a reviewer how much to trust it; it
  // does not change the decision they are making, so it earns a label and not
  // a tab.
  //
  // Patch 67: the queue is drawn in bands by who is waiting, and within a
  // band by kind and provenance as before. "curated_list" joins the
  // provenance order here: it was missing, so entries from a pasted list or a
  // watched source were counted in the tab's badge and never drawn.
  const bands = bandQueue(visible, demand).map(b => {
    const groups: { key: string; label: string; rows: OverlayQueueRow[] }[] = [];
    for (const kind of ["grant", "funder"] as OverlayKind[]) {
      for (const prov of ["client_surfaced", "web_discovery", "curated_list", "scout_bot", "manual"] as OverlayProvenance[]) {
        const rows = b.rows.filter(r => r.kind === kind && r.provenance === prov);
        if (rows.length) groups.push({ key: `${b.band}:${kind}:${prov}`, label: `${kind === "grant" ? "Grants" : "Funders"} · ${PROVENANCE_LABEL[prov]}`, rows });
      }
    }
    return { ...b, groups };
  });
  // One band alone, and the ordinary one, needs no heading: the queue reads as it always did.
  const plain = bands.length === 1 && bands[0].band === "standard";
  const drawGroups = (groups: { key: string; label: string; rows: OverlayQueueRow[] }[]) => groups.map(g => (
    <section key={g.key} className="ov-group">
      <div className="nav-section-label">{g.label} <span className="badge-count">{g.rows.length}</span></div>
      {g.rows.map(r => <Row key={r.id} row={r} base={r.base_id ? base[r.base_id] ?? null : null} demand={demand[r.id]} />)}
    </section>
  ));
  // What can wait is folded away, so the page opens on what a person is needed for.
  const folded = (b: Band) => b === "quiet" || b === "live";

  return (
    <div>
      {/* The Review queues page (patch 36) owns the h2; this stays a section. */}
      <div className="page-head rq-nested">
        <div>
          <h3>Ground Truth review</h3>
          <p>
            Ground Truth is the funder base (a frozen June 2026 snapshot that never changes)
            plus For Granted&apos;s verified corrections and new finds. These are waiting for
            approval before they merge over the base in client matching. Everything here is a lead until
            someone checks it at the source. An opportunity read from a funder&apos;s own page or account
            is shown to the clients it fits straight away, labelled as not yet reviewed; it never joins
            matching or a fit report until it is approved here.
          </p>
        </div>
        <span className="ov-spacer" />
        {!adding && (
          <button className="btn" onClick={() => setAdding(true)}>Record a verification</button>
        )}
      </div>

      {adding && <OverlayEntryForm tenants={tenants} onDone={() => setAdding(false)} />}

      {lastRun && (
        <div className="ov-runbar">
          Last discovery run {new Date(lastRun.ran_at).toLocaleString()} · scope {lastRun.scope ?? "—"} ·
          {" "}{lastRun.checked} re-checked · {lastRun.found_new} new · {lastRun.proposed} queued
          {lastRun.summary ? ` · ${lastRun.summary}` : ""}
        </div>
      )}

      {queue.length === 0 && <div className="empty">Nothing awaiting review. The queue fills as FG verifies grants for clients and as the discovery bot runs.</div>}

      {queue.length > 0 && (
        <div className="ov-filters">
          <div className="ov-filterrow" role="group" aria-label="Filter by record kind">
            <Tab on={kindF === "all"} onClick={() => setKindF("all")} label="Everything" n={counts.anyKind} />
            <Tab on={kindF === "funder"} onClick={() => setKindF("funder")} label="Funders" n={counts.funder} />
            <Tab on={kindF === "grant"} onClick={() => setKindF("grant")} label="Grants" n={counts.grant} />
          </div>
          <div className="ov-filterrow" role="group" aria-label="Filter by proposal type">
            <Tab on={typeF === "all"} onClick={() => setTypeF("all")} label="Both" n={counts.anyType} />
            <Tab on={typeF === "correction"} onClick={() => setTypeF("correction")} label="Corrections" n={counts.correction}
                 hint="A change to a record that already exists. You are comparing it against what the base says." />
            <Tab on={typeF === "new"} onClick={() => setTypeF("new")} label="New records" n={counts.new}
                 hint="A record the base does not have. You are judging that it is real, and not already present under another name." />
          </div>
        </div>
      )}

      {queue.length > 0 && visible.length === 0 && (
        <div className="empty">Nothing in the queue matches this filter.</div>
      )}

      {plain ? drawGroups(bands[0].groups) : bands.map(b => folded(b.band) ? (
        <details key={b.band} className="cu-members ov-band">
          <summary>{BAND_LABEL[b.band]} ({b.rows.length})</summary>
          <p className="cu-sub">{BAND_WHY[b.band]}</p>
          {drawGroups(b.groups)}
        </details>
      ) : (
        <section key={b.band} className="ov-band">
          <div className="cu-head"><h3>{BAND_LABEL[b.band]}</h3><span className="badge-count">{b.rows.length}</span></div>
          <p className="cu-sub">{BAND_WHY[b.band]}</p>
          {drawGroups(b.groups)}
        </section>
      ))}

      {decided.length > 0 && (
        <section className="ov-group">
          <div className="nav-section-label" style={{ marginTop: 22 }}>Recently decided</div>
          <table className="aq-table">
            <thead><tr><th>Record</th><th>Kind</th><th>Outcome</th><th>Note</th><th>When</th></tr></thead>
            <tbody>
              {decided.map(d => (
                <tr key={d.id}>
                  <td>{d.title || d.base_id || d.id.slice(0, 8)}</td>
                  <td>{d.kind}</td>
                  <td><span className={`ov-tag ov-${d.status}`}>{d.status}</span></td>
                  <td className="ov-muted">{d.review_note ?? "—"}</td>
                  <td className="ov-muted">{d.reviewed_at ? new Date(d.reviewed_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
