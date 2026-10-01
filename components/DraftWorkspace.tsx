"use client";
// The drafting workspace (Story Card Drafter, Phase 3: Arrange).
//
// One question at a time: the funder's words at the top with the limit and a
// live count, the client's Story Cards on the left ranked for this question,
// and the answer in the centre as ordered blocks. A writer drags a card in, or
// presses Add (the keyboard and phone path); reorders by dragging or with the
// arrow buttons; clicks a block to edit it for this draft only; and can ask
// Tidy for a suggested order, which they accept or ignore.
//
// Every change is saved as it is made and the server's answer replaces the
// local one, so the page always shows what is stored. Changes go through one
// queue, so two quick clicks never race each other into a muddled order.
//
// Weave and Polish (bridges, fit to limit, figure audit) are Phase 4; their
// stage tabs are shown, disabled, so the shape of the work is visible.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useDraggable, useDroppable,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addCardBlockAction, addHumanBlockAction, approveStandardAnswerAction, arrangeForMeAction, editBlockAction,
  fillFromStandardsAction, logShownAction, openStandardAnswersAction,
  refreshBlockWordingAction, removeBlockAction, reorderBlocksAction, setBreakAction, setSectionDoneAction,
  startFromStandardAction, tidyAction,
} from "@/lib/server/workspace-actions";
import { reopenSectionsAction } from "@/lib/server/application-actions";
import { PANEL_SIZE, rankCards, reasonFor, recommendSection, type Ranked } from "@/lib/story-card-rank";
import { placeable } from "@/lib/card-sensitivity";
import { assembleAnswer, countFor, limitState, moveItem } from "@/lib/section-answer";
import { CARD_KIND_MAP, untracedFigures } from "@/lib/story-card";
import type { Workspace, WsBlock, WsCard, WsSection, WsStandard } from "@/lib/server/workspace";
import type { GrantDraft } from "@/lib/types";

const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };
const STATUS_LABEL: Record<WsSection["status"], string> = { empty: "Not started", drafting: "Drafting", done: "Done" };
const SOURCE_LABEL: Record<string, string> = { paste: "pasted text", pdf: "a PDF", docx: "a Word file", url: "a web page", match: "Funder Matches" };

const layerClass = (l: string | null) => (l === "I" ? "l1" : l === "II" ? "l2" : l === "III" ? "l3" : "");

export default function DraftWorkspace({ tenantName, draft, ws, sourceText, initialQuestion, since }: {
  tenantName: string; draft: GrantDraft; ws: Workspace; sourceText: string; initialQuestion: number;
  /** Standard Answers: when it was last opened, to mark questions added since. */
  since?: string | null;
}) {
  const router = useRouter();
  const standard = ws.purpose === "standard_answers";
  const sections = ws.sections;
  const cardById = useMemo(() => new Map(ws.cards.map(c => [c.id, c])), [ws.cards]);

  const [idx, setIdx] = useState(() => Math.min(Math.max(initialQuestion - 1, 0), Math.max(sections.length - 1, 0)));
  const [blocksBy, setBlocksBy] = useState<Record<string, WsBlock[]>>(() => {
    const m: Record<string, WsBlock[]> = Object.fromEntries(sections.map(s => [s.id, [] as WsBlock[]]));
    for (const b of ws.blocks) (m[b.sectionId] ??= []).push(b);
    return m;
  });
  const [statusBy, setStatusBy] = useState<Record<string, WsSection["status"]>>(
    () => Object.fromEntries(sections.map(s => [s.id, s.status])));
  const [standards, setStandards] = useState<WsStandard[]>(ws.standards);
  const [pending, setPending] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [tidy, setTidy] = useState<{ order: string[]; rationale: string } | null>(null);
  const [dragging, setDragging] = useState<WsCard | null>(null);
  const [seams, setSeams] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [stripVisible, setStripVisible] = useState(false);
  const [splitHeight, setSplitHeight] = useState<number | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const questionRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // The two columns scroll on their own, so the page itself must not: size the
  // split to the space left under the top line.
  useEffect(() => {
    const fit = () => {
      const el = splitRef.current;
      if (!el) return;
      if (window.innerWidth <= 860) { setSplitHeight(null); return; }
      const top = el.getBoundingClientRect().top + (document.querySelector(".main")?.scrollTop ?? 0);
      setSplitHeight(Math.max(420, window.innerHeight - top - 16));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // When the question card scrolls out of view, a one-line strip says which question this is.
  useEffect(() => {
    const root = scrollRef.current, q = questionRef.current;
    if (!root || !q || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStripVisible(!e.isIntersecting), { root, threshold: 0 });
    io.observe(q);
    return () => io.disconnect();
  });

  // A notice says its piece and goes: about twelve seconds, or sooner with the X.
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 12_000);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  /** Bring what a bar button opened (Tidy, seams) into view, just above the bar. */
  const reveal = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 60);

  // Standard Answers: recommended questions first, the rest under "optional".
  // An application keeps the funder's order.
  const kindsAvailable = useMemo(() => new Set(ws.cards.filter(c => placeable(c)).map(c => c.kind)), [ws.cards]);
  const advice = useMemo(() => sections.map(s => standard
    ? recommendSection(ws.bank[s.slugs[0] ?? ""] ?? null, s.wantedKinds, kindsAvailable)
    : { recommended: true, why: "" }), [sections, standard, ws.bank, kindsAvailable]);
  const isNew = (s: WsSection) => !!since && !!s.createdAt && s.createdAt > since;

  // A refresh after a failed save brings the stored answer back: start from it.
  // (Adjusting state while rendering, React's pattern for state derived from props.)
  const [syncedWs, setSyncedWs] = useState(ws);
  if (syncedWs !== ws) {
    setSyncedWs(ws);
    const m: Record<string, WsBlock[]> = Object.fromEntries(ws.sections.map(s => [s.id, [] as WsBlock[]]));
    for (const b of ws.blocks) (m[b.sectionId] ??= []).push(b);
    setBlocksBy(m);
    setStatusBy(Object.fromEntries(ws.sections.map(s => [s.id, s.status])));
    setStandards(ws.standards);
  }

  const section = sections[idx];
  const blocks = useMemo(() => (section ? blocksBy[section.id] ?? [] : []), [blocksBy, section]);

  // Keep the question in the address, so a reload or a shared link opens it.
  useEffect(() => {
    if (!section) return;
    const url = new URL(window.location.href);
    url.searchParams.set("q", String(idx + 1));
    window.history.replaceState(null, "", url.toString());
  }, [idx, section]);

  const go = (i: number) => {
    setIdx(i); setTidy(null); setEditing(null); setNotice(null); setPanelOpen(false);
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const recommendedIdx = sections.map((_, i) => i).filter(i => advice[i].recommended);
  const optionalIdx = sections.map((_, i) => i).filter(i => !advice[i].recommended);
  const navOrder = [...recommendedIdx, ...optionalIdx];
  const navAt = navOrder.indexOf(idx);

  // ---- The save queue -------------------------------------------------------
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = useCallback(<T,>(work: () => Promise<T>, apply: (r: T) => void) => {
    setPending(n => n + 1); setError(null);
    queue.current = queue.current.then(async () => {
      try {
        apply(await work());
        setSavedAt(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : "That change could not be saved.");
        router.refresh();
      } finally {
        setPending(n => n - 1);
      }
    });
    return queue.current;
  }, [router]);

  const putBlocks = useCallback((sectionId: string) => (next: WsBlock[]) => {
    setBlocksBy(m => ({ ...m, [sectionId]: next }));
    setStatusBy(m => {
      const cur = m[sectionId];
      const st = next.length === 0 ? "empty" : cur === "empty" ? "drafting" : cur;
      return cur === st ? m : { ...m, [sectionId]: st };
    });
  }, []);

  // ---- Ranking --------------------------------------------------------------
  const usedWhere = useMemo(() => {
    const m = new Map<string, number[]>();
    sections.forEach((s, i) => {
      for (const b of blocksBy[s.id] ?? []) if (b.cardId) m.set(b.cardId, [...(m.get(b.cardId) ?? []), i + 1]);
    });
    return m;
  }, [sections, blocksBy]);

  const ranked: Ranked[] = useMemo(() => {
    if (!section) return [];
    const inSection = new Set(blocks.filter(b => b.cardId).map(b => b.cardId as string));
    const usedElsewhere = new Set([...usedWhere.entries()]
      .filter(([id, qs]) => qs.some(q => q !== idx + 1) && !inSection.has(id)).map(([id]) => id));
    const sectionHasVoice = blocks.some(b => b.cardId && cardById.get(b.cardId)?.layer === "III");
    return rankCards(ws.cards, {
      prompt: section.prompt, guidance: section.guidance, wantedKinds: section.wantedKinds, slugs: section.slugs,
    }, { now: new Date(), usedElsewhere, inSection, sectionHasVoice });
  }, [section, blocks, usedWhere, idx, cardById, ws.cards]);

  // ---- Drag and drop --------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const locked = pending > 0;

  const addCard = useCallback((cardId: string, position: number) => {
    if (!section) return;
    const r = ranked.find(x => x.card.id === cardId);
    const temp: WsBlock = {
      id: `tmp-${cardId}`, sectionId: section.id, kind: "card", cardId, cardVersion: cardById.get(cardId)?.version ?? 1,
      text: cardById.get(cardId)?.statement ?? "", edited: false, breakBefore: false,
    };
    setBlocksBy(m => {
      const list = [...(m[section.id] ?? [])];
      list.splice(Math.min(position, list.length), 0, temp);
      return { ...m, [section.id]: list };
    });
    void run(() => addCardBlockAction(section.id, cardId, position, r ? { position: r.position, score: r.score } : null),
      putBlocks(section.id));
  }, [section, ranked, cardById, run, putBlocks]);

  const reorder = useCallback((order: string[], via: "drag" | "buttons" | "tidy") => {
    if (!section) return;
    const byId = new Map(blocks.map(b => [b.id, b]));
    setBlocksBy(m => ({ ...m, [section.id]: order.map(id => byId.get(id)!).filter(Boolean) }));
    void run(() => reorderBlocksAction(section.id, order, via), putBlocks(section.id));
  }, [section, blocks, run, putBlocks]);

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as { type?: string; cardId?: string } | undefined;
    setDragging(d?.type === "card" && d.cardId ? cardById.get(d.cardId) ?? null : null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const { active, over } = e;
    if (!over || !section) return;
    const d = active.data.current as { type?: string; cardId?: string } | undefined;
    const overIdx = blocks.findIndex(b => b.id === over.id);
    if (d?.type === "card" && d.cardId) {
      if (overIdx < 0 && over.id !== "answer") return;
      addCard(d.cardId, overIdx >= 0 ? overIdx : blocks.length);
      return;
    }
    const from = blocks.findIndex(b => b.id === active.id);
    if (from < 0 || overIdx < 0 || from === overIdx) return;
    reorder(moveItem(blocks, from, overIdx).map(b => b.id), "drag");
  };

  if (!section) {
    return <div className="empty">This application has no questions yet. Reopen the questions to add some.</div>;
  }

  const text = assembleAnswer(blocks);
  const unit = section.limitUnit ?? "words";
  const count = countFor(text, unit);
  const lim = limitState(count, section.limitValue);
  const doneCount = sections.filter(s => statusBy[s.id] === "done").length;
  const startedCount = sections.filter(s => statusBy[s.id] !== "empty").length;
  const slug = section.slugs[0];
  const std = slug ? standards.find(x => x.slug === slug) : undefined;
  const changedSinceApproval = standard && std && std.sectionId === section.id && std.text !== text;
  // An application question whose limit is tighter than the standard answer it
  // can start from: say so before the writer starts, not after.
  const stdCount = std?.text ? countFor(std.text, unit) : 0;
  const stdTooLong = !standard && !!std?.sectionId && !!section.limitValue && stdCount > section.limitValue;
  // Every empty question that an approved standard answer could start.
  const fillable = standard ? 0 : sections.filter(s => (blocksBy[s.id] ?? []).length === 0
    && s.slugs[0] && standards.some(x => x.slug === s.slugs[0] && x.sectionId)).length;
  const noStandards = !standard && !standards.some(x => x.sectionId);
  const blockedHere = blocks.filter(b => b.cardId && !placeable(cardById.get(b.cardId) ?? {})).length;

  const money = draft.amount_cents == null ? null : "$" + (draft.amount_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

  const reopen = async () => {
    if (!confirm("Reopen the questions to edit them? Questions you delete, or merge into another, lose the cards placed in them. Questions you only reword keep their answers.")) return;
    try { await reopenSectionsAction(draft.id); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not reopen the questions."); }
  };

  const target = section.limitValue;
  const countLabel = target
    ? `${count.toLocaleString()} ${standard ? "of about" : "/"} ${target.toLocaleString()} ${unit}`
    : `${count.toLocaleString()} ${unit}`;

  return (
    <div className="ws ws-page">
      <header className="ws-top">
        <button className="btn ghost ws-back" onClick={() => router.push("/drafts")}>← Drafts</button>
        <h2 className="ws-title">{draft.title}</h2>
        <About standard={standard} tenantName={tenantName}
          meta={standard ? null : [draft.funder, money, draft.deadline ? `due ${new Date(draft.deadline + "T12:00:00").toLocaleDateString()}` : null].filter(Boolean).join(" · ")} />
        <span className="spacer" />
        <span className="ws-flag">Admin · {tenantName} · For Granted only</span>
        <span className="ws-saved" aria-live="polite">{pending ? "Saving…" : savedAt ? "All changes saved" : ""}</span>
      </header>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}>
        <div className="ws-split" ref={splitRef} style={splitHeight ? { height: splitHeight } : undefined}>
          <CardPanel key={section.id} sectionId={section.id} ranked={ranked} usedWhere={usedWhere} current={idx + 1}
            wantedKinds={section.wantedKinds} locked={false} onAdd={id => addCard(id, blocks.length)}
            open={panelOpen} onClose={() => setPanelOpen(false)} />

          <div className="ws-main">
            {stripVisible && (
              <button type="button" className="ws-strip" onClick={() => questionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                title="Back to the question">
                <span className="ws-q-num">Q{idx + 1}</span>
                <span className="ws-strip-text">{section.prompt}</span>
              </button>
            )}
            <div className="ws-scroll" ref={scrollRef}>
              <div className="ws-stages" role="tablist" aria-label="Drafting stage">
                <button type="button" role="tab" aria-selected="true" className="chip active">Arrange</button>
                <button type="button" role="tab" aria-selected="false" className="chip" disabled title="Bridges between cards, in the client's voice. Next release.">Weave</button>
                <button type="button" role="tab" aria-selected="false" className="chip" disabled title="Fit to limit, figure audit, repetition check. Next release.">Polish</button>
              </div>

              <nav className="ws-nav" aria-label="Questions">
                <button type="button" className="btn ghost ap-mini" disabled={navAt <= 0} onClick={() => go(navOrder[navAt - 1])}>← Previous</button>
                <div className="ws-pills">
                  {recommendedIdx.map(i => <Pill key={sections[i].id} i={i} />)}
                  {optionalIdx.length > 0 && (
                    <button type="button" className="btn ghost ap-mini ws-opt-toggle" onClick={() => setShowOptional(v => !v)}
                      title="Questions fewer funders ask, or that this client has no cards for yet">
                      {showOptional || optionalIdx.includes(idx) ? "Optional:" : `＋ ${optionalIdx.length} optional`}
                    </button>
                  )}
                  {(showOptional || optionalIdx.includes(idx)) && optionalIdx.map(i => <Pill key={sections[i].id} i={i} optional />)}
                </div>
                <button type="button" className="btn ghost ap-mini" disabled={navAt < 0 || navAt >= navOrder.length - 1} onClick={() => go(navOrder[navAt + 1])}>Next →</button>
              </nav>

              <section className="ws-question" ref={questionRef}>
                <div className="ws-q-head">
                  <span className="ws-q-num">Question {idx + 1} of {sections.length}</span>
                  <span className={`ov-tag ws-st-${statusBy[section.id]}`}>{STATUS_LABEL[statusBy[section.id]]}</span>
                  {standard && !advice[idx].recommended && <span className="ov-muted">Optional: {advice[idx].why}</span>}
                </div>
                <p className="ws-prompt">{section.prompt}</p>
                {(section.guidance || section.criteria) && (
                  <details className="ws-guide">
                    <summary>Guidance{section.criteria ? " and scoring" : ""}</summary>
                    {section.guidance && <div className="ap-guidance">{section.guidance}</div>}
                    {section.criteria && <div className="ap-guidance"><strong>Scoring:</strong> {section.criteria}</div>}
                  </details>
                )}
                {stdTooLong && (
                  <div className="ws-warn ws-soft">The standard answer is {stdCount.toLocaleString()} {unit}; this funder allows {section.limitValue!.toLocaleString()}. Starting from it means cutting.</div>
                )}
                <div className="ap-kinds">
                  <span className="ov-muted">Calls for:</span>
                  {section.wantedKinds.length
                    ? section.wantedKinds.map(k => <span key={k} className="ov-tag ap-kind">{CARD_KIND_MAP[k]?.label ?? k}</span>)
                    : <span className="ov-muted">no card kinds set (ranked by wording and evidence only)</span>}
                </div>
              </section>

              <div className="ws-progress">{doneCount} of {sections.length} done · {startedCount} started</div>

              {standard && since && sections.some(isNew) && (
                <div className="ws-notice" role="status">
                  {sections.filter(isNew).length} new question{sections.filter(isNew).length === 1 ? "" : "s"} since you last opened Standard Answers,
                  learned from funders&rsquo; applications: {sections.filter(isNew).map(s => sections.indexOf(s) + 1).join(", ")}. They are marked in the list above.
                </div>
              )}
              {noStandards && (
                <div className="ws-notice ws-soft-notice">
                  <strong>Start with Standard Answers.</strong> {tenantName} has no approved standard answers yet. Answer the questions
                  funders ask most once, and every application, this one included, can start from them.{" "}
                  <button type="button" className="cl-link" onClick={() => void openStandardAnswersAction()
                    .then(r => router.push(`/drafts/${r.draftId}`)).catch(e => setError(e instanceof Error ? e.message : "Could not open Standard Answers."))}>Open Standard Answers</button>
                </div>
              )}
              {fillable > 0 && (
                <div className="ws-notice">
                  {fillable} question{fillable === 1 ? "" : "s"} here match{fillable === 1 ? "es" : ""} an approved standard answer and {fillable === 1 ? "is" : "are"} still empty.{" "}
                  <button type="button" className="btn secondary ap-mini" disabled={locked}
                    onClick={() => void run(() => fillFromStandardsAction(draft.id), r => {
                      say(`${r.filled} question${r.filled === 1 ? "" : "s"} started from Standard Answers`
                        + (r.skipped ? `; ${r.skipped} left empty because their standard answer holds a sensitive card awaiting a decision.` : ".")
                        + " Rearrange each for this funder.");
                      router.refresh();
                    })}>Fill {fillable} from Standard Answers</button>
                </div>
              )}

              {error && <div className="ap-error" role="alert">{error} <button className="btn ghost ap-mini" onClick={() => setError(null)}>Dismiss</button></div>}
              {notice && (
                <div className="ws-notice ws-notice-x" role="status">
                  <span>{notice}</span>
                  <button type="button" className="bn-x" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
                </div>
              )}

              <AnswerColumn
                blocks={blocks} cardById={cardById} locked={locked} editing={editing} setEditing={setEditing}
                onMove={(from, to) => reorder(moveItem(blocks, from, to).map(b => b.id), "buttons")}
                onRemove={id => {
                  setBlocksBy(m => ({ ...m, [section.id]: blocks.filter(b => b.id !== id) }));
                  void run(() => removeBlockAction(section.id, id), putBlocks(section.id));
                }}
                onEdit={(id, t) => run(() => editBlockAction(section.id, id, t), putBlocks(section.id))}
                onBreak={(id, v) => run(() => setBreakAction(section.id, id, v), putBlocks(section.id))}
                onRefresh={id => run(() => refreshBlockWordingAction(section.id, id), putBlocks(section.id))}
                empty={
                  <EmptyAnswer
                    std={!standard && std?.sectionId ? std : undefined}
                    onStart={() => void run(() => startFromStandardAction(section.id), putBlocks(section.id))}
                  />
                }
              />

              {blockedHere > 0 && (
                <div className="ws-warn">{blockedHere} card{blockedHere === 1 ? " here is" : "s here are"} now flagged as sensitive and undecided. Decide {blockedHere === 1 ? "it" : "them"} in the Card Library, or remove {blockedHere === 1 ? "it" : "them"}, before this answer is used.</div>
              )}

              {standard && std && (
                <p className="ov-muted ws-approved">
                  {std.sectionId === section.id
                    ? `In the Answer Library since ${std.approvedAt ? new Date(std.approvedAt).toLocaleDateString() : "approval"}${changedSinceApproval ? "; this answer has changed since, and the library still has the earlier text." : "."}`
                    : "The Answer Library has an earlier, hand-written answer to this question. Approving replaces it."}
                </p>
              )}

              <div className="ws-foot">
                {!standard && <button type="button" className="btn ghost" onClick={() => void reopen()}>Edit the questions</button>}
                {!standard && sourceText && (
                  <details className="ap-source">
                    <summary>The funder&rsquo;s application ({SOURCE_LABEL[draft.source_kind ?? "paste"] ?? "text"}, {sourceText.length.toLocaleString()} characters)</summary>
                    <pre>{sourceText}</pre>
                  </details>
                )}
              </div>

              {/* Opened by buttons in the bar, so they appear just above it. */}
              {seams && blocks.length > 0 && <SeamsView blocks={blocks} />}
              {tidy && (
                <div className="ws-tidy" role="status">
                  <strong>Tidy suggests this order.</strong> {tidy.rationale}
                  <ol>{tidy.order.map(id => <li key={id}>{(blocks.find(b => b.id === id)?.text ?? "").slice(0, 110)}…</li>)}</ol>
                  <div className="ap-actions">
                    <button type="button" className="btn inline ap-go" disabled={locked}
                      onClick={() => { const o = tidy.order; setTidy(null); reorder(o, "tidy"); }}>Use this order</button>
                    <button type="button" className="btn ghost" onClick={() => setTidy(null)}>Keep mine</button>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {/* The action bar: always on screen, grouped as the work goes. */}
            <div className="ws-bar" role="toolbar" aria-label="Answer actions">
              <span className={`ws-count ws-lim-${lim}`} title={target ? `${standard ? "Typical length" : "Limit"}: ${target.toLocaleString()} ${unit}` : "No limit stated"}>
                {countLabel}{lim === "over" ? (standard ? " · long" : " · over") : ""}
              </span>
              <span className="ws-bar-group">
                <button type="button" className="btn ghost ws-panel-toggle" onClick={() => setPanelOpen(true)}>Story Cards</button>
                {blocks.length === 0 && (
                  <button type="button" className="btn secondary" disabled={locked} title="Places the best cards for this question, in order. Cards only: nothing is written for you."
                    onClick={() => void run(() => arrangeForMeAction(section.id), r => {
                      putBlocks(section.id)(r.blocks);
                      say(`Placed ${r.placed} card${r.placed === 1 ? "" : "s"}: one of each kind this question asks for first, then more while about four-fifths of the ${standard ? "typical length" : "limit"} allowed. Nothing was written; edit, reorder or remove as you like.`);
                    })}>Arrange for me</button>
                )}
                <button type="button" className="btn secondary" disabled={locked} onClick={() => {
                  setEditing("__new");
                  void run(() => addHumanBlockAction(section.id, blocks.length), next => {
                    putBlocks(section.id)(next);
                    const added = next.find(b => b.kind === "human" && !b.text && !blocks.some(o => o.id === b.id));
                    setEditing(added?.id ?? null);
                  });
                }}>＋ Write your own text</button>
                <button type="button" className="btn secondary" disabled={locked || blocks.length < 3}
                  title={blocks.length < 3 ? "Tidy needs at least three pieces" : "Ask for a suggested order, with a reason. Nothing changes unless you accept it."}
                  onClick={() => void run(() => tidyAction(section.id), r => {
                    if ("error" in r) say(r.error);
                    else if (r.order.every((id, i) => id === blocks[i]?.id)) say(`Tidy would keep this order. ${r.rationale}`);
                    else { setTidy(r); reveal(); }
                  })}>Tidy</button>
              </span>
              <span className="ws-bar-group">
                <button type="button" className={`btn ghost${seams ? " ws-seams-on" : ""}`} disabled={!blocks.length}
                  onClick={() => { setSeams(v => !v); if (!seams) reveal(); }}
                  title="See the answer as one text, marked by where each part came from">{seams ? "Hide seams" : "Show seams"}</button>
                <CopyButton text={text} />
              </span>
              <span className="spacer" />
              <span className="ws-bar-group">
                {statusBy[section.id] === "done"
                  ? <button type="button" className="btn ghost" disabled={locked}
                      onClick={() => void run(() => setSectionDoneAction(section.id, false), st => setStatusBy(m => ({ ...m, [section.id]: st })))}>Reopen this answer</button>
                  : <button type="button" className="btn secondary ws-done-btn" disabled={locked || !blocks.length}
                      onClick={() => void run(() => setSectionDoneAction(section.id, true), st => setStatusBy(m => ({ ...m, [section.id]: st })))}>Mark this answer done</button>}
                {standard && (
                  <button type="button" className="btn inline ap-go" disabled={locked || !text || (std?.sectionId === section.id && !changedSinceApproval)}
                    title="Publish this answer to the client's Answer Library, linked to the cards it was built from."
                    onClick={() => void run(() => approveStandardAnswerAction(section.id), r => {
                      if (!slug) return;
                      setStandards(list => [...list.filter(x => x.slug !== slug), { slug, answerId: "", sectionId: section.id, text, approvedAt: r.approvedAt }]);
                      setStatusBy(m => ({ ...m, [section.id]: "done" }));
                      say("Approved into the Answer Library.");
                    })}>
                    {std?.sectionId === section.id ? (changedSinceApproval ? "Approve the changes" : "Approved") : "Approve into the Answer Library"}
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? <div className={`ws-card ws-overlay ${layerClass(dragging.layer)}`}><p className="cl-statement">{dragging.statement}</p></div> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );

  function Pill({ i, optional }: { i: number; optional?: boolean }) {
    const s = sections[i];
    return (
      <button type="button" className={`ws-pill ws-pill-${statusBy[s.id]}${optional ? " ws-pill-opt" : ""}${i === idx ? " active" : ""}${isNew(s) ? " ws-pill-new" : ""}`}
        onClick={() => go(i)}
        title={`${i + 1}. ${s.prompt.slice(0, 120)} (${STATUS_LABEL[statusBy[s.id]]})${optional ? ` · optional: ${advice[i].why}` : ""}${isNew(s) ? " · new since you last opened this" : ""}`}
        aria-current={i === idx ? "step" : undefined}>{i + 1}</button>
    );
  }
}

/** The page's description, out of the way until someone asks for it. */
function About({ standard, tenantName, meta }: { standard: boolean; tenantName: string; meta: string | null }) {
  return (
    <span className="ws-about-wrap">
      {meta && <span className="ws-meta">{meta}</span>}
      <details className="ws-about">
        <summary title="What this page is for">About</summary>
        <div className="ws-about-pop">
          {standard
            ? <>The questions funders ask again and again, answered once from {tenantName}&rsquo;s Story Cards. An approved answer goes into the Answer Library and can start any application&rsquo;s matching question. Lengths shown are typical, not limits.</>
            : <>This application&rsquo;s questions, answered from {tenantName}&rsquo;s Story Cards. Drag cards into the answer, or use Arrange for me; every sentence keeps its source. Weave and Polish come next.</>}
        </div>
      </details>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The card panel.
// ---------------------------------------------------------------------------

function CardPanel({ sectionId, ranked, usedWhere, current, wantedKinds, locked, onAdd, open, onClose }: {
  sectionId: string; ranked: Ranked[]; usedWhere: Map<string, number[]>; current: number;
  wantedKinds: string[]; locked: boolean; onAdd: (cardId: string) => void;
  /** Small screens: the panel is a drawer, opened from the action bar. */
  open: boolean; onClose: () => void;
}) {
  const [kind, setKind] = useState("");
  const [layer, setLayer] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PANEL_SIZE);
  const logged = useRef(new Set<string>());

  const filtering = !!(kind || layer || q.trim());
  const list = ranked.filter(r => {
    if (kind === "__wanted" && !wantedKinds.includes(r.card.kind)) return false;
    if (kind && kind !== "__wanted" && r.card.kind !== kind) return false;
    if (layer && r.card.layer !== layer) return false;
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      const c = r.card as WsCard;
      if (!`${c.statement} ${c.evidence.map(e => `${e.quote} ${e.title}`).join(" ")}`.toLowerCase().includes(n)) return false;
    }
    return true;
  });
  const shown = list.slice(0, limit);

  // Log what the panel put in front of the writer: on opening the question and
  // on "show more", unfiltered. Not on each keystroke in the search box.
  const shownKey = filtering ? "" : `${sectionId}:${shown.length}`;
  useEffect(() => {
    if (!shownKey || logged.current.has(shownKey) || !shown.length) return;
    logged.current.add(shownKey);
    void logShownAction(sectionId, shown.map(r => ({ cardId: r.card.id, position: r.position, score: r.score }))).catch(() => null);
  }, [shownKey, sectionId, shown]);

  const kinds = [...new Map(ranked.map(r => [r.card.kind, (r.card as WsCard).kindLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <aside className={`ws-panel${open ? " ws-panel-open" : ""}`} aria-label="Story Cards">
      <div className="ws-panel-head">
        <strong>Story Cards</strong>
        <span className="ov-muted">{ranked.length} available, best first</span>
        <button type="button" className="bn-x ws-panel-close" onClick={onClose} aria-label="Close Story Cards">×</button>
      </div>
      <div className="ws-filters">
        <select className="cl-select" value={kind} onChange={e => { setKind(e.target.value); setLimit(PANEL_SIZE); }} aria-label="Kind">
          <option value="">All kinds</option>
          {wantedKinds.length > 0 && <option value="__wanted">This question&rsquo;s kinds</option>}
          {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {["I", "II", "III"].map(l => (
          <button key={l} type="button" className={`chip${layer === l ? " active" : ""}`} title={LAYER_NAME[l]}
            onClick={() => { setLayer(v => (v === l ? "" : l)); setLimit(PANEL_SIZE); }}>{l}</button>
        ))}
        <input className="cl-search ws-search" placeholder="Search cards and quotes" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {shown.length === 0 && <p className="cl-note">{ranked.length ? "Nothing matches these filters." : "No cards left to place. Build the Card Library, or remove a card from the answer to bring it back."}</p>}
      <div className="ws-cards">
        {shown.map(r => (
          <PanelCard key={r.card.id} r={r} used={(usedWhere.get(r.card.id) ?? []).filter(n => n !== current)} locked={locked} onAdd={onAdd} />
        ))}
      </div>
      {list.length > shown.length && (
        <button type="button" className="btn ghost ws-more" onClick={() => setLimit(n => n + PANEL_SIZE)}>
          Show more ({list.length - shown.length} left)
        </button>
      )}
    </aside>
  );
}

function PanelCard({ r, used, locked, onAdd }: { r: Ranked; used: number[]; locked: boolean; onAdd: (id: string) => void }) {
  const c = r.card as WsCard;
  const [open, setOpen] = useState(false);
  const ok = placeable(c);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `card:${c.id}`, data: { type: "card", cardId: c.id }, disabled: !ok,
  });
  return (
    <div ref={setNodeRef} className={`ws-card ${layerClass(c.layer)}${c.strength === "thin" ? " cl-thin" : ""}${isDragging ? " ws-ghost" : ""}`}>
      <div className="cl-card-head">
        <span className="ws-handle" {...listeners} {...attributes} aria-label={`Drag: ${c.statement.slice(0, 60)}`} title="Drag into the answer">⠿</span>
        <span className="cl-kind">{c.kindLabel}</span>
        {c.layer && <span className="cl-layer">{LAYER_NAME[c.layer]}</span>}
        <span className="cl-spacer" />
        {c.status === "verified" ? <span className="cl-badge cl-badge-ok">Verified</span> : <span className="cl-badge">Suggested</span>}
      </div>
      <p className="cl-statement">{c.statement}</p>
      <div className="ws-reason">{reasonFor(r, c.kindLabel, c.newestSource)}</div>
      {!ok && (
        <div className="ws-warn ws-soft">Sensitive: {c.sensitiveReason ?? "it may identify a person's protected information."} Record consent,
          de-identify it, or rule it not sensitive in the <a href="/admin/card-library">Card Library</a> before placing it.</div>
      )}
      <div className="cl-card-acts">
        <button type="button" className="btn inline cl-primary" disabled={locked || !ok} onClick={() => onAdd(c.id)}
          title={ok ? undefined : "Sensitive: decide it in the Card Library first"}>Add</button>
        {used.length > 0 && <span className="ov-tag" title="Already used in another answer of this application">In Q{used.join(", Q")}</span>}
        <button type="button" className="cl-link" onClick={() => setOpen(o => !o)}>{open ? "Hide" : "Sources"} ({c.evidence.length})</button>
      </div>
      {open && <Evidence card={c} />}
    </div>
  );
}

function Evidence({ card }: { card: WsCard }) {
  return (
    <ul className="cl-evidence">
      {card.evidence.length === 0 && <li className="cl-note">No live source: its document is gone or changed.</li>}
      {card.evidence.map((e, i) => (
        <li key={i}>
          <div className="cl-quote">{`“${e.quote}”`}</div>
          <div className="cl-src">{e.title}{e.layer ? ` · ${LAYER_NAME[e.layer] ?? e.layer}` : ""}{e.speaker ? ` · ${e.speaker}` : ""}</div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The answer.
// ---------------------------------------------------------------------------

function AnswerColumn({ blocks, cardById, locked, editing, setEditing, onMove, onRemove, onEdit, onBreak, onRefresh, empty }: {
  blocks: WsBlock[]; cardById: Map<string, WsCard>; locked: boolean;
  editing: string | null; setEditing: (id: string | null) => void;
  onMove: (from: number, to: number) => void; onRemove: (id: string) => void;
  onEdit: (id: string, text: string) => Promise<unknown>; onBreak: (id: string, v: boolean) => Promise<unknown>;
  onRefresh: (id: string) => Promise<unknown>; empty: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "answer" });
  return (
    <div ref={setNodeRef} className={`ws-answer${isOver ? " ws-over" : ""}`} aria-label="The answer">
      {blocks.length === 0 ? empty : (
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((b, i) => (
            <BlockRow key={b.id} block={b} index={i} last={i === blocks.length - 1}
              card={b.cardId ? cardById.get(b.cardId) : undefined} locked={locked}
              editing={editing === b.id} setEditing={setEditing}
              onMove={onMove} onRemove={onRemove} onEdit={onEdit} onBreak={onBreak} onRefresh={onRefresh} />
          ))}
        </SortableContext>
      )}
      <div className="ws-dropzone">{blocks.length ? "Drop a card here to add it at the end" : null}</div>
    </div>
  );
}

function EmptyAnswer({ std, onStart }: { std?: WsStandard; onStart: () => void }) {
  return (
    <div className="ws-empty-answer">
      <p>Drag cards here, or press <strong>Add</strong> on a card. Cards go in the order you place them, and you can move them afterwards.
        Or press <strong>Arrange for me</strong> below to place the best cards for this question.</p>
      {std && (
        <div className="ws-std">
          <strong>This client has an approved standard answer to this question.</strong>
          <p className="ws-std-text">{std.text.slice(0, 320)}{std.text.length > 320 ? "…" : ""}</p>
          <button type="button" className="btn secondary" onClick={onStart}>Start from the standard answer</button>
          <span className="ov-muted"> Copies its cards and text here, to rearrange for this funder.</span>
        </div>
      )}
    </div>
  );
}

function BlockRow({ block: b, index, last, card, locked, editing, setEditing, onMove, onRemove, onEdit, onBreak, onRefresh }: {
  block: WsBlock; index: number; last: boolean; card?: WsCard; locked: boolean;
  editing: boolean; setEditing: (id: string | null) => void;
  onMove: (from: number, to: number) => void; onRemove: (id: string) => void;
  onEdit: (id: string, text: string) => Promise<unknown>; onBreak: (id: string, v: boolean) => Promise<unknown>;
  onRefresh: (id: string) => Promise<unknown>;
}) {
  const temp = b.id.startsWith("tmp-");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: b.id, disabled: temp || locked });
  const [text, setText] = useState(b.text);
  const [showSrc, setShowSrc] = useState(false);
  // The latest typed text and whether it was cancelled, read by blur as well as
  // the buttons, so a blur fired while the editor closes never saves stale text.
  const live = useRef({ text: b.text, cancelled: false });
  const startEdit = () => {
    if (temp) return;
    setText(b.text); live.current = { text: b.text, cancelled: false };
    setEditing(b.id);
  };

  const isCard = b.kind === "card";
  const quotes = card ? card.evidence.map(e => e.quote).join("\n") : "";
  const untraced = isCard && b.edited ? untracedFigures(b.text, quotes) : [];
  const reworded = isCard && !b.edited && card && b.cardVersion != null && b.cardVersion < card.version;
  const save = async () => {
    if (live.current.cancelled) return;
    live.current.cancelled = true;
    setEditing(null);
    if (live.current.text !== b.text) await onEdit(b.id, live.current.text);
  };
  const cancel = () => { live.current.cancelled = true; setText(b.text); setEditing(null); };

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`ws-block ws-${b.kind} ${isCard ? layerClass(card?.layer ?? null) : ""}${isDragging ? " ws-ghost" : ""}${b.breakBefore && index > 0 ? " ws-para" : ""}`}>
      <div className="ws-block-head">
        <span className="ws-handle" {...listeners} {...attributes} aria-label="Drag to reorder" title="Drag to reorder">⠿</span>
        <span className="cl-kind">{isCard ? card?.kindLabel ?? "Story Card" : b.kind === "human" ? "Your words" : "Bridge"}</span>
        {isCard && b.edited && <span className="ov-tag" title="Changed in this draft only. The library card is unchanged.">Edited here</span>}
        {isCard && card?.status === "suggested" && <span className="ov-tag" title="Not yet verified in the Card Library">Unverified card</span>}
        {isCard && card && !placeable(card) && <span className="ov-tag ws-tag-sens" title={card.sensitiveReason ?? ""}>Sensitive, undecided</span>}
        <span className="cl-spacer" />
        {index > 0 && (
          <label className="ws-break" title="Start a new paragraph with this block">
            <input type="checkbox" checked={b.breakBefore} disabled={temp || locked} onChange={e => void onBreak(b.id, e.target.checked)} /> ¶
          </label>
        )}
        <button type="button" className="btn ghost ap-mini" disabled={temp || locked || index === 0} onClick={() => onMove(index, index - 1)} aria-label="Move up">↑</button>
        <button type="button" className="btn ghost ap-mini" disabled={temp || locked || last} onClick={() => onMove(index, index + 1)} aria-label="Move down">↓</button>
        <button type="button" className="btn ghost ap-mini ap-del" disabled={temp || locked} onClick={() => onRemove(b.id)}>Remove</button>
      </div>

      {editing ? (
        <div className="cl-edit">
          <textarea rows={Math.max(3, Math.ceil(text.length / 80))} value={text} autoFocus
            onChange={e => { setText(e.target.value); live.current.text = e.target.value; }}
            onKeyDown={e => { if (e.key === "Escape") cancel(); }}
            onBlur={() => void save()} />
          <div className="cl-card-acts">
            <button type="button" className="btn inline cl-primary" onMouseDown={e => e.preventDefault()} onClick={() => void save()}>Save</button>
            <button type="button" className="btn ghost" onMouseDown={e => e.preventDefault()} onClick={cancel}>Cancel</button>
            {isCard && <span className="ov-muted">Changes this draft only. The library card stays as it is.</span>}
          </div>
        </div>
      ) : (
        <p className={`ws-text${!b.text ? " ws-placeholder" : ""}`} role="button" tabIndex={0}
          onClick={startEdit} onKeyDown={e => { if (e.key === "Enter") startEdit(); }}>
          {b.text || "Click to write…"}
        </p>
      )}

      {untraced.length > 0 && (
        <div className="ws-warn">{untraced.join(", ")} {untraced.length === 1 ? "is" : "are"} not in this card&rsquo;s sources. The figure audit in Polish will stop the export until it is traced or removed.</div>
      )}
      {reworded && (
        <div className="ws-warn ws-soft">
          This card was reworded in the library since you placed it.{" "}
          <button type="button" className="cl-link" onClick={() => void onRefresh(b.id)}>Use the new wording</button>
        </div>
      )}
      {isCard && b.edited && !editing && (
        <button type="button" className="cl-link ws-revert" onClick={() => void onRefresh(b.id)}
          title="Drop the edit and use the card's current wording from the library">Use the card&rsquo;s wording</button>
      )}
      {isCard && card && (
        <>
          <button type="button" className="cl-link" onClick={() => setShowSrc(v => !v)}>{showSrc ? "Hide sources" : `Sources (${card.evidence.length})`}</button>
          {showSrc && <Evidence card={card} />}
        </>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn secondary" disabled={!text} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); }
      catch { prompt("Copy the answer:", text); }
    }}>{done ? "Copied" : "Copy answer"}</button>
  );
}

// ---------------------------------------------------------------------------
// Show seams: where each part of the answer came from.
// ---------------------------------------------------------------------------

/**
 * The answer as one text, each part marked by its origin. Honest about
 * authorship: a card's wording is the reader's phrasing of a quote from the
 * client's documents, not the client's own sentence; an edited card is a writer
 * changing that phrasing; "your words" are a writer's own. Bridges (Weave) will
 * be the fourth kind.
 */
function SeamsView({ blocks }: { blocks: WsBlock[] }) {
  const cls = (b: WsBlock) => b.kind === "human" ? "seam-human" : b.kind === "bridge" ? "seam-bridge" : b.edited ? "seam-edited" : "seam-card";
  return (
    <div className="ws-seams" aria-label="The answer, marked by source">
      <div className="ws-seams-key">
        <span className="seam-card">From a Story Card (phrased from a quote)</span>
        <span className="seam-edited">Story Card, edited by the writer</span>
        <span className="seam-human">Written by the writer</span>
      </div>
      <p>
        {blocks.filter(b => b.text.trim()).map((b, i) => (
          <span key={b.id}>
            {i > 0 && (b.breakBefore ? <><br /><br /></> : " ")}
            <span className={cls(b)}>{b.kind === "human" ? b.text.trim() : b.text.replace(/\s+/g, " ").trim()}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
