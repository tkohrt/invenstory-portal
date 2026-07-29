"use client";
// Real RAG chat via /api/chat. Retrieval is RLS-scoped; answers are grounded
// in the tenant's own documents with citations. While Bedrock generation is
// being provisioned, answers are extractive (top passages) and clearly noted;
// they become generated automatically once Bedrock is live — no UI change.
import { useRef, useState } from "react";
import { DocDrawer } from "./DocBits";
import Drawer from "./Drawer";
import type { DocumentWithTags } from "@/lib/types";

interface Cite { id: string; title: string }
interface Msg { role: "user" | "assistant"; content: string; citations: Cite[]; generated?: boolean; mode?: string }

export default function ChatView({ tenantName, docs }: { tenantName: string; docs: DocumentWithTags[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [showBedrock, setShowBedrock] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const openDoc = docs.find(d => d.id === openDocId) ?? null;
  const scroll = () => setTimeout(() => streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" }), 40);

  const ask = async (q: string) => {
    if (busy) return;
    setMsgs(m => [...m, { role: "user", content: q, citations: [] }]); setBusy(true); scroll();
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, sessionId }) });
      const b = await res.json();
      if (!res.ok) { setMsgs(m => [...m, { role: "assistant", content: b.error ?? "Something went wrong.", citations: [] }]); }
      else { setSessionId(b.sessionId); setMsgs(m => [...m, { role: "assistant", content: b.content, citations: b.citations ?? [], generated: b.generated, mode: b.mode }]); }
    } catch { setMsgs(m => [...m, { role: "assistant", content: "Network error — please try again.", citations: [] }]); }
    setBusy(false); scroll();
  };
  const send = () => { const v = input.trim(); if (!v) return; setInput(""); ask(v); };

  return (
    <div className="chat-wrap">
      <div className="page-head" style={{ marginBottom: 10 }}><div><h2>Ask AI</h2>
        <p>Ask anything about {tenantName}. Answers with citations are drawn only from your own documents,
          with your data protected by Amazon Bedrock.{" "}
          <button className="btn ghost" style={{ fontSize: 12.5, padding: "0 4px" }} onClick={() => setShowBedrock(true)}>Learn More</button></p>
      </div></div>
      <div className="suggest">
        <button onClick={() => ask("What is the transportation program?")}>What is the transportation program?</button>
        <button onClick={() => ask("What is the founding story?")}>What is the founding story?</button>
        <button onClick={() => ask("How is the organization funded?")}>How is it funded?</button>
      </div>
      <div className="chat-stream" ref={streamRef}>
        <div className="msg ai"><div className="who">AI</div><div className="bubble">
          <p>Hi — I can answer questions about <b>{tenantName}</b> using only their Inven(s)tory documents. Try a suggestion, or ask your own.</p>
        </div></div>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role === "user" ? "me" : "ai"}`}>
            <div className="who">{m.role === "user" ? "You" : "AI"}</div>
            <div className="bubble">
              <p style={{ whiteSpace: "pre-wrap" }}>{m.content}</p>
              {m.role === "assistant" && m.mode === "extractive" && (
                <div className="ai-disclaimer" style={{ marginTop: 0 }}>Showing source passages while AI generation is being provisioned — citations are live.</div>
              )}
              {m.citations && m.citations.length > 0 && (
                <div className="cites">{m.citations.map(c => (
                  <span key={c.id} className="cite" onClick={() => setOpenDocId(c.id)}>{c.title}</span>
                ))}</div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="msg ai"><div className="who">AI</div><div className="bubble"><p className="empty">Reading your documents…</p></div></div>}
      </div>
      <div className="chat-input">
        <input placeholder="Ask about this Inven(s)tory…" value={input} disabled={busy}
          onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }} />
        <button className="btn inline" onClick={send} disabled={busy}>Send</button>
      </div>
      {openDoc && <DocDrawer d={openDoc} onClose={() => setOpenDocId(null)} />}
      {showBedrock && (
        <Drawer onClose={() => setShowBedrock(false)}>
          <h3>How your data is protected</h3>
          <p style={{ color: "var(--muted)", marginTop: 2 }}>AI privacy on the For Granted platform</p>
          <p style={{ marginTop: 14, lineHeight: 1.6 }}>When you ask a question or run any AI feature in this portal, it is processed through <b>Amazon Bedrock</b>, running inside For Granted&rsquo;s own secure cloud account — not on a public AI service.</p>
          <div className="kv"><div className="k" style={{ width: 26 }}>✓</div><div><b>Processed in our account.</b> Every question and answer is handled inside infrastructure For Granted controls.</div></div>
          <div className="kv"><div className="k" style={{ width: 26 }}>✓</div><div><b>Nothing is stored.</b> Amazon Bedrock does not retain your prompts or the answers it generates.</div></div>
          <div className="kv"><div className="k" style={{ width: 26 }}>✓</div><div><b>No training on your data.</b> Amazon is contractually prohibited from using your material to train AI models.</div></div>
          <div className="kv"><div className="k" style={{ width: 26 }}>✓</div><div><b>Your documents stay put.</b> Your Inven(s)tory lives only in For Granted&rsquo;s systems, visible only to your organization and the For Granted team.</div></div>
          <p style={{ lineHeight: 1.6, marginTop: 10 }}>In short: no AI company ever holds your data.</p>
          <a className="btn secondary" style={{ display: "inline-block", textDecoration: "none", marginTop: 8 }}
            href="https://aws.amazon.com/bedrock/faqs/" target="_blank" rel="noopener noreferrer">↗ Read Amazon Bedrock&rsquo;s FAQ</a>
        </Drawer>
      )}
    </div>
  );
}
