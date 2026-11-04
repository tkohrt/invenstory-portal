"use client";
// Chat, in two tabs (patch 16, onboarding build, 3 November 2026; mockup
// "Chat: Inven(s)tory and Portal Guide").
//   Chat with your Inven(s)tory: RAG via /api/chat. Retrieval is RLS-scoped;
//     answers come only from the client's own Story Cards and documents, with
//     sources that open the Document Reader. Counts toward the AI allowance.
//   Portal Guide: /api/guide. How to use the portal, from the guide and the
//     account's status; never reads documents; never counts against the
//     allowance. Can start a tour.
// A question in the wrong tab is handed over to the other, decided without AI.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import Drawer from "./Drawer";
import InfoTip from "./InfoTip";
import type { ChatSessionSummary } from "@/lib/types";
import {
  loadSessionAction, deleteSessionAction, suggestCardFromAnswerAction, answerNotRightAction, loadGuideSessionAction,
} from "@/lib/server/chat-actions";
import { requestMoreUsageAction } from "@/lib/server/usage-actions";
import { LIMITS } from "@/lib/usage-limits";
import { GUIDE_LIMITS, HANDOVER_TO_GUIDE, looksLikePortalQuestion, type GuideButton } from "@/lib/portal-guide";
import { TOUR_EVENT, CHAT_TAB_EVENT } from "@/lib/tours";
import type { SuggestionSet, Suggestion } from "@/lib/chat-suggestions";

interface Cite { id: string; title: string }
interface Msg {
  role: "user" | "assistant"; content: string; citations: Cite[]; generated?: boolean; mode?: string;
  /** Portal Guide: tour and page buttons under the answer. */
  buttons?: GuideButton[];
  /** Belongs in the other tab: a button to ask it there. */
  handover?: Lane;
  /** Brought over from the other tab. */
  carried?: boolean;
  stopped?: boolean;
}
type Lane = "invenstory" | "guide";

const MARKER = /\[\[src:[0-9a-fA-F-]{36}\]\]/;
const MARKER_G = /(\[\[src:[0-9a-fA-F-]{36}\]\])/g;

function AnswerBody({ content, citations, onOpen, mode }: { content: string; citations: Cite[]; onOpen: (id: string) => void; mode?: string }) {
  const titleById = new Map(citations.map(c => [c.id, c.title]));
  // Marker-less (older/historical) messages: plain text + sources at the end.
  if (!MARKER.test(content)) {
    return (
      <>
        <p style={{ whiteSpace: "pre-wrap" }}>{content}</p>
        {citations.length > 0 && (
          <div className="cites">{citations.map(c => (
            <button type="button" key={c.id} className="cite" onClick={() => onOpen(c.id)}>SOURCE: {c.title}</button>
          ))}</div>
        )}
      </>
    );
  }
  // Extractive fallback (raw passages): one card per source section.
  if (mode === "extractive") {
    const sections: { text: string; id: string | null }[] = [];
    const re = /\[\[src:([0-9a-fA-F-]{36})\]\]/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      sections.push({ text: content.slice(last, m.index).trim(), id: m[1] });
      last = re.lastIndex;
    }
    const tail = content.slice(last).trim();
    if (tail) sections.push({ text: tail, id: null });
    return (
      <div className="answer-cards">
        {sections.filter(sec => sec.text || sec.id).map((sec, i) => (
          <div key={i} className="answer-card">
            {sec.text && <p className="answer-text">{sec.text}</p>}
            {sec.id && titleById.get(sec.id) && (
              <button type="button" className="cite inline card-src" onClick={() => onOpen(sec.id!)} title={`Open ${titleById.get(sec.id)}`}>SOURCE: {titleById.get(sec.id)}</button>
            )}
          </div>
        ))}
      </div>
    );
  }
  // Generative prose: flowing text with a source chip inline at each citation.
  const parts = content.split(MARKER_G);
  return (
    <div className="answer-body">
      {parts.map((part, i) => {
        const mm = part.match(/^\[\[src:([0-9a-fA-F-]{36})\]\]$/);
        if (mm) {
          const id = mm[1]; const title = titleById.get(id);
          if (!title) return null;
          return <button type="button" key={i} className="cite inline" onClick={() => onOpen(id)} title={`Open ${title}`}>SOURCE: {title}</button>;
        }
        return part ? <span key={i} className="answer-text">{part}</span> : null;
      })}
    </div>
  );
}

/** A citation opens the Document Reader in a new tab, so the page here keeps its place (Document Reader, Phase 1). */
const openInReader = (id: string) => { window.open(`/documents/${id}`, "_blank", "noopener"); };

/** The answer as plain words, for Copy. */
const plain = (m: Msg) => m.content.replace(MARKER_G, "").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();

interface Convo { id: string; title: string; created_at: string }

export default function ChatView({ tenantName, isAdmin, sessions: initialSessions, guideSessions: initialGuide, initialTab, invSuggest, guideSuggest }: {
  tenantName: string; isAdmin: boolean; sessions: ChatSessionSummary[]; guideSessions: Convo[];
  initialTab: Lane; invSuggest: SuggestionSet; guideSuggest: SuggestionSet;
}) {
  const router = useRouter();
  const [lane, setLane] = useState<Lane>(initialTab);
  const [msgs, setMsgs] = useState<Record<Lane, Msg[]>>({ invenstory: [], guide: [] });
  const [sid, setSid] = useState<Record<Lane, string | undefined>>({ invenstory: undefined, guide: undefined });
  const [convos, setConvos] = useState<Record<Lane, Convo[]>>({ invenstory: initialSessions, guide: initialGuide });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<Lane | null>(null);
  const [loadingConvo, setLoadingConvo] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // One request at a time per tab, each with its own Stop.
  const abort = useRef<Record<Lane, AbortController | null>>({ invenstory: null, guide: null });
  const streamRef = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // The client limits (lib/usage-limits.ts): shown only near a limit, with the way to ask for more at one.
  const [usage, setUsage] = useState<{ text: string; kind: "chat_month" | "ai_month" | null } | null>(null);
  const [requested, setRequested] = useState(false);
  const scroll = () => setTimeout(() => streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" }), 40);
  const add = (l: Lane, m: Msg) => setMsgs(x => ({ ...x, [l]: [...x[l], m] }));
  const say = (t: string) => { setToast(t); setTimeout(() => setToast(null), 4000); };

  useEffect(() => () => { abort.current.invenstory?.abort(); abort.current.guide?.abort(); }, []);
  // The "?" menu's Ask the Portal Guide, while already on this page.
  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent<string>).detail; if (t === "guide" || t === "invenstory") setLane(t); };
    window.addEventListener(CHAT_TAB_EVENT, on);
    return () => window.removeEventListener(CHAT_TAB_EVENT, on);
  }, []);

  const remember = (l: Lane, id: string, q: string) => {
    if (sid[l]) return;
    setSid(x => ({ ...x, [l]: id }));
    setConvos(x => ({ ...x, [l]: [{ id, title: q.slice(0, 60), created_at: new Date().toISOString() }, ...x[l]] }));
  };

  const askInvenstory = async (q: string) => {
    add("invenstory", { role: "user", content: q, citations: [] }); scroll();
    // A how-to question: handed to the Portal Guide, with no AI spent.
    if (looksLikePortalQuestion(q)) {
      add("invenstory", { role: "assistant", content: HANDOVER_TO_GUIDE(tenantName), citations: [], handover: "guide" });
      scroll(); return;
    }
    setBusy("invenstory");
    const ctl = new AbortController(); abort.current.invenstory = ctl;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, sessionId: sid.invenstory }), signal: ctl.signal });
      const b = await res.json();
      if (!res.ok) {
        add("invenstory", { role: "assistant", content: b.error ?? "Something went wrong.", citations: [] });
        if (res.status === 429 && b.canRequest) setUsage({ text: b.error, kind: b.requestKind === "ai_month" ? "ai_month" : "chat_month" });
      } else {
        setUsage(b.usageWarning ? { text: b.usageWarning, kind: null } : null);
        if (b.sessionId) remember("invenstory", b.sessionId, q);
        add("invenstory", { role: "assistant", content: b.content, citations: b.citations ?? [], generated: b.generated, mode: b.mode });
      }
    } catch (e) {
      add("invenstory", (e as Error)?.name === "AbortError"
        ? { role: "assistant", content: "Stopped. Ask again whenever you like.", citations: [], stopped: true }
        : { role: "assistant", content: "Network error. Please try again.", citations: [] });
    }
    abort.current.invenstory = null; setBusy(null); scroll();
  };

  const askGuide = async (q: string, carried = false) => {
    add("guide", { role: "user", content: q, citations: [], carried }); scroll();
    setBusy("guide");
    const ctl = new AbortController(); abort.current.guide = ctl;
    try {
      const res = await fetch("/api/guide", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, sessionId: sid.guide }), signal: ctl.signal });
      const b = await res.json();
      if (!res.ok) add("guide", { role: "assistant", content: b.error ?? "Something went wrong.", citations: [] });
      else {
        if (b.sessionId) remember("guide", b.sessionId, q);
        add("guide", { role: "assistant", content: b.answer, citations: [], buttons: b.buttons ?? [], handover: b.handover ?? undefined, generated: b.generated });
      }
    } catch (e) {
      add("guide", (e as Error)?.name === "AbortError"
        ? { role: "assistant", content: "Stopped. Ask again whenever you like.", citations: [], stopped: true }
        : { role: "assistant", content: "Network error. Please try again.", citations: [] });
    }
    abort.current.guide = null; setBusy(null); scroll();
  };

  const ask = (q: string, l: Lane = lane) => { if (busy) return; if (l === "guide") void askGuide(q); else void askInvenstory(q); };
  const send = () => { const v = input.trim(); if (!v || busy) return; setInput(""); ask(v); };
  const stop = () => abort.current[lane]?.abort();

  /** Ask it again in the other tab. */
  const carry = (to: Lane, q: string) => {
    if (busy) return;
    setLane(to);
    if (to === "guide") void askGuide(q, true); else void askInvenstory(q);
  };

  const pick = (s: Suggestion) => {
    if (s.tour) { window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { key: s.tour } })); return; }
    ask(s.text);
  };
  const press = (b: GuideButton) => {
    if (b.kind === "tour") window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { key: b.tour } }));
    else router.push(b.href);
  };

  const newChat = () => { abort.current[lane]?.abort(); setSid(x => ({ ...x, [lane]: undefined })); setMsgs(x => ({ ...x, [lane]: [] })); box.current?.focus(); };
  const openConvo = async (id: string) => {
    if (busy || loadingConvo) return;
    setLoadingConvo(true); setSid(x => ({ ...x, [lane]: id }));
    try {
      if (lane === "invenstory") {
        const h = await loadSessionAction(id);
        setMsgs(x => ({ ...x, invenstory: h.map(m => ({ ...m })) }));
      } else {
        const turns = await loadGuideSessionAction(id);
        setMsgs(x => ({ ...x, guide: turns.flatMap(t => [
          { role: "user" as const, content: t.question, citations: [] },
          { role: "assistant" as const, content: t.answer, citations: [], buttons: t.buttons },
        ]) }));
      }
    } catch { say("That conversation could not be opened."); }
    setLoadingConvo(false); scroll();
  };
  const deleteConvo = async (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Delete this conversation? This can’t be undone.")) return;
    await deleteSessionAction(id);
    setConvos(x => ({ ...x, invenstory: x.invenstory.filter(c => c.id !== id) }));
    if (sid.invenstory === id) { setSid(x => ({ ...x, invenstory: undefined })); setMsgs(x => ({ ...x, invenstory: [] })); }
  };

  const questionFor = (l: Lane, i: number) => { for (let j = i - 1; j >= 0; j--) if (msgs[l][j].role === "user") return msgs[l][j].content; return ""; };
  const copy = async (m: Msg) => { try { await navigator.clipboard.writeText(plain(m)); say("Copied."); } catch { say("Copying is blocked in this browser. Select the text instead."); } };
  const toCard = async (m: Msg, i: number) => {
    const r = await suggestCardFromAnswerAction({ question: questionFor("invenstory", i), answer: plain(m), sources: m.citations.map(c => c.title) }).catch(() => null);
    say(r?.message ?? "That did not save. Please try again.");
  };
  const notRight = async (l: Lane, m: Msg, i: number) => {
    const r = await answerNotRightAction({ lane: l, question: questionFor(l, i), answer: plain(m) }).catch(() => null);
    say(r?.ok ? "Thank you. Your For Granted team will see this." : "That did not send. Please try again.");
  };

  const list = msgs[lane];
  const sugg = lane === "invenstory" ? invSuggest : guideSuggest;
  const maxChars = lane === "guide" ? GUIDE_LIMITS.questionChars : (isAdmin ? undefined : LIMITS.chatQuestionChars);
  const writing = busy === lane;

  return (
    <div className="cv-page">
      {/* Past conversations: always shown (Shane, 4 Nov 2026). */}
      <aside className="cv-hist" aria-label={lane === "invenstory" ? "Recent conversations" : "Recent Portal Guide questions"} data-tour="chat-history">
        <div className="cv-hist-head">
          <b>{lane === "invenstory" ? "Recent conversations" : "Recent Portal Guide questions"}</b>
        </div>
        <button type="button" className="sb-btn sb-secondary sb-sm cv-new" onClick={newChat}>+ New chat</button>
        <div className="ch-list">
          {convos[lane].length === 0 && <p className="ch-empty">No past conversations yet.</p>}
          {convos[lane].map(cs => (
            <div key={cs.id} className={`ch-item${sid[lane] === cs.id ? " active" : ""}`} title={cs.title}>
              <button type="button" className="ch-open" onClick={() => openConvo(cs.id)}>
                <span className="ch-title">{cs.title || "Conversation"}</span>
                <span className="ch-date">{new Date(cs.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </button>
              {lane === "invenstory" && <button type="button" className="ch-del" onClick={e => deleteConvo(e, cs.id)} aria-label={`Delete ${cs.title || "conversation"}`} title="Delete">✕</button>}
            </div>
          ))}
        </div>
      </aside>
      <div className="cv-main">
        <header className="cv-head">
          {/* No visible title (Shane, 4 Nov 2026): the tabs lead. Kept for screen readers. */}
          <h2 className="sr-only">Chat</h2>
          <div className="cv-tabs" role="tablist" aria-label="Chat" data-tour="chat-tabs">
            <button type="button" role="tab" aria-selected={lane === "invenstory"} className={lane === "invenstory" ? "on" : ""} onClick={() => setLane("invenstory")}>
              <span className="cv-long">Chat with your Inven(s)tory</span><span className="cv-short">Your Inven(s)tory</span>
            </button>
            <button type="button" role="tab" aria-selected={lane === "guide"} className={lane === "guide" ? "on" : ""} onClick={() => setLane("guide")}>Portal Guide</button>
          </div>
        </header>

        <div className="cv-stream" ref={streamRef} role="log" aria-live="polite">
          {list.length === 0 && (
            <div className="cv-empty">
              <h3>{lane === "invenstory" ? `What would you like to know about ${tenantName}?` : "What can we help you do in the portal?"}</h3>
              <p className="cv-why">{sugg.why}</p>
              <div className="cv-suggest">
                {sugg.items.map(s => <button key={s.text} type="button" onClick={() => pick(s)}>{s.text}</button>)}
              </div>
            </div>
          )}
          {list.map((m, i) => m.role === "user" ? (
            <div key={i} className="cv-msg me">
              {m.carried && <div className="cv-carried">Brought over from Chat with your Inven(s)tory</div>}
              <div className="cv-bubble"><p style={{ whiteSpace: "pre-wrap" }}>{m.content}</p></div>
            </div>
          ) : (
            <div key={i} className="cv-msg ai">
              <div className="cv-from">{lane === "invenstory" ? "From your Inven(s)tory" : "From the Portal Guide"}</div>
              <div className="cv-bubble">
                {lane === "invenstory"
                  ? <AnswerBody content={m.content} citations={m.citations ?? []} onOpen={openInReader} mode={m.mode} />
                  : <p style={{ whiteSpace: "pre-wrap" }}>{m.content}</p>}
                {m.mode === "extractive" && (
                  <div className="ai-disclaimer" style={{ marginTop: 8 }}>The AI could not write an answer this time, so these are the closest source passages, each linked to its document.</div>
                )}
                {m.handover && (
                  <button type="button" className="sb-btn sb-secondary sb-sm cv-handover" onClick={() => carry(m.handover!, questionFor(lane, i))}>
                    {m.handover === "guide" ? "Ask in Portal Guide" : "Ask in Chat with your Inven(s)tory"}
                  </button>
                )}
                {(m.buttons?.length ?? 0) > 0 && (
                  <div className="cv-buttons">{m.buttons!.map(b => (
                    <button key={b.kind === "tour" ? b.tour : b.href} type="button" className="sb-btn sb-secondary sb-sm" onClick={() => press(b)}>{b.label}</button>
                  ))}</div>
                )}
              </div>
              {!m.handover && !m.stopped && (
                <div className="cv-controls">
                  <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => copy(m)}>Copy</button>
                  {lane === "invenstory" && m.citations.length > 0 && <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => toCard(m, i)}>Save as a Story Card</button>}
                  <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => notRight(lane, m, i)}>Not right</button>
                </div>
              )}
            </div>
          ))}
          {writing && <div className="cv-msg ai"><div className="cv-from">{lane === "invenstory" ? "From your Inven(s)tory" : "From the Portal Guide"}</div><div className="cv-bubble"><p className="empty">Writing an answer…</p></div></div>}
        </div>

        <div className="cv-dock" data-tour="chat-input">
          {usage && lane === "invenstory" && (
            <div className="chat-usage">
              <span>{usage.text}</span>
              {usage.kind && (requested
                ? <span className="ov-muted">Request sent. For Granted will be in touch.</span>
                : <button type="button" className="sb-btn sb-secondary sb-sm" onClick={async () => {
                    try { await requestMoreUsageAction(usage.kind!); setRequested(true); } catch { setRequested(true); }
                  }}>Ask For Granted for more</button>)}
            </div>
          )}
          <div className="cv-input">
            <textarea ref={box} rows={1} value={input} maxLength={maxChars}
              aria-label={lane === "invenstory" ? "Ask about your organization" : "Ask how to use the portal"}
              placeholder={lane === "invenstory" ? "Ask about your organization" : "Ask how to use the portal"}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
            {writing
              ? <button type="button" className="sb-btn sb-secondary" onClick={stop}>Stop</button>
              : <button type="button" className="sb-btn sb-primary" onClick={send} disabled={!!busy || !input.trim()}>Send</button>}
          </div>
          <div className="cv-foot">
            {lane === "invenstory"
              ? <>Answers are drawn only from your Story Cards and documents, with your data protected by Supabase and Amazon Bedrock.{" "}
                  <button type="button" className="fc-link" onClick={() => setShowPrivacy(true)}>Learn more</button></>
              : <>Answers from the portal guide and your setup status.{" "}
                  <InfoTip label="Free to use" side="up">
                    <b>Free to use.</b> Portal Guide questions do not use your AI allowance. Answers come from our guide to the portal and from where your account stands, such as setup progress and which tools are ready. It never reads your documents.
                  </InfoTip></>}
          </div>
        </div>
        {toast && <div className="cv-toast" role="status">{toast}</div>}
      </div>

      {showPrivacy && (
        <Drawer onClose={() => setShowPrivacy(false)}>
          <h3>How your data is protected</h3>
          <p style={{ color: "var(--muted)", marginTop: 2 }}>AI privacy on the For Granted platform</p>
          <p style={{ marginTop: 14, lineHeight: 1.6 }}>Your Inven(s)tory&rsquo;s AI runs across two services that For Granted controls: <b>Supabase</b> for search and retrieval, and <b>Amazon Bedrock</b> for writing answers. Neither is a public AI chatbot, and neither retains or trains on your data.</p>
          <div className="kv"><div className="k" style={{ width: 26 }}>✓</div><div><b>Search and retrieval (Supabase).</b> Finding the right passages in your documents runs on an open model inside For Granted&rsquo;s own Supabase infrastructure, where your data already lives. Nothing is sent to an outside AI provider.</div></div>
          <div className="kv"><div className="k" style={{ width: 26 }}>✓</div><div><b>Writing answers (Amazon Bedrock).</b> Composing a written answer runs through Amazon Bedrock inside For Granted&rsquo;s own cloud account, not a public AI service. Bedrock does not store your prompts or answers, and Amazon is contractually prohibited from training on your material.</div></div>
          <div className="kv"><div className="k" style={{ width: 26 }}>✓</div><div><b>No training on your data.</b> Neither service uses your documents, questions or answers to train AI models.</div></div>
          <div className="kv"><div className="k" style={{ width: 26 }}>✓</div><div><b>Your documents stay put.</b> Your Inven(s)tory is stored in secure infrastructure For Granted controls, visible only to your organization and the For Granted team.</div></div>
          <p style={{ lineHeight: 1.6, marginTop: 10 }}>In short: no AI company ever holds your data.</p>
          <a className="sb-btn sb-secondary" style={{ textDecoration: "none", marginTop: 8, marginRight: 8 }}
            href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">↗ Supabase privacy</a>
          <a className="sb-btn sb-secondary" style={{ textDecoration: "none", marginTop: 8 }}
            href="https://aws.amazon.com/bedrock/faqs/" target="_blank" rel="noopener noreferrer">↗ Amazon Bedrock FAQ</a>
        </Drawer>
      )}
    </div>
  );
}
