"use client";
import { useRef, useState } from "react";
import { useSession } from "@/lib/session";
import { getDocument, getTenant, mockChatAnswer } from "@/lib/data";
import { DocDrawer } from "@/components/DocBits";
import Drawer from "@/components/Drawer";

interface Msg { role: "user" | "assistant"; content: string; citations: string[] }

export default function ChatPage() {
  const { tenantId } = useSession();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [showBedrock, setShowBedrock] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  if (!tenantId) return null;
  const tenant = getTenant(tenantId)!;
  const openDoc = openDocId ? getDocument(tenantId, openDocId) : null;

  const ask = (q: string) => {
    const a = mockChatAnswer(tenantId, q);
    setMsgs(m => [...m, { role: "user", content: q, citations: [] }, { role: "assistant", content: a.content, citations: a.citations }]);
    setTimeout(() => streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" }), 50);
  };
  const send = () => { const v = input.trim(); if (!v) return; setInput(""); ask(v); };

  return (
    <div className="chat-wrap">
      <div className="page-head" style={{ marginBottom: 10 }}><div><h2>Ask AI</h2>
        <p>Ask anything about {tenant.name}. Answers with citations are drawn only from your own documents,
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
          <p>Hi — I can answer questions about <b>{tenant.name}</b> using only their Inven(s)tory documents. Try a suggestion, or ask your own.</p>
        </div></div>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role === "user" ? "me" : "ai"}`}>
            <div className="who">{m.role === "user" ? "You" : "AI"}</div>
            <div className="bubble"><p>{m.content}</p>
              {m.citations.length > 0 && (
                <div className="cites">{m.citations.map(id => {
                  const d = getDocument(tenantId, id);
                  return d ? <span key={id} className="cite" onClick={() => setOpenDocId(id)}>{d.title}</span> : null;
                })}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input placeholder="Ask about this Inven(s)tory…" value={input}
          onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }} />
        <button className="btn inline" onClick={send}>Send</button>
      </div>
      <div className="ai-disclaimer">Mock answers in Phase 1 — the real, Bedrock-powered pipeline arrives in Phase 6.</div>

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
