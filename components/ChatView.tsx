"use client";
// Canned answers over live rows — Phase 6 replaces with tenant-scoped RAG.
import { useRef, useState } from "react";
import { DocDrawer } from "./DocBits";
import Drawer from "./Drawer";
import type { DocumentWithTags } from "@/lib/types";

interface Msg { role: "user" | "assistant"; content: string; citations: string[] }

const CANNED: { q: RegExp; tenant: string; a: string; titles: string[] }[] = [
  { q: /transport|uplift|ride/i, tenant: "Fund The Climb Foundation", a: "Transportation is a core program. Uplift Transportation provides rides to treatment for people in recovery, addressing the barrier of missed appointments. The 2025–2027 strategic plan targets a 40% increase in rides, and there is a dedicated line-item budget for drivers, vehicles, and dispatch.", titles: ["Strategic Plan 2025–2027", "Program budget — Uplift Transportation", "Interview — Lili Reitz, Executive Director"] },
  { q: /found|story|why|start/i, tenant: "Fund The Climb Foundation", a: "The founding story comes through clearly in the leadership interview: Lili Reitz started the organization after watching clients miss treatment appointments solely because they lacked a way to get there. That insight became the Uplift Transportation program.", titles: ["Interview — Lili Reitz, Executive Director", "Website — About & Programs (captured)"] },
  { q: /fund|money|grant|revenue|990|budget/i, tenant: "Fund The Climb Foundation", a: "On funding: the Form 990 (2024) documents revenue and program expenses, and the strategic plan calls out a goal to diversify beyond opioid settlement dollars. A prior ODH SUD application is on file and can be reused as a starting narrative.", titles: ["IRS Form 990 (2024)", "Prior grant application — ODH SUD", "Strategic Plan 2025–2027"] },
  { q: /screen|perinatal|maternal|nurtur/i, tenant: "KHAI Ventures", a: "KHAI's core product is nurtur, a perinatal and maternal mental health screening tool. The seed deck describes the screening workflow, clinical partnerships, and the market context; the founder interview explains why universal screening is the mission.", titles: ["Company website & product pages", "Pitch deck (Seed)", "Interview — Howie Greenman, Founder"] },
];

export default function ChatView({ tenantName, docs }: { tenantName: string; docs: DocumentWithTags[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [showBedrock, setShowBedrock] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const openDoc = docs.find(d => d.id === openDocId) ?? null;

  const ask = (q: string) => {
    const hit = CANNED.find(c => c.tenant === tenantName && c.q.test(q));
    const citations = hit ? hit.titles.map(t => docs.find(d => d.title === t)?.id).filter((x): x is string => Boolean(x)) : [];
    const content = hit ? hit.a : "Your documents don't contain a passage that answers that directly, so I won't guess. Try rephrasing, or browse the Library — and if this is something your Inven(s)tory should cover, that's worth telling the For Granted team.";
    setMsgs(m => [...m, { role: "user", content: q, citations: [] }, { role: "assistant", content, citations }]);
    setTimeout(() => streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" }), 50);
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
            <div className="bubble"><p>{m.content}</p>
              {m.citations.length > 0 && (
                <div className="cites">{m.citations.map(id => {
                  const d = docs.find(x => x.id === id);
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
      <div className="ai-disclaimer">Mock answers until Phase 6 — the real, Bedrock-powered pipeline.</div>
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
