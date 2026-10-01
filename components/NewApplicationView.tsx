"use client";
// Bringing a funder's application into the portal: step one of a card-mode draft.
//
// Paste first, because it always works: many funder portals put the questions
// behind a login that no server can get past. Upload and web address are there
// for when they work, and each failure says what to do instead.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MatchPrefill } from "@/lib/server/drafts";

type Source = "paste" | "file" | "url";

export default function NewApplicationView({ tenantName, prefill }: { tenantName: string; prefill: MatchPrefill | null }) {
  const router = useRouter();
  const [source, setSource] = useState<Source>(prefill?.url && prefill.grantId ? "url" : "paste");
  const [f, setF] = useState({
    title: prefill?.title ?? "", funder: prefill?.funder ?? "",
    deadline: prefill?.deadline ?? "", amountDollars: "",
    text: "", url: prefill?.url ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = source === "paste" ? f.text.trim().length >= 40 : source === "file" ? !!file : /^https?:\/\/\S+\.\S+/.test(f.url.trim());

  const submit = async () => {
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("source", source);
    fd.set("title", f.title); fd.set("funder", f.funder); fd.set("deadline", f.deadline); fd.set("amountDollars", f.amountDollars);
    if (source === "paste") fd.set("text", f.text);
    if (source === "file" && file) fd.set("file", file);
    if (source === "url") fd.set("url", f.url);
    if (prefill?.grantId) fd.set("grantId", prefill.grantId);
    if (prefill?.funderId) fd.set("funderId", prefill.funderId);
    if (prefill?.url && source !== "url") fd.set("sourceUrl", prefill.url);
    try {
      const res = await fetch("/api/drafts/ingest", { method: "POST", body: fd });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.id) throw new Error(r.error ?? (res.status === 413 ? "That file is too large. Paste the questions instead." : "Could not bring that application in."));
      router.push(`/drafts/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not bring that application in.");
      setBusy(false);
    }
  };

  return (
    <div className="ap">
      <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · {tenantName}</div>
      <div className="page-head">
        <div>
          <button className="btn ghost" style={{ padding: "2px 4px", marginBottom: 4 }} onClick={() => router.push("/drafts")}>← Drafts</button>
          <h2>Build from a funder&rsquo;s application</h2>
          <p>Bring in the funder&rsquo;s questions. The portal reads them, you check the result, and each confirmed
            question is answered from {tenantName}&rsquo;s Story Cards. The funder&rsquo;s text stays with this draft
            and is never added to the Inven(s)tory. For Granted only; clients do not see this draft.</p>
        </div>
      </div>

      {prefill && (
        <div className="ov-note" style={{ marginBottom: 14 }}>
          Started from Funder Matches{prefill.url ? <>: <a href={prefill.url} target="_blank" rel="noopener noreferrer">{prefill.url}</a></> : ""}.
          The questions still need to come from the application itself, below.
        </div>
      )}

      <div className="ap-grid">
        <label>Opportunity<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Read from the application if left blank" /></label>
        <label>Funder<input value={f.funder} onChange={e => setF({ ...f, funder: e.target.value })} placeholder="Read from the application if left blank" /></label>
        <label>Deadline<input type="date" value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} /></label>
        <label>Amount (USD)<input value={f.amountDollars} onChange={e => setF({ ...f, amountDollars: e.target.value })} placeholder="40000" inputMode="decimal" /></label>
      </div>

      <div className="ap-tabs" role="tablist" aria-label="Where the application comes from">
        {([["paste", "Paste text"], ["file", "Upload PDF or Word"], ["url", "Web address"]] as [Source, string][]).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={source === k}
            className={`chip${source === k ? " active" : ""}`} onClick={() => { setSource(k); setError(null); }}>{label}</button>
        ))}
      </div>

      {source === "paste" && (
        <label className="ap-block">The application&rsquo;s questions, with their instructions and limits
          <textarea className="ap-paste" value={f.text} onChange={e => setF({ ...f, text: e.target.value })}
            placeholder={"Paste everything from the funder's form or guidelines: the questions, any word or character limits, and the scoring criteria if they publish them. Extra text is fine; the reader picks out the questions."} />
          <span className="ov-muted">{f.text.trim() ? `${f.text.trim().split(/\s+/).length.toLocaleString()} words` : "Always works, including for portals behind a login."}</span>
        </label>
      )}
      {source === "file" && (
        <label className="ap-block">PDF or Word (.docx), up to 4 MB
          <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <span className="ov-muted">Scanned PDFs have no text to read; paste those instead.</span>
        </label>
      )}
      {source === "url" && (
        <label className="ap-block">Web address of the application or guidelines
          <input value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://" inputMode="url" />
          <span className="ov-muted">Works for public pages and PDF links. A page behind a sign-in cannot be read; you will be asked to paste instead.</span>
        </label>
      )}

      {error && <div className="ap-error" role="alert">{error}</div>}

      <button className="btn inline ap-go" disabled={!ready || busy} onClick={() => void submit()} aria-busy={busy}>
        {busy ? (source === "url" ? "Fetching the page…" : "Bringing it in…") : "Bring in the application"}
      </button>
    </div>
  );
}
