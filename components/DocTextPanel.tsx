"use client";
// Admin, Analysis: storing the text of documents read before the Document
// Reader (Phase 0). One button for every client; free; safe to press again.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocTextStatus } from "@/lib/server/doc-text-backfill";

export default function DocTextPanel({ status }: { status: DocTextStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const left = Math.max(0, status.ready - status.stored);

  // While any client's run is going, refresh every few seconds.
  useEffect(() => {
    if (!status.running) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [status.running, router]);

  const start = async () => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const res = await fetch("/api/jobs/doc-text", { method: "POST" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error ?? "Could not start.");
      setNote(b.tenants
        ? `Started for ${b.tenants} client${b.tenants === 1 ? "" : "s"}: ${b.documents} document${b.documents === 1 ? "" : "s"} to store. It carries on if you leave this page.`
        : "Every document already has its text stored.");
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not start."); }
    finally { setBusy(false); }
  };

  const finished = status.recent.filter(r => r.result);
  const reprocess = finished.flatMap(r => r.result!.needReprocess.map(d => ({ ...d, client: r.tenantName })));
  const failed = finished.flatMap(r => r.result!.failed.map(d => ({ ...d, client: r.tenantName })));
  const unplaced = finished.flatMap(r => r.result!.unplaced.map(d => ({ ...d, client: r.tenantName })));
  const quotes = finished.reduce((n, r) => n + (r.result!.quotes ?? 0), 0);
  const placed = finished.reduce((n, r) => n + (r.result!.placed ?? 0), 0);

  return (
    <section className="dt-panel" aria-labelledby="dt-h">
      <div className="dt-head">
        <div className="dt-copy">
          <h3 id="dt-h">Store document text</h3>
          <p>
            {status.stored} of {status.ready} documents across every client have their text stored for the Document Reader.
            {left > 0 ? " Storing the rest reads each original file again, calls no AI and costs nothing." : " Nothing is waiting."}
          </p>
        </div>
        <button type="button" className="sb-btn sb-primary" onClick={start} disabled={busy || status.running > 0 || left === 0}
          title={status.running > 0 ? "Already running" : left === 0 ? "Every document already has its text stored" : undefined}>
          {status.running > 0 ? "Storing…" : busy ? "Starting…" : "Store document text for every client"}
        </button>
      </div>
      {note && <p className="ws-notice">{note}</p>}
      {err && <p className="ap-error">{err}</p>}
      {status.running > 0 && (
        <ul className="dt-list">
          {status.recent.filter(r => r.status === "running").map(r => (
            <li key={r.tenantId}><strong>{r.tenantName}</strong>: {r.detail ?? "starting"}</li>
          ))}
        </ul>
      )}
      {finished.length > 0 && (
        <div className="dt-results">
          {quotes > 0 && <p>{placed} of {quotes} Story Card quotes placed in the stored text.</p>}
          {reprocess.length > 0 && (
            <>
              <p>These documents&apos; passages differ from their file now. Re-process each from its drawer on the Inven(s)tory page (it re-reads the file; for a client on the analysis that may mean one paid read):</p>
              <ul className="dt-list">{reprocess.map(d => <li key={d.id}>{d.client}: {d.title}</li>)}</ul>
            </>
          )}
          {failed.length > 0 && (
            <>
              <p>These could not be read from their file:</p>
              <ul className="dt-list">{failed.map(d => <li key={d.id}>{d.client}: {d.title} ({d.error})</li>)}</ul>
            </>
          )}
          {unplaced.length > 0 && (
            <>
              <p>Card quotes the reader could not place (they will show in its &ldquo;Couldn&apos;t be placed&rdquo; tray):</p>
              <ul className="dt-list">{unplaced.map(d => <li key={d.id}>{d.client}: {d.title}, {d.missing} of {d.of}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
