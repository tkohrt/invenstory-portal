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
// Weave (Phase 4) shows the same answer as prose: cards as highlighted text,
// bridges proposed between them to accept, edit or reject (components/WeaveView.tsx).
// An answer is woven only once every card in it would pass the finish line, and
// a reminder about the AI allowance comes first (components/WeaveReminder.tsx).
// Opening the Weave tab costs nothing; Begin Weaving, inside it, is what weaves.
// Polish (fit to limit, figure audit) is next; its tab is shown, disabled.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDraggable, useDroppable,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addCardBlockAction, addHumanBlockAction, approveStandardAnswerAction, editBlockAction,
  fillFromStandardsAction, logShownAction, openStandardAnswersAction,
  acceptSuggestionAction, keepWordingAction, refreshBlockWordingAction, rejectSuggestionAction, removeBlockAction, reorderBlocksAction, setBreakAction, setSectionDoneAction,
  startFromStandardAction, tidyAction,
  acceptBridgesAction, weaveSectionAction, convertToCardAction, saveWordingToLibraryAction, restoreAnswerAction,
} from "@/lib/server/workspace-actions";
import { askClientAction, withdrawAskAction } from "@/lib/server/ask-actions";
import GapPanel, { AskDialog, ProgressStrip } from "./GapPanel";
import { pushUndo, undoState, type UndoBlock } from "@/lib/draft-undo";
import { draftProgress, questionGaps, type GapAsk, type GapRow } from "@/lib/draft-gaps";
import UserCardDialog from "./UserCardDialog";
import { USER_GENERATED } from "@/lib/user-card";
import WeaveView from "./WeaveView";
import WeaveReminder from "./WeaveReminder";
import PolishPanel, { type PolishRun } from "./PolishPanel";
import { clearFigureAction, polishSectionAction, restoreFigureAction } from "@/lib/server/polish-actions";
import { dropOptions, figureAudit, openFlags, repeats, describeFigureFlags, type FigureFlag, type ShortenProposal } from "@/lib/polish";
import InfoTip from "./InfoTip";
import MenuButton, { MenuItem, DOTS } from "./MenuButton";
import { bridgeGaps } from "@/lib/weave";
import { setUiPrefAction } from "@/lib/server/account-actions";
import {
  autosaveVersionAction, compareVersionAction, enterStageAction, saveBeforeWeaveAction, saveBeforePolishAction, listVersionsAction, newDraftFromAction, restoreVersionAction,
  saveVersionAction, setDraftStatusAction, type VersionItem,
} from "@/lib/server/version-actions";
import { LOCKED_STATUSES, STATUS_NAME, type DraftStatus, type SectionDiff } from "@/lib/draft-version";
import { reopenSectionsAction } from "@/lib/server/application-actions";
import { PANEL_SIZE, rankCards, reasonFor, recommendSection, type Ranked } from "@/lib/story-card-rank";
import { placeable } from "@/lib/card-sensitivity";
import { describeBlockers, finishBlockers, ISSUE_LABEL, placeIssue, type Blocker, type GateCard } from "@/lib/card-gate";
import { getReviewCardAction } from "@/lib/server/card-actions";
import type { LibraryCard } from "@/lib/server/card-library";
import CardReview, { type ReviewOutcome } from "./CardReview";
import { assembleAnswer, countFor, limitState, moveItem } from "@/lib/section-answer";
import { untracedFigures } from "@/lib/story-card";
import { CLEAR_REASON_MAX } from "@/lib/polish";
import type { Workspace, WsBlock, WsCard, WsClearance, WsSection, WsStandard } from "@/lib/server/workspace";
import type { GrantDraft } from "@/lib/types";
import GrantContextBox from "./GrantContextBox";
import type { ContextItem } from "@/lib/server/draft-context";
import AutoDraftDialog from "./AutoDraftDialog";
import { autodraftQuestionAction } from "@/lib/server/autodraft-actions";
import { stageBlocks } from "@/lib/autodraft";
import AdaptBanner from "./AdaptBanner";
import SuggestedWording from "./SuggestedWording";
import { keepAdaptationAction, revertAdaptationAction, updateStandardFromAdaptationAction } from "@/lib/server/sa-adapt-actions";
import { adaptationOpen } from "@/lib/sa-adapt";
import { pendingSuggestion } from "@/lib/suggest-wording";

const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };
type Stage = "arrange" | "weave" | "polish";
const STATUS_LABEL: Record<WsSection["status"], string> = { empty: "Not started", drafting: "Drafting", done: "Done" };
const SOURCE_LABEL: Record<string, string> = { paste: "pasted text", pdf: "a PDF", docx: "a Word file", url: "a web page", match: "Funder Matches" };
/** Subscribers to the Standard Answers note's dismissal (a tiny store for useSyncExternalStore). */
const saNoteListeners = new Set<() => void>();
const subscribeSaNote = (fn: () => void) => { saNoteListeners.add(fn); return () => { saNoteListeners.delete(fn); }; };
const notifySaNote = () => { for (const fn of saNoteListeners) fn(); };

/** The mark on every button that uses AI (Storyboard cleanup, 17 October 2026): purple, outlined, never filled. */
const SPARK = (
  <svg className="sb-spark" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </svg>
);

const layerClass = (l: string | null) => (l === "I" ? "l1" : l === "II" ? "l2" : l === "III" ? "l3" : "");

export default function DraftWorkspace({ tenantName, draft, ws, sourceText, initialQuestion, since, confirmRemove = true, context = { ready: false, items: [] } }: {
  tenantName: string; draft: GrantDraft; ws: Workspace; sourceText: string; initialQuestion: number;
  /** The grant context box (Auto-Draft patch 5), opened from the top bar. */
  context?: { ready: boolean; items: ContextItem[] };
  /** Standard Answers: when it was last opened, to mark questions added since. */
  since?: string | null;
  /** Ask before removing a plain card (the person's "Don't ask me again" setting). */
  confirmRemove?: boolean;
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
  const [draggingNew, setDraggingNew] = useState(false);
  const [seams, setSeams] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  // Storyboard cleanup (17 October 2026): the funder's application opens in a
  // window from the ⋯ menu; the keyboard shortcuts open inside More.
  const [sourceOpen, setSourceOpen] = useState(false);
  useEffect(() => {
    if (!sourceOpen && !contextOpen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setSourceOpen(false); setContextOpen(false); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [sourceOpen, contextOpen]);
  const [keysOpen, setKeysOpen] = useState(false);
  // The Standard Answers note shows until dismissed, once per draft, per browser.
  // Hidden until read, so it never flashes in and out on load.
  // Read through useSyncExternalStore, like the sidebar's nav-collapsed: false on
  // the server and while hydrating, the browser's answer after that.
  const saKey = `ws-sa-note:${draft.id}`;
  const saNote = useSyncExternalStore(subscribeSaNote,
    () => { try { return localStorage.getItem(saKey) !== "dismissed"; } catch { return true; } },
    () => false);
  const dismissSaNote = () => {
    try { localStorage.setItem(saKey, "dismissed"); } catch { /* this browser keeps nothing: it shows again next time */ }
    notifySaNote();
  };
  // Auto-draft (Auto-Draft patch 6): the confirm window, and a whole-draft run in progress.
  const [autoAsk, setAutoAsk] = useState<{ scope: "draft" | "question" } | null>(null);
  const [autoRun, setAutoRun] = useState<{ jobId: string; done: number; total: number } | null>(null);
  const [autoDraftedHere, setAutoDraftedHere] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Reviewing cards before they are used (decided 2 October 2026). `place` puts
  // each card into the answer once verified; `review` only verifies.
  const [review, setReview] = useState<{ mode: "place" | "review"; queue: { cardId: string; position: number | null }[]; note?: string } | null>(null);
  // Statuses changed in this page since it loaded, until the refresh catches up.
  const [statusNow, setStatusNow] = useState<Record<string, "verified" | "retired">>({});
  // The finish line: what stands in the way, and what to do once it is clear.
  const [blockers, setBlockers] = useState<{ scope: "draft" | "section"; then: "completed" | "submit" | "approve" | "weave" | null } | null>(null);
  // Weave: which stage the page shows, and the reminder before a weave runs.
  const [stage, setStage] = useState<Stage>(draft.stage === "weave" || draft.stage === "polish" ? draft.stage : "arrange");
  // Polish (9 October 2026): nothing runs until Begin Polishing. What it found,
  // per question; the numbers people cleared; and the reminder before it drafts
  // shorter wording; and the finish line stopped by a number with no source.
  const [polishRuns, setPolishRuns] = useState<Record<string, PolishRun>>({});
  const [clearances, setClearances] = useState<WsClearance[]>(ws.clearances);
  const [polishAsk, setPolishAsk] = useState<{ again: boolean } | null>(null);
  // Auto-Draft patch 7: the finish line stops on an adapted Standard Answer nobody has chosen on.
  const [adaptBlock, setAdaptBlock] = useState<{ scope: "draft" | "section" } | null>(null);
  const [suggBlock, setSuggBlock] = useState<{ scope: "draft" | "section" } | null>(null);
  const [figBlock, setFigBlock] = useState<{ scope: "draft" | "section"; then: "completed" | "submit" | "approve" | null } | null>(null);
  const [weaveAsk, setWeaveAsk] = useState<{ again: boolean } | null>(null);
  // Answers woven on this page that came back with no bridges: no "not woven yet" invitation for them.
  const [wovenHere, setWovenHere] = useState<Set<string>>(() => new Set());
  // Text a writer adds where they click, or by dragging "New text" in: once
  // written, the page asks whether it is their own words or a new Story Card.
  const fresh = useRef(new Set<string>());
  const [choice, setChoice] = useState<{ blockId: string; text: string } | null>(null);
  const [userCard, setUserCard] = useState<{ blockId: string; text: string; kind?: string | null } | null>(null);
  const [weaveEditId, setWeaveEditId] = useState<string | null>(null);
  // Removing a block: which is being dragged, where a card would land, the
  // question being asked, and the Undo on offer.
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [askRemove, setAskRemove] = useState(confirmRemove);
  const [confirming, setConfirming] = useState<{ block: WsBlock; via: "button" | "drag" } | null>(null);
  // Undo for everything (9 October 2026): each change first remembers the
  // answer as it stood, per question, newest last (lib/draft-undo.ts). The
  // toast after a removal offers the same Undo for a few seconds.
  const [history, setHistory] = useState<Record<string, { label: string; state: UndoBlock[] }[]>>({});
  const [undo, setUndo] = useState<{ label: string } | null>(null);
  // Questions asked of the client (0058), what the gap panel's Ask is writing,
  // and the kind its Add it now is for.
  const [asks, setAsks] = useState<GapAsk[]>(ws.asks);
  const [asking, setAsking] = useState<string | null>(null);
  const freshKind = useRef(new Map<string, string>());
  const [panelAsk, setPanelAsk] = useState<{ kind: string; n: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
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
      const main = document.querySelector<HTMLElement>(".main");
      const top = el.getBoundingClientRect().top + (main?.scrollTop ?? 0);
      // Leave exactly the page's own bottom padding, so nothing is left to scroll.
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 16;
      setSplitHeight(Math.max(320, window.innerHeight - top - pad));
    };
    fit();
    window.addEventListener("resize", fit);
    // Refit when anything above the split changes height: a build notice
    // appearing, the locked banner, the sidebar folding.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fit());
    const main = document.querySelector(".main");
    if (ro && main) for (const el of Array.from(main.children)) ro.observe(el);
    return () => { window.removeEventListener("resize", fit); ro?.disconnect(); };
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

  // Every ten minutes of editing, a checkpoint, if anything changed since the
  // last one. The server skips it when the answers are as the last version had them.
  // A submitted application is the copy the funder received: read-only.
  const readOnly = LOCKED_STATUSES.has((draft.status ?? "drafting") as DraftStatus);
  const lastAutosave = useRef<number>(Date.now());
  useEffect(() => {
    if (readOnly) return;
    const t = setInterval(() => {
      if (savedAt && savedAt > lastAutosave.current) {
        lastAutosave.current = Date.now();
        void autosaveVersionAction(draft.id).catch(() => null);
      }
    }, 10 * 60_000);
    return () => clearInterval(t);
  }, [savedAt, readOnly, draft.id]);

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
    setAsks(ws.asks);
    setClearances(ws.clearances);
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

  // Suggested wording's actions return their reason when refused (production hides thrown messages).
  const suggestOk = (r: { ok: true; blocks: WsBlock[] } | { ok: false; error: string }) => {
    if (!r.ok) throw new Error(r.error);
    return r.blocks;
  };

  const putBlocks = useCallback((sectionId: string) => (next: WsBlock[]) => {
    setBlocksBy(m => ({ ...m, [sectionId]: next }));
    setStatusBy(m => {
      const cur = m[sectionId];
      const st = next.length === 0 ? "empty" : cur === "empty" ? "drafting" : cur;
      return cur === st ? m : { ...m, [sectionId]: st };
    });
  }, []);

  /** Before a change: remember the answer as it stands, so Undo can put it back. */
  const remember = useCallback((sectionId: string, label: string) => {
    const state = undoState(blocksBy[sectionId] ?? []);
    setHistory(h => ({ ...h, [sectionId]: pushUndo(h[sectionId] ?? [], { label, state }) }));
  }, [blocksBy]);

  /** A change to one answer: remembered for Undo, then saved through the queue. */
  const change = <T,>(sectionId: string, label: string, work: () => Promise<T>, apply: (r: T) => void) => {
    remember(sectionId, label);
    return run(work, apply);
  };

  // ---- Auto-draft (Auto-Draft patch 6) ---------------------------------------
  // A whole-draft run is carried by the server; the page follows it, and picks
  // it up again if the page was closed and reopened while it ran.
  useEffect(() => {
    if (readOnly) return;
    let live = true;
    fetch("/api/jobs/active", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(b => {
      const a = b?.autodraft?.running as { jobId: string; draftId: string; done: number; total: number } | undefined;
      if (live && a && a.draftId === draft.id) setAutoRun({ jobId: a.jobId, done: a.done, total: a.total });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [draft.id, readOnly]);
  // Follows the run by its id, so the timer is set once per run, not on every tick.
  const autoJobId = autoRun?.jobId ?? null;
  const autoDoneRef = useRef(0);
  autoDoneRef.current = autoRun?.done ?? 0;
  useEffect(() => {
    if (!autoJobId) return;
    let live = true;
    // What the page already shows; a question finished since is refreshed in on the first tick.
    let seenDone = autoDoneRef.current;
    const timer = setInterval(async () => {
      try {
        // after=1e12: the job row only, not its whole log.
        const res = await fetch(`/api/jobs/${autoJobId}?after=1000000000000`, { cache: "no-store" });
        if (!res.ok) return;
        const { job } = await res.json() as { job: { status: string; done: number; total: number; detail: string | null; error: string | null } };
        if (!live) return;
        if (job.status === "running") {
          if (job.done !== seenDone) {
            // Each finished question shows as it lands.
            router.refresh();
            seenDone = job.done;
            setAutoRun(a => a && a.jobId === autoJobId ? { ...a, done: job.done, total: job.total } : a);
          }
          return;
        }
        setAutoRun(null); setAutoDraftedHere(true);
        router.refresh();
        if (job.status === "done") say(job.detail ?? "Auto-draft finished."); else setError(job.error ?? "Auto-draft stopped. Everything placed so far is kept.");
      } catch { /* the next tick tries again */ }
    }, 4000);
    return () => { live = false; clearInterval(timer); };
  }, [autoJobId, router, say]);

  const startAutoDraft = async () => {
    setAutoAsk(null); setError(null);
    try {
      const res = await fetch("/api/jobs/autodraft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draft.id }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok || !r.jobId) { setError(r.error ?? "Auto-draft could not start. Nothing was changed."); return; }
      setAutoRun({ jobId: r.jobId, done: r.done ?? 0, total: r.total ?? 0 });
      say("Auto-draft started. A version named \u201cBefore auto-draft\u201d was saved first. Questions fill in as it goes; the page can be closed.");
    } catch { setError("Could not reach the portal. Check the connection and try again."); }
  };
  const stopAutoDraft = async () => {
    await fetch("/api/jobs/autodraft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draft.id, stop: true }) }).catch(() => null);
  };
  const autoDraftQuestion = (sectionId: string) => {
    setAutoAsk(null);
    // Remembered for Undo only once something was placed, so a refusal leaves no empty step.
    const before = undoState(blocksBy[sectionId] ?? []);
    void run(() => autodraftQuestionAction(draft.id, sectionId), r => {
      if (!r.ok) { setError(r.error); return; }
      setHistory(h => ({ ...h, [sectionId]: pushUndo(h[sectionId] ?? [], { label: "the auto-draft", state: before }) }));
      putBlocks(sectionId)(r.blocks);
      setAutoDraftedHere(true);
      const o = r.outcome;
      say(o.placed
        ? `Auto-drafted: ${o.placed} ${o.start === "standard_answer" ? "piece" : "card"}${o.placed === 1 ? "" : "s"} placed${o.start === "standard_answer" ? ` from the approved Standard Answer${o.adapted ? ", adapted for this funder (see the note under the question)" : ""}` : ""}.${o.suggested ? ` New wording suggested for ${o.suggested} card${o.suggested === 1 ? "" : "s"}: accept, edit or reject each.` : ""}${o.gaps ? ` ${o.gaps} kind${o.gaps === 1 ? "" : "s"} of card asked for still missing: see Calls for.` : ""}${o.fallback ? " The model's reply could not be used, so the code's own pick was placed." : ""} Undo puts the answer back.`
        : "Auto-draft found nothing more to add to this answer from the Story Cards.");
      router.refresh();
    });
  };

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
  const noSensors = useSensors();
  // While a whole-draft auto-draft run is filling this draft, editing waits for it.
  const locked = pending > 0 || readOnly || !!autoRun;

  /** The card as the gate sees it now, including what was decided on this page since it loaded. */
  const gateCard = useCallback((id: string): GateCard | null => {
    const c = cardById.get(id);
    const now = statusNow[id];
    if (!c) return null;
    return now ? { ...c, status: now } : c;
  }, [cardById, statusNow]);

  const placeNow = useCallback((cardId: string, position: number) => {
    if (!section) return Promise.resolve();
    const r = ranked.find(x => x.card.id === cardId);
    const temp: WsBlock = {
      id: `tmp-${cardId}`, sectionId: section.id, kind: "card", cardId, cardVersion: cardById.get(cardId)?.version ?? 1,
      text: cardById.get(cardId)?.statement ?? "", ownText: null, edited: false, breakBefore: false, proposed: false, suggested: null,
    };
    remember(section.id, "adding a card");
    setBlocksBy(m => {
      const list = [...(m[section.id] ?? [])];
      list.splice(Math.min(position, list.length), 0, temp);
      return { ...m, [section.id]: list };
    });
    return run(() => addCardBlockAction(section.id, cardId, position, r ? { position: r.position, score: r.score } : null),
      putBlocks(section.id));
  }, [section, ranked, cardById, run, putBlocks, remember]);

  /**
   * Put a card into the answer, or, when it has not been verified yet, open its
   * review where it was dropped: verifying it (or editing it) places it there.
   */
  const addCard = useCallback((cardId: string, position: number) => {
    if (!section) return;
    const issue = placeIssue(gateCard(cardId));
    if (issue === "unverified") { setReview({ mode: "place", queue: [{ cardId, position }] }); return; }
    if (issue) { setError(`That card is ${ISSUE_LABEL[issue]}, so it cannot go into an answer.`); return; }
    void placeNow(cardId, position);
  }, [section, gateCard, placeNow]);

  /** What the reviewer did to the card at the front of the queue. */
  const onReviewed = useCallback((what: ReviewOutcome) => {
    if (!review || !section) return;
    const [head, ...rest] = review.queue;
    if (!head) return;
    if (what === "verified" || what === "retired" || what === "merged") {
      setStatusNow(m => ({ ...m, [head.cardId]: what === "verified" ? "verified" : "retired" }));
      const placed = what === "verified" && review.mode === "place"
        ? placeNow(head.cardId, head.position ?? (blocksBy[section.id] ?? []).length)
        : Promise.resolve();
      if (what !== "verified") say("Card taken out of use. It will not be offered again unless it is reinstated in the Card Library.");
      if (rest.length) setReview({ ...review, queue: rest });
      else { setReview(null); void placed.then(() => router.refresh()); }
    }
  }, [review, section, placeNow, blocksBy, say, router]);

  const reorder = useCallback((order: string[], via: "drag" | "buttons" | "tidy") => {
    if (!section) return;
    const byId = new Map(blocks.map(b => [b.id, b]));
    remember(section.id, via === "tidy" ? "Tidy's order" : "the move");
    setBlocksBy(m => ({ ...m, [section.id]: order.map(id => byId.get(id)!).filter(Boolean) }));
    void run(() => reorderBlocksAction(section.id, order, via), putBlocks(section.id));
  }, [section, blocks, run, putBlocks, remember]);

  /**
   * Where a drop lands. Over the Story Cards panel means "remove" (for a placed
   * block) or "nowhere" (for a card from the panel). Inside the answer, the
   * nearest block. Anywhere else, nothing: the drag is cancelled and the card
   * snaps back, so a slipped release never deletes or moves anything.
   */
  const collision: CollisionDetection = useCallback(args => {
    const within = pointerWithin(args);
    const panel = within.find(c => c.id === "panel");
    if (panel) return [panel];
    if (!within.length) return [];
    const inAnswer = args.droppableContainers.filter(c => c.id !== "panel");
    return closestCenter({ ...args, droppableContainers: inAnswer });
  }, []);

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as { type?: string; cardId?: string } | undefined;
    setDraggingNew(d?.type === "newtext");
    setDragging(d?.type === "card" && d.cardId ? cardById.get(d.cardId) ?? null : null);
    setActiveBlock(d?.type === "card" || d?.type === "newtext" ? null : String(e.active.id));
  };
  const onDragOver = (e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null);
  const endDrag = () => { setDraggingNew(false); setDragging(null); setActiveBlock(null); setOverId(null); };

  // ---- Removing, with a question when it matters and Undo always ------------
  const doRemove = useCallback((b: WsBlock, via: "button" | "drag") => {
    if (!section) return;
    const sectionId = section.id;
    remember(sectionId, b.kind === "card" ? "removing the card" : b.kind === "bridge" ? (b.proposed ? "rejecting the bridge" : "removing the bridge") : "removing your text");
    setBlocksBy(m => ({ ...m, [sectionId]: (m[sectionId] ?? []).filter(x => x.id !== b.id) }));
    void run(() => removeBlockAction(sectionId, b.id, via), next => {
      putBlocks(sectionId)(next);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({ label: b.kind === "card" ? "Card removed. It is back among your Story Cards."
        : b.kind === "bridge" ? (b.proposed ? "Bridge rejected." : "Bridge removed.") : "Text removed." });
      undoTimer.current = setTimeout(() => setUndo(null), 8_000);
    });
  }, [section, run, putBlocks, remember]);

  /** Edited cards and your own writing always ask; a plain card asks until "Don't ask me again". */
  const requestRemove = useCallback((b: WsBlock, via: "button" | "drag") => {
    // A bridge Weave wrote is rejected at once (Undo brings it back); one a writer edited asks first.
    const mustAsk = b.kind === "card" ? b.edited || askRemove : b.kind === "bridge" ? b.edited : !!b.text.trim();
    if (mustAsk) setConfirming({ block: b, via }); else doRemove(b, via);
  }, [askRemove, doRemove]);

  /** Add an empty text block at `position` and open it for writing. */
  const insertAt = (position: number, kind?: string) => {
    if (!section || readOnly) return;
    const sectionId = section.id;
    const before = new Set((blocksBy[sectionId] ?? []).map(b => b.id));
    remember(sectionId, "adding text");
    if (stage === "arrange") setEditing("__new");
    void run(() => addHumanBlockAction(sectionId, position), next => {
      putBlocks(sectionId)(next);
      const added = next.find(b => b.kind === "human" && !before.has(b.id));
      if (!added) return;
      fresh.current.add(added.id);
      if (kind) freshKind.current.set(added.id, kind);
      if (stage !== "arrange") setWeaveEditId(added.id); else setEditing(added.id);
    });
  };

  /** Save a block's words; text just added asks, once written, what it is. */
  const editBlock = (id: string, t: string) => {
    if (!section) return Promise.resolve();
    const sectionId = section.id;
    // Text just added was remembered when it was added: Undo takes it out whole.
    if (!fresh.current.has(id)) remember(sectionId, "the edit");
    return run(() => editBlockAction(sectionId, id, t), next => {
      putBlocks(sectionId)(next);
      if (fresh.current.has(id) && t.trim()) {
        fresh.current.delete(id);
        // Add it now, from the gap panel: straight to the card, its kind chosen.
        const kind = freshKind.current.get(id);
        freshKind.current.delete(id);
        if (kind) setUserCard({ blockId: id, text: t.trim(), kind });
        else setChoice({ blockId: id, text: t.trim() });
      }
    });
  };

  /** Put a library card where the writer's text was: a new user-generated card, or one already there. */
  const placeUserCard = (blockId: string, cardId: string, saved: boolean) => {
    if (!section) return;
    const sectionId = section.id;
    setUserCard(null);
    remember(sectionId, "turning your text into a card (the card stays in the Story Cards)");
    void run(() => convertToCardAction(sectionId, blockId, cardId), next => {
      putBlocks(sectionId)(next);
      say(saved
        ? `Saved to Story Cards with a ${USER_GENERATED} label, and filed in the Inven(s)tory as a Writer's note. It is in this answer now, and ready for any other.`
        : "Used the card already in the library in place of your text.");
      router.refresh();
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    const blockDrag = activeBlock;
    endDrag();
    if (!over || !section) return;
    const d = active.data.current as { type?: string; cardId?: string } | undefined;
    if (over.id === "panel") {
      if (blockDrag) { const b = blocks.find(x => x.id === blockDrag); if (b) requestRemove(b, "drag"); }
      return;
    }
    const overIdx = blocks.findIndex(b => b.id === over.id);
    if (d?.type === "newtext") {
      if (overIdx < 0 && over.id !== "answer") return;
      insertAt(overIdx >= 0 ? overIdx : blocks.length);
      return;
    }
    if (d?.type === "card" && d.cardId) {
      if (overIdx < 0 && over.id !== "answer") return;
      addCard(d.cardId, overIdx >= 0 ? overIdx : blocks.length);
      return;
    }
    const from = blocks.findIndex(b => b.id === active.id);
    if (from < 0 || overIdx < 0 || from === overIdx) return;
    reorder(moveItem(blocks, from, overIdx).map(b => b.id), "drag");
  };

  // ---- Undo, and the keyboard ----------------------------------------------
  const undoList = section ? history[section.id] ?? [] : [];
  const lastUndo = undoList[undoList.length - 1] ?? null;

  /** Put this answer back as it was before its last change. */
  const undoLast = () => {
    if (!section || !lastUndo || locked) return;
    const sectionId = section.id, entry = lastUndo;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setHistory(h => ({ ...h, [sectionId]: (h[sectionId] ?? []).slice(0, -1) }));
    setEditing(null); setTidy(null);
    void run(() => restoreAnswerAction(sectionId, entry.state), r => {
      if (!r.ok) {
        setError(r.error);
        setHistory(h => ({ ...h, [sectionId]: [] }));
        return;
      }
      putBlocks(sectionId)(r.blocks);
      say(`Undid ${entry.label}.`);
    });
  };

  /** N: new text after the piece the writer is on, or at the end. */
  const newTextFrom = (el: HTMLElement | null) => {
    if (!section || locked) return;
    const at = el?.closest<HTMLElement>("[data-piece]")?.dataset.pieceIndex;
    const i = at != null ? Number(at) + 1 : blocks.length;
    insertAt(Number.isFinite(i) ? Math.min(i, blocks.length) : blocks.length);
  };

  const keys = useRef({ undo: undoLast, newText: newTextFrom, dragging: false });
  useEffect(() => { keys.current = { undo: undoLast, newText: newTextFrom, dragging: !!(dragging || activeBlock || draggingNew) }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      // Typing keeps its own undo and arrows; a window over the page keeps its keys.
      if (typing || document.querySelector('[aria-modal="true"]')) return;
      const k = keys.current;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault(); k.undo(); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || k.dragging) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); k.newText(t); return; }
      const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const pieces = Array.from(document.querySelectorAll<HTMLElement>("[data-piece]"));
      if (!pieces.length) return;
      const on = t?.closest<HTMLElement>("[data-piece]") ?? null;
      // From nowhere in particular (the page itself does not scroll), arrows step into the answer.
      if (!on && t && t !== document.body) return;
      const i = on ? pieces.indexOf(on) : -1;
      const next = on ? pieces[i + d] : pieces[d > 0 ? 0 : pieces.length - 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
      next.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!section) {
    return <div className="empty">This application has no questions yet. Reopen the questions to add some.</div>;
  }

  const text = assembleAnswer(blocks);
  const unit = section.limitUnit ?? "words";
  const count = countFor(text, unit);
  const lim = limitState(count, section.limitValue);
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
  // The finish line, for this question and for the whole application.
  const allBlocks = sections.flatMap(s => blocksBy[s.id] ?? []);
  const draftBlockers = finishBlockers(sections, allBlocks, gateCard);
  const sectionBlockers = draftBlockers.filter(b => b.sectionId === section.id);
  // Begin Weaving and Begin Polishing: once the draft has been auto-drafted, only a
  // retired card stops them (Auto-Draft patch 6, spec section 5). The finish line
  // still uses every blocker.
  const autoDrafted = !!draft.auto_drafted_at || autoDraftedHere;
  const stageBlockers = sectionBlockers.filter(b => stageBlocks(b.issue, autoDrafted));

  // ---- What each question still needs, and the progress strip -------------
  const gapCards = ws.cards.map(c => ({ id: c.id, kind: c.kind, status: statusNow[c.id] ?? c.status, placeable: placeable(c) }));
  const gapsBy: Record<string, GapRow[]> = Object.fromEntries(sections.map(s => [s.id, questionGaps({
    sectionId: s.id, wantedKinds: s.wantedKinds, blocks: blocksBy[s.id] ?? [], cards: gapCards, asks,
  })]));
  // Polish's figure audit, for every question: free, and what the finish line holds to.
  const quotesOf = (cardId: string) => cardById.get(cardId)?.evidence.map(e => e.quote) ?? [];
  const flagsBy: Record<string, FigureFlag[]> = Object.fromEntries(sections.map(s => [s.id,
    figureAudit(blocksBy[s.id] ?? [], quotesOf, clearances.filter(c => c.sectionId === s.id))]));
  const openFlagsBy: Record<string, FigureFlag[]> = Object.fromEntries(sections.map(s => [s.id, openFlags(flagsBy[s.id] ?? [])]));
  const pieceIds = (id: string) => (blocksBy[id] ?? []).filter(b => !b.proposed).map(b => b.id);
  const openAdapts = sections.filter(s => adaptationOpen(s.saAdaptation, pieceIds(s.id)));
  const sectionAdaptOpen = openAdapts.some(s => s.id === section.id);
  // Suggested wording still waiting on a person (Auto-Draft patch 8): a finish-line issue.
  const suggBy: Record<string, number> = Object.fromEntries(sections.map(s => [s.id, (blocksBy[s.id] ?? []).filter(pendingSuggestion).length]));
  const draftSugg = sections.reduce((n, s) => n + suggBy[s.id], 0);
  const sectionSugg = suggBy[section.id] ?? 0;
  const draftFigures = sections.reduce((n, s) => n + openFlagsBy[s.id].length, 0);
  const sectionFigures = openFlagsBy[section.id]?.length ?? 0;
  const progress = draftProgress({
    sections, blocksBy, statusBy, toReview: draftBlockers.length, gapsBy,
    figuresIn: (sid, bi) => {
      const b = (blocksBy[sid] ?? [])[bi];
      return b ? (openFlagsBy[sid] ?? []).filter(f => f.blockId === b.id).length : 0;
    },
  });
  const goTo = (i: number | null, st?: Stage) => {
    if (i == null) return;
    if (i !== idx) go(i);
    if (st && st !== stage) switchStage(st);
  };

  /** Ask the client for what this question needs: returns an error to show, or null once sent. */
  const sendAsk = async (kind: string, question: string): Promise<string | null> => {
    const sectionId = section.id;
    const r = await askClientAction({ sectionId, kind, question }).catch(() => null);
    if (!r) return "Could not send the question. Please try again.";
    if (!r.ok) return r.error;
    setAsks(list => [{ id: r.id, sectionId, kind, question, status: "open", answer: null, cardId: null, askedAt: new Date().toISOString(), answeredAt: null }, ...list]);
    setAsking(null);
    say(`Sent. ${tenantName} will see it on their Inven(s)tory page, and their answer comes back here as a ${USER_GENERATED} card. It is worth telling them it is there.`);
    return null;
  };
  const withdrawAsk = (askId: string) => void withdrawAskAction(askId).then(r => {
    if (!r.ok) { setError(r.error); return; }
    setAsks(list => list.map(a => (a.id === askId ? { ...a, status: "withdrawn" as const } : a)));
  }).catch(() => setError("Could not withdraw the question."));
  /** Use a client's answer: the card it made goes in at the end. */
  const placeAnswer = (cardId: string) => {
    if (!cardById.get(cardId)) { say("The client's card is still being filed. Reload the page in a moment to use it."); router.refresh(); return; }
    addCard(cardId, blocks.length);
  };
  /** Run `then` once the finish line is clear, or show what stands in the way. */
  const atFinishLine = (scope: "draft" | "section", then: "completed" | "submit" | "approve", next: () => void) => {
    const list = scope === "draft" ? draftBlockers : sectionBlockers;
    if (list.length) { setBlockers({ scope, then }); return; }
    // Then any adapted Standard Answer still waiting for a choice (Auto-Draft patch 7).
    if (scope === "draft" ? openAdapts.length : sectionAdaptOpen) { setAdaptBlock({ scope }); return; }
    // Then any suggested wording nobody has accepted, edited or rejected (patch 8).
    if (scope === "draft" ? draftSugg : sectionSugg) { setSuggBlock({ scope }); return; }
    // Then the figure audit (Shane, 9 October 2026): a number with no source stops all four ways out.
    if (scope === "draft" ? draftFigures : sectionFigures) { setFigBlock({ scope, then }); return; }
    next();
  };

  // ---- Weave ---------------------------------------------------------------
  // Gaps a bridge could fill once earlier, unaccepted proposals are cleared.
  const weavePieces = blocks.filter(b => !b.proposed).map(b => ({ id: b.id, kind: b.kind, text: b.text, breakBefore: b.breakBefore }));
  const weaveGaps = bridgeGaps(weavePieces).length;
  const proposedCount = blocks.filter(b => b.proposed).length;
  const hasBridges = blocks.some(b => b.kind === "bridge");

  const switchStage = (st: Stage) => {
    setStage(st); setEditing(null); setTidy(null);
    if (!readOnly) void run(() => enterStageAction(draft.id, st), () => undefined);
  };

  /**
   * Why Begin Weaving cannot run here, or null when it can. Entering the Weave
   * tab costs nothing (Shane, 8 October 2026); this button is what spends.
   */
  const weaveBlockedWhy = !blocks.length ? "Place cards in Arrange first."
    : !weaveGaps ? (hasBridges ? "Every gap between the cards already has a bridge." : "Each card sits in its own paragraph, so there is nothing to join. Join paragraphs in Arrange to weave them.")
    : null;

  /**
   * Begin Weaving (or Weave again). Not while any card in the answer stands at
   * the finish line (Shane, 7 October 2026): the list of cards to review opens
   * instead, and weaving carries on once they are clear. Then the reminder
   * about the AI allowance, unless the person turned it off.
   */
  const requestWeave = () => {
    if (stageBlockers.length) { setBlockers({ scope: "section", then: "weave" }); return; }
    if (weaveBlockedWhy) { say(weaveBlockedWhy); return; }
    setWeaveAsk({ again: hasBridges });
  };

  const doWeave = () => {
    setWeaveAsk(null);
    const sectionId = section.id;
    // The "Before Weave" version is taken now, just before bridges are written
    // (skipped when nothing changed since the last version).
    remember(sectionId, "the weave");
    void run(async () => {
      await saveBeforeWeaveAction(draft.id).catch(() => null);
      return weaveSectionAction(sectionId);
    }, r => {
      if (!r.ok) {
        setError(r.error);
        if (r.blocked) setBlockers({ scope: "section", then: "weave" });
        return;
      }
      putBlocks(sectionId)(r.blocks);
      setWovenHere(w => new Set(w).add(sectionId));
      // Any page refresh still in flight (after a review, say) was rendered
      // before these bridges existed; ask for one more so the newest wins.
      router.refresh();
      const set = r.refused ? ` ${r.refused} more ${r.refused === 1 ? "was" : "were"} set aside unseen for adding a number, name or quotation the cards do not hold.` : "";
      say(r.proposed
        ? `Weave proposed ${r.proposed} bridge${r.proposed === 1 ? "" : "s"}, shown in grey. Accept, edit or reject each; none is in the answer until you accept it.${set}`
        : `Weave proposed no bridges: these pieces already read well side by side.${set}`);
    });
  };

  // ---- Polish ----------------------------------------------------------------
  // Nothing runs until Begin Polishing (Shane, 9 October 2026). The checks are
  // worked out here from the answer as it stands, so they follow every change;
  // only shorter wording, for an answer over its limit, is a model call, and it
  // comes after the same reminder as Weave.
  const polishRun = polishRuns[section.id] ?? null;
  const overBy = section.limitValue ? count - section.limitValue : 0;
  const pieceLabel = (id: string) => {
    const b = blocks.find(x => x.id === id);
    if (!b) return "a piece";
    return b.kind === "card" ? (b.cardId ? cardById.get(b.cardId)?.kindLabel ?? "Story Card" : "Story Card") : b.kind === "human" ? "Your words" : "Bridge";
  };
  const scoreOf = (cardId: string) => ranked.find(r => r.card.id === cardId)?.score ?? 0;
  const drops = polishRun ? dropOptions({
    pieces: blocks, limit: section.limitValue ?? 0, unit, wantedKinds: section.wantedKinds,
    kindOf: id => cardById.get(id)?.kind ?? null, scoreOf,
  }) : [];
  const repeated = polishRun ? repeats(blocks) : [];

  /** Begin Polishing (or Polish again): the review gate, then the reminder only when shorter wording will be drafted. */
  const requestPolish = () => {
    if (!blocks.length) { say("Place cards in Arrange first."); return; }
    if (stageBlockers.length) { setBlockers({ scope: "section", then: null }); say(autoDrafted ? "Remove the retired card from this answer first; then begin polishing." : "Review the cards in this answer first; then begin polishing."); return; }
    if (overBy > 0) setPolishAsk({ again: !!polishRun }); else doPolish(false);
  };
  const doPolish = (withAi: boolean) => {
    setPolishAsk(null);
    const sectionId = section.id;
    const original = Object.fromEntries(blocks.map(b => [b.id, b.text]));
    void run(async () => {
      await saveBeforePolishAction(draft.id).catch(() => null);
      return withAi ? polishSectionAction(sectionId) : { ok: true as const, over: 0, proposals: [] as ShortenProposal[], refused: 0 };
    }, r => {
      if (!r.ok) { setError(r.error); return; }
      setPolishRuns(m => ({ ...m, [sectionId]: { at: Date.now(), aiRan: withAi, proposals: r.proposals, refused: r.refused, original } }));
      const open = openFlagsBy[sectionId]?.length ?? 0;
      say(withAi
        ? `Polish drafted shorter wording for ${r.proposals.length} piece${r.proposals.length === 1 ? "" : "s"}, and listed pieces you could take out. Nothing changes until you accept.${open ? ` ${open} number${open === 1 ? "" : "s"} need${open === 1 ? "s" : ""} a source.` : ""}`
        : `Polished.${open ? ` ${open} number${open === 1 ? "" : "s"} need${open === 1 ? "s" : ""} a source before this answer can leave.` : " Every number is traced to its source."}`);
    });
  };
  const acceptShorter = (ps: ShortenProposal[]) => {
    const sectionId = section.id;
    remember(sectionId, ps.length === 1 ? "the shorter wording" : "the shorter wordings");
    for (const p of ps) void run(() => editBlockAction(sectionId, p.blockId, p.text), putBlocks(sectionId));
  };
  const dropPieces = (ids: string[]) => {
    const sectionId = section.id;
    remember(sectionId, ids.length === 1 ? "taking the piece out" : "taking the pieces out");
    setBlocksBy(m => ({ ...m, [sectionId]: (m[sectionId] ?? []).filter(x => !ids.includes(x.id)) }));
    for (const id of ids) void run(() => removeBlockAction(sectionId, id, "button"), putBlocks(sectionId));
  };
  /** Open a piece to change it: in its window, ready to edit, in Polish. */
  const openPiece = (blockId: string) => setWeaveEditId(blockId);
  const clearFigure = async (f: FigureFlag, reason: string, sectionId = section.id): Promise<string | null> => {
    const r = await clearFigureAction({ sectionId, blockId: f.blockId, figure: f.figure, reason }).catch(() => null);
    if (!r) return "Could not clear it. Please try again.";
    if (!r.ok) return r.error;
    setClearances(list => [...list.filter(c => !(c.blockId === f.blockId && c.figure === f.figure)),
      { sectionId, blockId: f.blockId, figure: f.figure, reason: reason.trim() || null, by: null, role: "admin", at: new Date().toISOString(), byName: "you" }]);
    return null;
  };
  const restoreFigure = (f: FigureFlag) => void restoreFigureAction({ sectionId: section.id, blockId: f.blockId, figure: f.figure }).then(r => {
    if (!r.ok) { setError(r.error); return; }
    setClearances(list => list.filter(c => !(c.blockId === f.blockId && c.figure === f.figure)));
  }).catch(() => setError("Could not put the flag back."));
  const whoCleared = (f: FigureFlag) => {
    const c = clearances.find(x => x.blockId === f.blockId && x.figure === f.figure);
    return c?.byName ?? (c?.role === "client" ? tenantName : "For Granted");
  };

  const money = draft.amount_cents == null ? null : "$" + (draft.amount_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

  const markCompleted = () => void run(() => setDraftStatusAction(draft.id, "completed"), () => { say("Marked completed. A version was saved."); router.refresh(); });
  const approveNow = () => void run(() => approveStandardAnswerAction(section.id), r => {
    if (!slug) return;
    setStandards(list => [...list.filter(x => x.slug !== slug), { slug, answerId: "", sectionId: section.id, text, approvedAt: r.approvedAt }]);
    setStatusBy(m => ({ ...m, [section.id]: "done" }));
    say("Approved. Applications asking this question will start from it.");
  });

  const reopen = async () => {
    if (!confirm("Reopen the questions to edit them? Questions you delete, or merge into another, lose the cards placed in them. Questions you only reword keep their answers.")) return;
    try { await reopenSectionsAction(draft.id); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not reopen the questions."); }
  };

  const target = section.limitValue;
  const countLabel = target
    ? `${count.toLocaleString()} ${standard ? "of about" : "/"} ${target.toLocaleString()} ${unit}`
    : `${count.toLocaleString()} ${unit}`;
  const limitText = target
    ? (standard ? `Typical length: about ${target.toLocaleString()} ${unit}` : `Limit: ${target.toLocaleString()} ${unit}`)
    : (standard ? "No typical length" : "No length limit stated");

  return (
    <div className={`ws ws-page${readOnly ? " ws-readonly" : ""}`}>
      {/* Storyboard cleanup (17 October 2026): one calm header. The draft's own
          actions live behind the ⋯ menu; Mark completed also appears, as the one
          primary action, once every question is done (below the toolbar). */}
      <header className="ws-top">
        <div className="ws-top-main">
          <div className="ws-title-row">
            <h2 className="ws-title">{draft.title}</h2>
            {!standard && <span className={`status-pill ${draft.status ?? "drafting"}`}>{STATUS_NAME[(draft.status ?? "drafting") as DraftStatus]}</span>}
            <span className="ws-admin" title={`For Granted only: ${tenantName} cannot see this draft`}>Admin</span>
          </div>
          <About standard={standard} tenantName={tenantName}
            meta={standard ? null : [draft.funder, money, draft.deadline ? `due ${new Date(draft.deadline + "T12:00:00").toLocaleDateString()}` : null].filter(Boolean).join(" · ")} />
        </div>
        <div className="ws-top-acts">
          <span className="ws-saved" aria-live="polite">{pending ? "Saving…" : savedAt ? <><span className="ws-saved-tick" aria-hidden="true">✓</span> Saved</> : ""}</span>
          {!standard && !readOnly && draft.status === "completed" && (
            <button type="button" className="sb-btn sb-primary" disabled={locked} onClick={() => atFinishLine("draft", "submit", () => setSubmitting(true))}>Mark submitted…</button>
          )}
          {!standard && draft.status === "submitted" && (
            <>
              <button type="button" className="sb-btn sb-secondary" onClick={() => void run(() => setDraftStatusAction(draft.id, "won"), () => router.refresh())}>Mark awarded</button>
              <button type="button" className="sb-btn sb-secondary" onClick={() => void run(() => setDraftStatusAction(draft.id, "lost"), () => router.refresh())}>Mark declined</button>
            </>
          )}
          <button type="button" className="sb-btn sb-secondary" onClick={() => setContextOpen(true)}
            title="The funder's overview and what the client wants this application to say. Auto-draft reads it.">
            Grant context{context.items.length ? <span className="sb-count"> ({context.items.length})</span> : null}</button>
          <MenuButton label="Draft menu" icon={DOTS}>
            <MenuItem title="Versions" hint="Saved copies of the whole draft" onClick={() => setVersionsOpen(true)} />
            {!standard && !readOnly && <MenuItem title="Edit the questions" hint="Back to the confirmation screen" onClick={() => void reopen()} />}
            {!standard && sourceText && <MenuItem title="The funder’s application" hint="The text the questions were read from" onClick={() => setSourceOpen(true)} />}
            {!standard && !readOnly && draft.status !== "completed" && (
              <MenuItem title="Mark completed" hint="Finished and ready to send; still editable. A version is saved." disabled={locked}
                onClick={() => atFinishLine("draft", "completed", markCompleted)} />
            )}
            {!standard && !readOnly && draft.status === "completed" && (
              <MenuItem title="Back to drafting" hint="Undo Mark completed" disabled={locked}
                onClick={() => void run(() => setDraftStatusAction(draft.id, "drafting"), () => router.refresh())} />
            )}
          </MenuButton>
        </div>
      </header>
      {readOnly && (
        <div className="ws-locked" role="status">
          <span><strong>{draft.status === "submitted" ? "Submitted" : STATUS_NAME[draft.status as DraftStatus]}</strong>
            {draft.submitted_at ? ` on ${new Date(draft.submitted_at).toLocaleDateString()}` : ""}. This is the copy the funder received, so it is locked.</span>
          <button type="button" className="btn secondary ap-mini" disabled={pending > 0}
            onClick={() => void run(() => newDraftFromAction(draft.id), id => router.push(`/drafts/${id}`))}>Start a new version from this one</button>
        </div>
      )}

      {/* The toolbar (Storyboard cleanup, 17 October 2026): where you are, in one row. */}
      <div className="ws-toolbar">
        <div className="ws-stages" role="tablist" aria-label="Drafting stage">
          {(["arrange", "weave", "polish"] as const).map((st, n) => (
            <button key={st} type="button" role="tab" aria-selected={stage === st} className={`ws-stage${stage === st ? " active" : ""}`}
              disabled={pending > 0} onClick={() => { if (stage !== st) switchStage(st); }}
              title={st === "arrange" ? "Choose and order the cards"
                : st === "weave" ? "Read the answer as prose, with short bridges between the cards to accept or reject"
                : "Check length, every number's source, and repetition before the answer goes out. Nothing runs until you press Begin Polishing."}>
              <span className="ws-stage-n" aria-hidden="true">{n + 1}</span>{st === "arrange" ? "Arrange" : st === "weave" ? "Weave" : "Polish"}
            </button>
          ))}
        </div>
        <nav className="ws-nav" aria-label="Questions">
          <span className="ws-done-count"><strong>{progress.done} of {progress.questions}</strong> done</span>
          <button type="button" className="sb-btn sb-quiet sb-icon" disabled={navAt <= 0} onClick={() => go(navOrder[navAt - 1])} aria-label="Previous question">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
          <div className="ws-pills">
            {recommendedIdx.map(i => <Pill key={sections[i].id} i={i} />)}
            {optionalIdx.length > 0 && (
              <button type="button" className="sb-btn sb-quiet ws-opt-toggle" onClick={() => setShowOptional(v => !v)}
                title="Questions fewer funders ask, or that this client has no cards for yet">
                {showOptional || optionalIdx.includes(idx) ? "Optional:" : `＋ ${optionalIdx.length} optional`}
              </button>
            )}
            {(showOptional || optionalIdx.includes(idx)) && optionalIdx.map(i => <Pill key={sections[i].id} i={i} optional />)}
          </div>
          <button type="button" className="sb-btn sb-quiet sb-icon" disabled={navAt < 0 || navAt >= navOrder.length - 1} onClick={() => go(navOrder[navAt + 1])} aria-label="Next question">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </nav>
        {stage === "arrange" && !readOnly && (
          <button type="button" className="sb-btn sb-ai ws-edit-only" disabled={locked} onClick={() => setAutoAsk({ scope: "draft" })}
            title="Fill every question that is not done with Story Cards, the way this client builds answers. A version is saved first; nothing leaves until a person has dealt with every flag.">
            {SPARK} Auto-draft {standard ? "all Standard Answers" : "all questions"}</button>
        )}
      </div>
      {/* A fixed id: dnd-kit numbers its accessibility ids per render, which differed between server and browser (a hydration mismatch). */}
      <DndContext id="storyboard-dnd" sensors={readOnly ? noSensors : sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver}
        onDragEnd={onDragEnd} onDragCancel={endDrag}>
        <div className="ws-split" ref={splitRef} style={splitHeight ? { height: splitHeight } : undefined}>
          <CardPanel key={section.id} sectionId={section.id} ranked={ranked} usedWhere={usedWhere} current={idx + 1} statusNow={statusNow}
            wantedKinds={section.wantedKinds} locked={readOnly || stage !== "arrange"} onAdd={id => addCard(id, blocks.length)}
            onNewText={readOnly ? null : () => insertAt(blocks.length)} canDragNew={!readOnly && stage === "arrange"}
            open={panelOpen} onClose={() => setPanelOpen(false)} removing={!!activeBlock} kindRequest={panelAsk} />

          <div className="ws-main">
            {stripVisible && (
              <button type="button" className="ws-strip" onClick={() => questionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                title="Back to the question">
                <span className="ws-q-num">Q{idx + 1}</span>
                <span className="ws-strip-text">{section.prompt}</span>
              </button>
            )}
            <div className="ws-scroll" ref={scrollRef}>
              <ProgressStrip p={progress}
                onReview={() => setBlockers({ scope: "draft", then: null })}
                onBridges={() => goTo(progress.firstBridge, "weave")}
                onWording={() => goTo(progress.firstWording, "arrange")}
                onFigures={() => goTo(progress.firstFigure, "arrange")}
                onAsks={() => goTo(progress.firstAsk)} />
              {!standard && !readOnly && draft.status !== "completed" && progress.questions > 0 && progress.done >= progress.questions && (
                <div className="ws-alldone" role="status">
                  <span>Every answer is done. Mark the application completed to save a version and run the final checks.</span>
                  <button type="button" className="sb-btn sb-primary" disabled={locked} onClick={() => atFinishLine("draft", "completed", markCompleted)}>Mark completed</button>
                </div>
              )}
              {autoRun && (
                <div className="ad-running" role="status" aria-live="polite">
                  <span className="jp-spin" aria-hidden="true" />
                  <span><strong>Auto-drafting.</strong> {autoRun.total ? `${Math.min(autoRun.done, autoRun.total)} of ${autoRun.total} questions done.` : "Starting."} Editing waits until it finishes; it keeps going if you leave this page.</span>
                  <button type="button" className="btn ghost ap-mini" onClick={() => void stopAutoDraft()}>Stop</button>
                </div>
              )}


              <section className="ws-question" ref={questionRef}>
                <div className="ws-q-head">
                  <span className="ws-q-num">Question {idx + 1} of {sections.length}</span>
                  {statusBy[section.id] === "done" && <span className="ws-q-done">Done</span>}
                  {standard && !advice[idx].recommended && <span className="ov-muted">Optional: {advice[idx].why}</span>}
                </div>
                <h3 className="ws-prompt">{section.prompt}</h3>
                {(section.guidance || section.criteria) && (
                  <details className="ws-guide">
                    <summary>Guidance{section.criteria ? " and scoring" : ""}</summary>
                    {section.guidance && <div className="ap-guidance">{section.guidance}</div>}
                    {section.criteria && <div className="ap-guidance"><strong>Scoring:</strong> {section.criteria}</div>}
                  </details>
                )}
                {section.saAdaptation && !standard && (
                  <AdaptBanner key={section.id} sectionId={section.id} adaptation={section.saAdaptation} pieceIds={pieceIds(section.id)} locked={locked}
                    onKeep={() => void run(() => keepAdaptationAction(section.id), r => {
                      if (!r.ok) { setError(r.error); return; }
                      say("Kept for this grant only. The Standard Answer is unchanged."); router.refresh();
                    })}
                    onUpdate={() => void run(() => updateStandardFromAdaptationAction(section.id), r => {
                      if (!r.ok) { setError(r.error); return; }
                      say("Copied into Standard Answers as that question's working version. Approve it there to use it; until then the old approved answer stays in use. A version of Standard Answers was saved first.");
                      router.refresh();
                    })}
                    onRevert={() => {
                      const sectionId = section.id;
                      const before = undoState(blocksBy[sectionId] ?? []);
                      void run(() => revertAdaptationAction(sectionId), r => {
                        if (!r.ok) { setError(r.error); return; }
                        setHistory(h => ({ ...h, [sectionId]: pushUndo(h[sectionId] ?? [], { label: "going back to the Standard Answer", state: before }) }));
                        putBlocks(sectionId)(r.blocks);
                        say("Back to the Standard Answer as it was copied in. Undo brings the adapted version back.");
                        router.refresh();
                      });
                    }} />
                )}
                {stdTooLong && (
                  <div className="ws-warn ws-soft">The standard answer is {stdCount.toLocaleString()} {unit}; this funder allows {section.limitValue!.toLocaleString()}. Starting from it means cutting.</div>
                )}
                {section.wantedKinds.length
                  ? <GapPanel key={section.id} rows={gapsBy[section.id] ?? []} locked={locked} lead={limitText}
                      onShow={kind => { setPanelAsk(p => ({ kind, n: (p?.n ?? 0) + 1 })); setPanelOpen(true); }}
                      onAdd={kind => insertAt(blocks.length, kind)}
                      onAsk={kind => setAsking(kind)}
                      onUse={placeAnswer}
                      onWithdraw={withdrawAsk} />
                  : <div className="gp"><div className="gp-head"><span className="gp-lead">{limitText}</span><span>No card kinds set (ranked by wording and evidence only)</span></div></div>}
              </section>


              {standard && since && sections.some(isNew) && (
                <div className="ws-notice" role="status">
                  {sections.filter(isNew).length} new question{sections.filter(isNew).length === 1 ? "" : "s"} since you last opened Standard Answers,
                  learned from funders&rsquo; applications: {sections.filter(isNew).map(s => sections.indexOf(s) + 1).join(", ")}. They are marked in the list above.
                </div>
              )}
              {noStandards && saNote && (
                <div className="ws-notice ws-notice-x ws-flag-note" role="note">
                  <svg className="ws-flag-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" />
                  </svg>
                  <span><strong>No approved Standard Answers yet.</strong> {tenantName} has none, so every answer here starts from scratch.
                    Answering the questions funders ask most once lets every application, this one included, start from them.{" "}
                    <button type="button" className="ws-inline-link" onClick={() => void openStandardAnswersAction()
                      .then(r => router.push(`/drafts/${r.draftId}`)).catch(e => setError(e instanceof Error ? e.message : "Could not open Standard Answers."))}>Open Standard Answers</button></span>
                  <button type="button" className="bn-x" onClick={dismissSaNote} aria-label="Dismiss for this draft">×</button>
                </div>
              )}
              {fillable > 0 && (
                <div className="ws-notice">
                  {fillable} question{fillable === 1 ? "" : "s"} here match{fillable === 1 ? "es" : ""} an approved standard answer and {fillable === 1 ? "is" : "are"} still empty.{" "}
                  <button type="button" className="btn secondary ap-mini" disabled={locked}
                    onClick={() => void run(() => fillFromStandardsAction(draft.id), r => {
                      say(`${r.filled} question${r.filled === 1 ? "" : "s"} started from Standard Answers`
                        + (r.needsReview ? `; ${r.needsReview} left empty because their standard answer holds cards not yet verified (open one and press Start from the standard answer to review them)` : "")
                        + (r.skipped ? `; ${r.skipped} left empty because their standard answer holds a sensitive or retired card` : "")
                        + ". Rearrange each for this funder.");
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

              <div className="ws-ans-head">
                <span className="ws-ans-label">Your answer</span>
                <span className={`ws-count ws-lim-${lim}`} title={target ? `${standard ? "Typical length" : "Limit"}: ${target.toLocaleString()} ${unit}` : "No limit stated"}>
                  {countLabel}{lim === "over" ? (standard ? " · long" : " · over") : ""}{!target ? <span className="ws-count-sub"> · no limit</span> : null}
                </span>
              </div>

              {stage === "weave" && blocks.length > 0 && !hasBridges && !readOnly && !wovenHere.has(section.id) && (
                <div className="ws-notice wv-start">
                  <span>{weaveBlockedWhy
                    ? weaveBlockedWhy
                    : "Read the cards as one passage. Begin Weaving drafts short connecting sentences between them, for you to accept, edit or reject."}</span>
                  <button type="button" className="sb-btn sb-ai" disabled={locked || !!weaveBlockedWhy}
                    title={weaveBlockedWhy ?? "Uses a small part of the monthly AI allowance"} onClick={requestWeave}>{SPARK} Begin Weaving</button>
                </div>
              )}
              {stage === "polish" && blocks.length > 0 && (
                <PolishPanel run={polishRun} locked={locked || readOnly} count={count} limit={section.limitValue} unit={unit} standard={standard}
                  drops={drops} flags={flagsBy[section.id] ?? []} repeated={repeated}
                  textOf={id => blocks.find(b => b.id === id)?.text ?? null} labelOf={pieceLabel} whoCleared={whoCleared}
                  current={id => blocks.find(b => b.id === id)?.text ?? null}
                  onBegin={requestPolish} onAccept={p => acceptShorter([p])} onAcceptAll={acceptShorter}
                  onDrop={dropPieces} onOpen={openPiece} onClear={(f, r) => clearFigure(f, r)} onRestore={restoreFigure} />
              )}
              {stage !== "arrange" ? (
                blocks.length
                  ? <WeaveView blocks={blocks} cardById={cardById} gateCard={gateCard} locked={locked}
                      editId={weaveEditId} onEditOpened={() => setWeaveEditId(null)}
                      handlers={{
                        onAccept: id => change(section.id, "accepting the bridge", () => acceptBridgesAction(section.id, id), putBlocks(section.id)),
                        onEdit: (id, t) => editBlock(id, t),
                        onInsert: insertAt,
                        onSaveCard: id => { const b = blocks.find(x => x.id === id); if (b) setUserCard({ blockId: id, text: b.text.trim() }); },
                        onSaveWording: id => change(section.id, "using the saved wording (the Card Library keeps it)", () => saveWordingToLibraryAction(section.id, id), next => { putBlocks(section.id)(next); say("Saved this wording to the card in the Card Library."); router.refresh(); }),
                        onRemove: id => { const b = blocks.find(x => x.id === id); if (b) requestRemove(b, "button"); },
                        onReview: cardId => setReview({ mode: "review", queue: [{ cardId, position: null }] }),
                        onRefresh: id => change(section.id, "the wording change", () => refreshBlockWordingAction(section.id, id), putBlocks(section.id)),
                        onKeep: id => change(section.id, "keeping the wording", () => keepWordingAction(section.id, id), putBlocks(section.id)),
                        onAcceptSuggestion: (id, shown, t) => change(section.id, "accepting the suggested wording", () => acceptSuggestionAction(section.id, id, shown, t).then(suggestOk), putBlocks(section.id)),
                        onRejectSuggestion: id => change(section.id, "rejecting the suggested wording", () => rejectSuggestionAction(section.id, id).then(suggestOk), putBlocks(section.id)),
                      }} />
                  : <div className="ws-empty-answer"><p>Nothing to {stage === "polish" ? "polish" : "weave"} yet. Go back to <strong>Arrange</strong> to place cards in this answer.</p></div>
              ) : <AnswerColumn
                blocks={blocks} cardById={cardById} gateCard={gateCard} locked={locked} editing={editing} setEditing={setEditing}
                dropBefore={dragging && overId && overId !== "answer" && overId !== "panel" ? overId : null}
                dropAtEnd={!!dragging && overId === "answer"}
                onMove={(from, to) => reorder(moveItem(blocks, from, to).map(b => b.id), "buttons")}
                onRemove={id => { const b = blocks.find(x => x.id === id); if (b) requestRemove(b, "button"); }}
                onEdit={editBlock}
                onInsert={insertAt}
                onSaveCard={b => setUserCard({ blockId: b.id, text: b.text.trim() })}
                onSaveWording={id => change(section.id, "using the saved wording (the Card Library keeps it)", () => saveWordingToLibraryAction(section.id, id), next => { putBlocks(section.id)(next); say("Saved this wording to the card in the Card Library. Every answer that uses the card will be offered the new wording."); router.refresh(); })}
                onBreak={(id, v) => change(section.id, "the paragraph change", () => setBreakAction(section.id, id, v), putBlocks(section.id))}
                onRefresh={id => change(section.id, "the wording change", () => refreshBlockWordingAction(section.id, id), putBlocks(section.id))}
                onKeep={id => change(section.id, "keeping the wording", () => keepWordingAction(section.id, id), putBlocks(section.id))}
                onAcceptSuggestion={(id, shown, t) => change(section.id, "accepting the suggested wording", () => acceptSuggestionAction(section.id, id, shown, t).then(suggestOk), putBlocks(section.id))}
                onRejectSuggestion={id => change(section.id, "rejecting the suggested wording", () => rejectSuggestionAction(section.id, id).then(suggestOk), putBlocks(section.id))}
                empty={
                  <EmptyAnswer
                    std={!standard && std?.sectionId ? std : undefined}
                    onStart={() => void change(section.id, "starting from the standard answer", () => startFromStandardAction(section.id), r => {
                      putBlocks(section.id)(r.blocks);
                      if (r.needsReview.length) {
                        setReview({ mode: "review", queue: r.needsReview.map(cardId => ({ cardId, position: null })),
                          note: "The standard answer holds cards not yet verified. Review each, then press Start from the standard answer again." });
                      }
                    })}
                  />
                }
              />}

              {sectionBlockers.length > 0 && !readOnly && (
                <div className="ws-warn">
                  {describeBlockers(sectionBlockers, "this answer")} It cannot be copied, approved or sent until then.{" "}
                  <button type="button" className="cl-link" onClick={() => setBlockers({ scope: "section", then: null })}>Review them</button>
                </div>
              )}

              {standard && std && (
                <p className="ov-muted ws-approved">
                  {std.sectionId === section.id
                    ? `Approved ${std.approvedAt ? new Date(std.approvedAt).toLocaleDateString() : ""}${changedSinceApproval ? ". This answer has changed since; applications still start from the approved text until you approve the changes." : "."}`
                    : "There is an earlier approved answer to this question. Approving replaces it."}
                </p>
              )}

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

            {/* The action bar (Storyboard cleanup, 17 October 2026): one row, right-aligned,
                one primary action; rarely used tools behind More, which opens upward. */}
            <div className="ws-bar" role="toolbar" aria-label="Answer actions">
              <button type="button" className="sb-btn sb-secondary ws-panel-toggle" onClick={() => setPanelOpen(true)}>Story Cards</button>
              <span className="spacer" />
              {!readOnly && (
                <button type="button" className="sb-btn sb-secondary" disabled={locked || !lastUndo} onClick={undoLast}
                  title={lastUndo ? `Undo ${lastUndo.label} (Ctrl+Z, or ⌘Z on a Mac)` : "Nothing to undo in this answer yet"}>
                  <span aria-hidden="true">↶</span> Undo</button>
              )}
              {stage === "weave" && !readOnly && (
                <>
                  {proposedCount > 0 && (
                    <button type="button" className="sb-btn sb-secondary ws-edit-only" disabled={locked}
                      title="Accept every bridge proposed in this answer"
                      onClick={() => void change(section.id, "accepting the bridges", () => acceptBridgesAction(section.id, null), putBlocks(section.id))}>Accept all ({proposedCount})</button>
                  )}
                  <button type="button" className="sb-btn sb-ai ws-edit-only" disabled={locked || !!weaveBlockedWhy}
                    title={weaveBlockedWhy ?? (hasBridges || wovenHere.has(section.id)
                      ? "Propose bridges again: replaces the ones not yet accepted, and fills any gap without one"
                      : "Draft connecting sentences between the cards. Uses a small part of the monthly AI allowance.")}
                    onClick={requestWeave}>{SPARK} {hasBridges || wovenHere.has(section.id) ? "Weave again" : "Begin Weaving"}</button>
                </>
              )}
              {stage === "polish" && !readOnly && blocks.length > 0 && (
                <button type="button" className={`sb-btn ${overBy > 0 ? "sb-ai" : "sb-secondary"} ws-edit-only`} disabled={locked} onClick={requestPolish}
                  title={overBy > 0 ? "Check this answer and draft shorter wording. Drafting uses a small part of the monthly AI allowance." : "Check length, numbers and repetition. Free."}>
                  {overBy > 0 ? <>{SPARK} </> : null}{polishRun ? "Polish again" : "Begin Polishing"}</button>
              )}
              {stage === "arrange" && !readOnly && (
                <>
                  <button type="button" className="sb-btn sb-secondary ws-edit-only" disabled={locked}
                    title="Add text at the end. Or click between any two pieces of the answer to add it there."
                    onClick={() => insertAt(blocks.length)}>＋ Your text</button>
                  <button type="button" className="sb-btn sb-ai ws-edit-only" disabled={locked} onClick={() => setAutoAsk({ scope: "question" })}
                    title="Fill this question with Story Cards: from its approved Standard Answer if it has one and is empty, otherwise chosen and ordered for this question. Cards already here stay.">
                    {SPARK} Auto-draft this question</button>
                </>
              )}
              <MenuButton label="More actions" text="More" icon={DOTS} up className="ws-more-menu">
                <CopyItem text={text} blocked={sectionBlockers.length > 0 || sectionAdaptOpen || sectionSugg > 0 || sectionFigures > 0}
                  onCopied={() => say("Answer copied, ready to paste into the funder's form.")}
                  onBlocked={() => (sectionBlockers.length ? setBlockers({ scope: "section", then: null })
                    : sectionAdaptOpen ? setAdaptBlock({ scope: "section" })
                    : sectionSugg ? setSuggBlock({ scope: "section" }) : setFigBlock({ scope: "section", then: null }))} />
                {stage === "arrange" && !readOnly && (
                  <MenuItem title="Tidy" hint={blocks.length < 3 ? "Needs at least three pieces" : "Suggest a better order, with a reason"}
                    disabled={locked || blocks.length < 3}
                    onClick={() => void run(() => tidyAction(section.id), r => {
                      if ("error" in r) say(r.error);
                      else if (r.order.every((id, i) => id === blocks[i]?.id)) say(`Tidy would keep this order. ${r.rationale}`);
                      else { setTidy(r); reveal(); }
                    })} />
                )}
                <MenuItem title={seams ? "Hide seams" : "Show seams"} hint="See where each part of the answer came from" disabled={!blocks.length}
                  onClick={() => { setSeams(v => !v); if (!seams) reveal(); }} />
                {!readOnly && (
                  <>
                    <div className="mb-sep" role="separator" />
                    <MenuItem title={keysOpen ? "Hide keyboard shortcuts" : "Keyboard shortcuts"} keepOpen onClick={() => setKeysOpen(v => !v)} />
                    {keysOpen && (
                      <p className="mb-note">
                        <strong>N</strong> adds new text after the piece you are on, or at the end. The <strong>arrow keys</strong> move
                        between the pieces of the answer, and <strong>Enter</strong> opens one. <strong>Ctrl+Z</strong> (⌘Z on a Mac) undoes
                        the last change to this answer; while you type, it undoes typing instead.
                      </p>
                    )}
                  </>
                )}
              </MenuButton>
              <span className="ws-bar-end ws-edit-only">
                {statusBy[section.id] === "done"
                  ? <button type="button" className="sb-btn sb-secondary" disabled={locked}
                      onClick={() => void run(() => setSectionDoneAction(section.id, false), st => setStatusBy(m => ({ ...m, [section.id]: st })))}>Reopen this answer</button>
                  : <button type="button" className={`sb-btn ${standard ? "sb-secondary" : "sb-primary"}`} disabled={locked || !blocks.length}
                      onClick={() => void run(() => setSectionDoneAction(section.id, true), st => setStatusBy(m => ({ ...m, [section.id]: st })))}>Mark this answer done</button>}
                {standard && (
                  <button type="button" className="sb-btn sb-primary" disabled={locked || !text || (std?.sectionId === section.id && !changedSinceApproval)}
                    title="Make this the approved Standard Answer, linked to the cards it was built from. Applications start from approved answers."
                    onClick={() => atFinishLine("section", "approve", approveNow)}>
                    {std?.sectionId === section.id ? (changedSinceApproval ? "Approve the changes" : "Approved") : "Approve this answer"}
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
        {autoAsk && (
          <AutoDraftDialog draftId={draft.id} sectionId={autoAsk.scope === "question" ? section.id : null} questionNumber={idx + 1}
            onCancel={() => setAutoAsk(null)}
            onAddContext={() => { setAutoAsk(null); setContextOpen(true); }}
            onConfirm={() => (autoAsk.scope === "question" ? autoDraftQuestion(section.id) : void startAutoDraft())} />
        )}
        {contextOpen && (
          <div className="ws-modal-back" role="presentation" onClick={() => setContextOpen(false)}>
            <aside className="ws-versions gc-drawer" role="dialog" aria-modal="true" aria-label="Grant context" onClick={e => e.stopPropagation()}>
              <div className="ws-versions-head">
                <h3>Grant context</h3>
                <button type="button" className="bn-x" onClick={() => setContextOpen(false)} aria-label="Close">×</button>
              </div>
              <p className="ov-muted">What auto-draft should know beyond the questions. It teaches nothing about facts: every figure and name
                in the answer still comes from a Story Card. None of it is added to {tenantName}&rsquo;s Inven(s)tory.</p>
              <GrantContextBox mode="live" draftId={draft.id} items={context.items} ready={context.ready} locked={readOnly} />
            </aside>
          </div>
        )}
        {sourceOpen && (
          <div className="ws-modal-back" role="presentation" onClick={() => setSourceOpen(false)}>
            <aside className="ws-versions gc-drawer" role="dialog" aria-modal="true" aria-label="The funder's application" onClick={e => e.stopPropagation()}>
              <div className="ws-versions-head">
                <h3>The funder&rsquo;s application</h3>
                <button type="button" className="bn-x" onClick={() => setSourceOpen(false)} aria-label="Close">×</button>
              </div>
              <p className="ov-muted">From {SOURCE_LABEL[draft.source_kind ?? "paste"] ?? "text"}{draft.source_filename ? `: ${draft.source_filename}` : ""}, {sourceText.length.toLocaleString()} characters.</p>
              <pre className="ws-source-text">{sourceText}</pre>
            </aside>
          </div>
        )}
        {versionsOpen && (
          <VersionsDrawer draftId={draft.id} readOnly={readOnly} onClose={() => setVersionsOpen(false)}
            onRestored={(r) => { setVersionsOpen(false); setHistory({}); say(`Restored ${r.restored} question${r.restored === 1 ? "" : "s"}${r.skipped ? `; ${r.skipped} no longer in this application were skipped` : ""}. The previous state was saved as a version first.`); router.refresh(); }} />
        )}
        {choice && (
          <ChoiceDialog text={choice.text}
            onOwn={() => setChoice(null)}
            onCard={() => { const c = choice; setChoice(null); setUserCard(c); }} />
        )}
        {asking && (
          <AskDialog kind={asking} prompt={section.prompt} tenantName={tenantName}
            onSend={q => sendAsk(asking, q)} onCancel={() => setAsking(null)} />
        )}
        {userCard && (
          <UserCardDialog text={userCard.text} sectionId={section.id} preferKind={userCard.kind ?? null}
            onSaved={cardId => placeUserCard(userCard.blockId, cardId, true)}
            onUseExisting={cardId => placeUserCard(userCard.blockId, cardId, false)}
            onCancel={() => setUserCard(null)} />
        )}
        {polishAsk && (
          <WeaveReminder kind="polish" tenantName={tenantName} again={polishAsk.again}
            onWeave={() => doPolish(true)} onCancel={() => setPolishAsk(null)} />
        )}
        {adaptBlock && (
          <div className="ws-modal-back" role="presentation" onClick={() => setAdaptBlock(null)}>
            <div className="ws-modal" role="dialog" aria-modal="true" aria-labelledby="adapt-block-title" onClick={e => e.stopPropagation()}>
              <h3 id="adapt-block-title">Choose what happens to the Standard Answer first</h3>
              <p className="ov-muted">{adaptBlock.scope === "draft" ? "These answers were" : "This answer was"} adapted from the client&rsquo;s Standard Answer for this
                funder. For each, keep it for this grant only, also update the Standard Answer, or go back to the Standard Answer. Then carry on.</p>
              <ul className="fl-list">
                {openAdapts.filter(s => adaptBlock.scope === "draft" || s.id === section.id).map(s => {
                  const i = sections.indexOf(s);
                  return (
                    <li key={s.id}>
                      <span><strong>Q{i + 1}</strong> {s.prompt.length > 90 ? `${s.prompt.slice(0, 87)}…` : s.prompt}</span>
                      {i !== idx && <button type="button" className="btn secondary ap-mini" onClick={() => { setAdaptBlock(null); goTo(i, "arrange"); }}>Go to it</button>}
                    </li>
                  );
                })}
              </ul>
              <div className="ws-modal-acts"><button type="button" className="btn secondary" onClick={() => setAdaptBlock(null)}>Close</button></div>
            </div>
          </div>
        )}
        {suggBlock && (
          <div className="ws-modal-back" role="presentation" onClick={() => setSuggBlock(null)}>
            <div className="ws-modal" role="dialog" aria-modal="true" aria-labelledby="sugg-block-title" onClick={e => e.stopPropagation()}>
              <h3 id="sugg-block-title">Deal with the suggested wording first</h3>
              <p className="ov-muted">Auto-draft suggested new wording for {suggBlock.scope === "draft" ? "cards in these answers" : "cards in this answer"}.
                Under each card marked &ldquo;New wording suggested&rdquo;, accept it, edit it or reject it. Then carry on.</p>
              <ul className="fl-list">
                {sections.filter(s => suggBy[s.id] > 0 && (suggBlock.scope === "draft" || s.id === section.id)).map(s => {
                  const i = sections.indexOf(s);
                  return (
                    <li key={s.id}>
                      <span><strong>Q{i + 1}</strong> {s.prompt.length > 80 ? `${s.prompt.slice(0, 77)}…` : s.prompt} ({suggBy[s.id]} card{suggBy[s.id] === 1 ? "" : "s"})</span>
                      {i !== idx && <button type="button" className="btn secondary ap-mini" onClick={() => { setSuggBlock(null); goTo(i, "arrange"); }}>Go to it</button>}
                    </li>
                  );
                })}
              </ul>
              <div className="ws-modal-acts"><button type="button" className="btn secondary" onClick={() => setSuggBlock(null)}>Close</button></div>
            </div>
          </div>
        )}
        {figBlock && (
          <FiguresDialog what={figBlock.scope === "draft" ? "this application" : "this answer"} then={figBlock.then}
            items={sections.map((s, i) => ({ s, i })).filter(({ s }) => figBlock.scope === "draft" || s.id === section.id)
              .flatMap(({ s, i }) => (openFlagsBy[s.id] ?? []).map(f => ({ f, sectionId: s.id, question: i + 1,
                text: (blocksBy[s.id] ?? []).find(b => b.id === f.blockId)?.text ?? "" })))}
            onClear={(f, sectionId, reason) => clearFigure(f, reason, sectionId)}
            onGo={sectionId => {
              setFigBlock(null);
              const i = sections.findIndex(x => x.id === sectionId);
              if (i >= 0) goTo(i, "polish");
              // Arriving from the finish line is asking for the checks: show them (free; no wording is drafted).
              setPolishRuns(m => m[sectionId] ? m : { ...m, [sectionId]: { at: Date.now(), aiRan: false, proposals: [], refused: 0, original: {} } });
            }}
            onContinue={() => {
              const t = figBlock.then; setFigBlock(null);
              if (t === "completed") markCompleted(); else if (t === "submit") setSubmitting(true); else if (t === "approve") approveNow();
            }}
            onClose={() => setFigBlock(null)} />
        )}
        {weaveAsk && (
          <WeaveReminder tenantName={tenantName} again={weaveAsk.again}
            onWeave={doWeave} onCancel={() => setWeaveAsk(null)} />
        )}
        {submitting && (
          <SubmitDialog onCancel={() => setSubmitting(false)}
            onSubmit={date => { setSubmitting(false); void run(() => setDraftStatusAction(draft.id, "submitted", date), () => router.refresh()); }} />
        )}
        {review && review.queue[0] && (
          <ReviewDialog key={review.queue[0].cardId} cardId={review.queue[0].cardId} mode={review.mode} note={review.note}
            left={review.queue.length - 1} onAction={onReviewed}
            onSkip={() => { const rest = review.queue.slice(1); if (rest.length) setReview({ ...review, queue: rest }); else { setReview(null); router.refresh(); } }}
            onClose={() => { setReview(null); router.refresh(); }} />
        )}
        {blockers && !review && (
          <BlockersDialog list={blockers.scope === "draft" ? draftBlockers : sectionBlockers}
            what={blockers.scope === "draft" ? "this application" : "this answer"}
            then={blockers.then}
            onReview={b => setReview({ mode: "review", queue: [{ cardId: b.cardId, position: null }] })}
            onWording={(b, keep) => { if (b.blockId) void change(b.sectionId, keep ? "keeping the wording" : "the wording change", () => (keep ? keepWordingAction : refreshBlockWordingAction)(b.sectionId, b.blockId!), putBlocks(b.sectionId)); }}
            onGo={b => { setBlockers(null); const i = sections.findIndex(x => x.id === b.sectionId); if (i >= 0) go(i); }}
            onContinue={() => {
              const t = blockers.then; setBlockers(null);
              if (t === "completed") atFinishLine("draft", "completed", markCompleted);
              else if (t === "submit") atFinishLine("draft", "submit", () => setSubmitting(true));
              else if (t === "approve") atFinishLine("section", "approve", approveNow);
              else if (t === "weave") requestWeave();
            }}
            onClose={() => setBlockers(null)} />
        )}
        {confirming && (
          <RemoveDialog block={confirming.block} askAgain={askRemove}
            onKeep={() => setConfirming(null)}
            onRemove={dontAsk => {
              const { block, via } = confirming;
              setConfirming(null);
              if (dontAsk) {
                setAskRemove(false);
                void setUiPrefAction("confirm_card_remove", false).catch(() => setError("Could not save \"Don't ask me again\"; it applies to this page only."));
              }
              doRemove(block, via);
            }} />
        )}
        {undo && (
          <div className="ws-undo" role="status">
            <span>{undo.label}</span>
            <button type="button" className="btn secondary ap-mini" disabled={locked} onClick={undoLast}>Undo</button>
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {draggingNew ? <div className="ws-card ws-overlay ws-newtext-overlay"><p className="cl-statement">New text: drop it where it goes</p></div>
            : dragging ? <div className={`ws-card ws-overlay ${layerClass(dragging.layer)}`}><p className="cl-statement">{dragging.statement}</p></div>
            : activeBlock ? (() => {
                const b = blocks.find(x => x.id === activeBlock);
                const c = b?.cardId ? cardById.get(b.cardId) : undefined;
                return b ? <div className={`ws-card ws-overlay ${layerClass(c?.layer ?? null)}`}><p className="cl-statement">{b.text.slice(0, 220)}{b.text.length > 220 ? "…" : ""}</p></div> : null;
              })() : null}
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

/** The finish line, stopped by numbers with no source: clear each here, or go and change it. */
function FiguresDialog({ what, then, items, onClear, onGo, onContinue, onClose }: {
  what: string; then: "completed" | "submit" | "approve" | null;
  items: { f: FigureFlag; sectionId: string; question: number; text: string }[];
  onClear: (f: FigureFlag, sectionId: string, reason: string) => Promise<string | null>;
  onGo: (sectionId: string) => void; onContinue: () => void; onClose: () => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const key = (x: { f: FigureFlag }) => `${x.f.blockId}|${x.f.figure}`;
  const verb = then === "completed" ? "marked completed" : then === "submit" ? "marked submitted" : then === "approve" ? "approved" : "copied";
  return (
    <div className="ws-modal-back" role="presentation" onClick={onClose}>
      <div className="ws-modal" role="dialog" aria-modal="true" aria-labelledby="fig-title" onClick={e => e.stopPropagation()}>
        <h3 id="fig-title">{items.length ? `Numbers without a source` : "Every number is traced or cleared"}</h3>
        {items.length > 0 && <p>{describeFigureFlags(items.length, what)} Until then, {what} cannot be {verb}.</p>}
        <div className="fig-list">
          {items.map(x => {
            const k = key(x);
            const at = x.text.indexOf(x.f.figure);
            return (
              <div key={k} className="pl-flag">
                <div className="pl-flag-line"><span className="pl-fig">{x.f.figure}</span>
                  <span className="pl-ctx">Q{x.question}: {at > 60 ? "…" : ""}{x.text.slice(Math.max(0, at - 60), at)}<mark>{x.f.figure}</mark>{x.text.slice(at + x.f.figure.length, at + x.f.figure.length + 60)}…</span></div>
                <div className="ov-muted pl-why">{x.f.where === "card" ? "Not in this card's sources." : "Not in the sources of any card in this answer."}</div>
                <div className="pl-clear">
                  <input value={reasons[k] ?? ""} onChange={e => setReasons(r => ({ ...r, [k]: e.target.value }))} maxLength={CLEAR_REASON_MAX}
                    placeholder="Why it is right (optional)" aria-label="Why the number is right (optional)" />
                  <button type="button" className="btn secondary ap-mini" disabled={busy === k} onClick={async () => {
                    setBusy(k); setErr(null);
                    const e = await onClear(x.f, x.sectionId, reasons[k] ?? "");
                    setBusy(null); if (e) setErr(e);
                  }}>It&rsquo;s right: clear it</button>
                  <button type="button" className="btn ghost ap-mini" onClick={() => onGo(x.sectionId)}>Change it in Polish</button>
                </div>
              </div>
            );
          })}
        </div>
        {err && <div className="ap-error">{err}</div>}
        <div className="ws-modal-acts">
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
          {then && <button type="button" className="btn inline ap-go" disabled={items.length > 0} onClick={onContinue}>Continue</button>}
        </div>
      </div>
    </div>
  );
}

/** The page's description, behind an ⓘ that opens on hover. */
function About({ standard, tenantName, meta }: { standard: boolean; tenantName: string; meta: string | null }) {
  return (
    <span className="ws-about-wrap">
      {meta && <span className="ws-meta">{meta}</span>}
      <InfoTip label={standard ? "About Standard Answers" : "About this page"}>
        {standard
          ? <>The questions funders ask again and again, answered once from {tenantName}&rsquo;s Story Cards. An approved answer can start any application&rsquo;s matching question. Lengths shown are typical, not limits.</>
          : <>This application&rsquo;s questions, answered from {tenantName}&rsquo;s Story Cards. Drag cards into the answer, or use Auto-draft; every sentence keeps its source. Weave then reads it as prose, with short bridges between the cards for you to accept or reject. Polish comes next.</>}
      </InfoTip>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The card panel.
// ---------------------------------------------------------------------------

function CardPanel({ sectionId, ranked, usedWhere, current, statusNow, wantedKinds, locked, onAdd, open, onClose, removing, onNewText, canDragNew, kindRequest }: {
  /** The gap panel's Show them: filter to this kind (n changes on each press). */
  kindRequest: { kind: string; n: number } | null;
  /** The blank "New text" box at the top: click to add at the end, or drag it into place. */
  onNewText: (() => void) | null; canDragNew: boolean;
  sectionId: string; ranked: Ranked[]; usedWhere: Map<string, number[]>; current: number;
  statusNow: Record<string, "verified" | "retired">;
  wantedKinds: string[]; locked: boolean; onAdd: (cardId: string) => void;
  /** Small screens: the panel is a drawer, opened from the action bar. */
  open: boolean; onClose: () => void;
  /** A placed block is being dragged: the panel is where it can be dropped to remove it. */
  removing: boolean;
}) {
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: "panel" });
  const [kind, setKind] = useState("");
  const [layer, setLayer] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PANEL_SIZE);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [userOnly, setUserOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const logged = useRef(new Set<string>());
  // Show them, from the gap panel (adjusting state while rendering, as for props).
  const [seenRequest, setSeenRequest] = useState(kindRequest?.n ?? 0);
  if (kindRequest && kindRequest.n !== seenRequest) {
    setSeenRequest(kindRequest.n);
    setKind(kindRequest.kind); setLayer(""); setQ(""); setVerifiedOnly(false); setUserOnly(false); setLimit(PANEL_SIZE);
  }

  const statusOf = (c: WsCard) => statusNow[c.id] ?? c.status;
  const filtering = !!(kind || layer || q.trim() || verifiedOnly || userOnly);
  const list = ranked.filter(r => {
    if (statusNow[r.card.id] === "retired") return false;
    if (verifiedOnly && statusOf(r.card as WsCard) !== "verified") return false;
    if (userOnly && (r.card as WsCard).createdFrom !== "manual") return false;
    if (kind === "__wanted" && !wantedKinds.includes(r.card.kind)) return false;
    if (kind && kind !== "__wanted" && r.card.kind !== kind) return false;
    if (layer && r.card.layer !== layer) return false;
    if (q.trim()) {
      const n = q.trim().toLowerCase();
      const c = r.card as WsCard;
      const label = c.createdFrom === "manual" ? `${USER_GENERATED} ${c.sourceLine ?? ""}` : "";
      if (!`${c.statement} ${label} ${c.evidence.map(e => `${e.quote} ${e.title}`).join(" ")}`.toLowerCase().includes(n)) return false;
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
    <aside ref={dropRef} className={`ws-panel${open ? " ws-panel-open" : ""}${removing ? " ws-panel-removing" : ""}${removing && isOver ? " ws-panel-over" : ""}`} aria-label="Story Cards">
      {removing && <div className="ws-remove-zone" aria-hidden="true">{isOver ? "Release to remove" : "Drop here to remove"}</div>}
      <div className="ws-panel-head">
        <strong>Story Cards</strong>
        <span className="ov-muted">{ranked.length} available, best first</span>
        <button type="button" className="bn-x ws-panel-close" onClick={onClose} aria-label="Close Story Cards">×</button>
      </div>
      {/* Storyboard cleanup (17 October 2026): search and one Filters toggle; the
          filters themselves fold away, and a Showing line names any that are on. */}
      <div className="ws-filters">
        <input className="ws-search" type="search" placeholder="Search cards and quotes" aria-label="Search cards and quotes" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className={`sb-btn sb-secondary ws-filter-btn${filtersOpen ? " mb-open" : ""}`} aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(o => !o)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          Filters</button>
      </div>
      {filtersOpen && (
        <div className="ws-filter-box">
          <label className="ws-filter-field">Kind
            <select value={kind} onChange={e => { setKind(e.target.value); setLimit(PANEL_SIZE); }}>
              <option value="">All kinds</option>
              {wantedKinds.length > 0 && <option value="__wanted">This question&rsquo;s kinds</option>}
              {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <fieldset className="ws-filter-field">
            <legend>Layer</legend>
            <div className="ws-layer-chips">
              {["", "I", "II", "III"].map(l => (
                <button key={l || "all"} type="button" aria-pressed={layer === l} className={`ws-layer-chip${layer === l ? " active" : ""}`}
                  onClick={() => { setLayer(l); setLimit(PANEL_SIZE); }}>
                  {l && <span className={`ws-ldot ${layerClass(l)}`} aria-hidden="true" />}{l ? LAYER_NAME[l] : "All"}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="ws-check" title="Only cards a person has verified. Others can still be used: adding one opens its review.">
            <input type="checkbox" checked={verifiedOnly} onChange={e => { setVerifiedOnly(e.target.checked); setLimit(PANEL_SIZE); }} /> Verified only
          </label>
          <label className="ws-check" title="Only cards a person wrote, not ones read from documents">
            <input type="checkbox" checked={userOnly} onChange={e => { setUserOnly(e.target.checked); setLimit(PANEL_SIZE); }} /> {USER_GENERATED} only
          </label>
        </div>
      )}
      {!filtersOpen && (kind || layer || verifiedOnly || userOnly) && (
        <div className="ws-showing">
          <span>Showing:</span>
          {kind && <span className="ws-showing-chip">{kind === "__wanted" ? "This question’s kinds" : kinds.find(([k]) => k === kind)?.[1] ?? kind}</span>}
          {layer && <span className="ws-showing-chip">{LAYER_NAME[layer]}</span>}
          {verifiedOnly && <span className="ws-showing-chip">Verified only</span>}
          {userOnly && <span className="ws-showing-chip">{USER_GENERATED}</span>}
          <button type="button" className="ws-inline-link" onClick={() => { setKind(""); setLayer(""); setVerifiedOnly(false); setUserOnly(false); setLimit(PANEL_SIZE); }}>Clear</button>
        </div>
      )}
      {onNewText && <NewTextChip onClick={onNewText} canDrag={canDragNew} />}
      {shown.length === 0 && <p className="cl-note">{ranked.length ? "Nothing matches these filters." : "No cards left to place. Build the Card Library, or remove a card from the answer to bring it back."}</p>}
      <div className="ws-cards">
        {shown.map(r => (
          <PanelCard key={r.card.id} r={r} verified={statusOf(r.card as WsCard) === "verified"}
            used={(usedWhere.get(r.card.id) ?? []).filter(n => n !== current)} locked={locked} onAdd={onAdd} />
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

/** A blank text box at the top of the Story Cards: drag it into the answer, or click to add it at the end. */
function NewTextChip({ onClick, canDrag }: { onClick: () => void; canDrag: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: "newtext", data: { type: "newtext" }, disabled: !canDrag });
  return (
    <div ref={setNodeRef} className={`ws-newtext${isDragging ? " ws-ghost" : ""}`}>
      <span className={canDrag ? "ws-grab ws-newtext-grab" : "ws-newtext-grab"} {...listeners} {...attributes}
        title={canDrag ? "Drag into the answer where the text should go" : undefined} aria-label="New text: drag into the answer">
        <span className="ws-handle" aria-hidden="true">⠿</span> <strong>＋ New text</strong>
      </span>
      <span className="ws-newtext-hint">{canDrag ? "drag into place" : ""}</span>
      <button type="button" className="ws-inline-link" onClick={onClick}>Add at the end</button>
    </div>
  );
}

function PanelCard({ r, verified, used, locked, onAdd }: { r: Ranked; verified: boolean; used: number[]; locked: boolean; onAdd: (id: string) => void }) {
  const c = r.card as WsCard;
  const [open, setOpen] = useState(false);
  const ok = placeable(c);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `card:${c.id}`, data: { type: "card", cardId: c.id }, disabled: !ok,
  });
  return (
    <div ref={setNodeRef} className={`ws-card ${layerClass(c.layer)}${c.strength === "thin" ? " cl-thin" : ""}${isDragging ? " ws-ghost" : ""}`}>
      <div className={`cl-card-head${ok ? " ws-grab" : ""}`} {...listeners} {...attributes}
        aria-label={`Drag into the answer: ${c.statement.slice(0, 60)}`} title={ok ? "Drag into the answer" : undefined}>
        <span className="ws-handle" aria-hidden="true">⠿</span>
        <span className="cl-kind">{c.kindLabel}</span>
        {c.layer && <span className="cl-layer">· {LAYER_NAME[c.layer]}</span>}
        {c.createdFrom === "manual" && <span className="uc-tag" title={c.sourceLine ?? undefined}>{USER_GENERATED}</span>}
        <span className="cl-spacer" />
        {verified ? <span className="cl-badge cl-badge-ok">Verified</span>
          : <span className="cl-badge ws-badge-review" title="Not yet verified. Dropping it in, or pressing Review, opens its review first.">Needs review</span>}
      </div>
      <p className="cl-statement">{c.statement}</p>
      <div className="ws-reason">{reasonFor(r, c.kindLabel, c.newestSource)}</div>
      {!ok && (
        <div className="ws-warn ws-soft">Sensitive: {c.sensitiveReason ?? "it may identify a person's protected information."} Record consent,
          de-identify it, or rule it not sensitive in the <a href="/admin/card-library">Card Library</a> before placing it.</div>
      )}
      <div className="ws-card-foot">
        {used.length > 0 && <span className="ws-used" title="Already used in another answer of this application">In Q{used.join(", Q")}</span>}
        <span className="cl-spacer" />
        <button type="button" className="ws-inline-link ws-quiet-link" onClick={() => setOpen(o => !o)}>{open ? "Hide sources" : `Sources (${c.evidence.length})`}</button>
        <button type="button" className="sb-btn sb-secondary sb-sm ws-edit-only" disabled={locked || !ok} onClick={() => onAdd(c.id)}
          title={ok ? (verified ? "Add it at the end of the answer" : "Opens the card's review; verifying it adds it") : "Sensitive: decide it in the Card Library first"}>{verified || !ok ? "Add" : "Review"}</button>
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

function AnswerColumn({ blocks, cardById, gateCard, locked, editing, setEditing, onMove, onRemove, onEdit, onBreak, onRefresh, onKeep, onAcceptSuggestion, onRejectSuggestion, empty, dropBefore, dropAtEnd, onInsert, onSaveCard, onSaveWording }: {
  blocks: WsBlock[]; cardById: Map<string, WsCard>; gateCard: (id: string) => GateCard | null; locked: boolean;
  /** Add text at this position: the "+" between pieces. */
  onInsert: (position: number) => void;
  onSaveCard: (b: WsBlock) => void; onSaveWording: (id: string) => Promise<unknown>;
  /** While a card from the panel is dragged: the block it would land before, or the end. */
  dropBefore: string | null; dropAtEnd: boolean;
  editing: string | null; setEditing: (id: string | null) => void;
  onMove: (from: number, to: number) => void; onRemove: (id: string) => void;
  onEdit: (id: string, text: string) => Promise<unknown>; onBreak: (id: string, v: boolean) => Promise<unknown>;
  onRefresh: (id: string) => Promise<unknown>; onKeep: (id: string) => Promise<unknown>; empty: ReactNode;
  onAcceptSuggestion: (id: string, shown: string, text?: string) => Promise<unknown>; onRejectSuggestion: (id: string) => Promise<unknown>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "answer" });
  return (
    <div ref={setNodeRef} className={`ws-answer${isOver ? " ws-over" : ""}`} aria-label="The answer">
      {blocks.length === 0 ? empty : (
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((b, i) => (
            <div key={b.id} className="ws-row">
            {!locked && <InsertLine onClick={() => onInsert(i)} />}
            <BlockRow block={b} index={i} last={i === blocks.length - 1} dropBefore={dropBefore === b.id}
              onSaveCard={onSaveCard} onSaveWording={onSaveWording}
              card={b.cardId ? cardById.get(b.cardId) : undefined} locked={locked}
              blocked={b.kind === "card" && b.cardId ? placeIssue(gateCard(b.cardId)) : null}
              editing={editing === b.id} setEditing={setEditing}
              onMove={onMove} onRemove={onRemove} onEdit={onEdit} onBreak={onBreak} onRefresh={onRefresh} onKeep={onKeep}
              onAcceptSuggestion={onAcceptSuggestion} onRejectSuggestion={onRejectSuggestion} />
            </div>
          ))}
          {!locked && <InsertLine onClick={() => onInsert(blocks.length)} />}
        </SortableContext>
      )}
      <div className={`ws-dropzone${dropAtEnd && blocks.length ? " ws-drop-line" : ""}`}>{blocks.length ? "Drop a card here to add it at the end" : null}</div>
    </div>
  );
}

/** The thin "+" between two pieces of the answer: click to add text exactly there. */
function InsertLine({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="ws-ins" onClick={onClick} title="Add text here" aria-label="Add text here">
      <span className="ws-ins-plus" aria-hidden="true">＋ Add text here</span>
    </button>
  );
}

/** Once new text is written: the writer's own words in this answer, or a Story Card for every answer? */
function ChoiceDialog({ text, onOwn, onCard }: { text: string; onOwn: () => void; onCard: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOwn(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOwn]);
  return (
    <div className="ws-modal-back" role="presentation" onClick={onOwn}>
      <div className="ws-modal" role="dialog" aria-modal="true" aria-labelledby="uc-choice" onClick={e => e.stopPropagation()}>
        <h3 id="uc-choice">What is this text?</h3>
        <p className="uc-quote">{text.slice(0, 280)}{text.length > 280 ? "…" : ""}</p>
        <div className="uc-choices">
          <button type="button" className="uc-choice" onClick={onOwn} autoFocus>
            <strong>Your words in this answer</strong>
            <span>Connecting text, or something only this answer needs. It stays in this draft.</span>
          </button>
          <button type="button" className="uc-choice" onClick={onCard}>
            <strong>A new Story Card</strong>
            <span>A fact or a story worth using again. Saved to the Story Cards, ready for any answer.</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyAnswer({ std, onStart }: { std?: WsStandard; onStart: () => void }) {
  return (
    <div className="ws-empty-answer">
      <p>Drag Story Cards here, or press <strong>Add</strong> (or <strong>Review</strong>) on one. Cards go in the order you place them, and you can move them afterwards.
        Or press <strong>Auto-draft this question</strong> below to have the best cards placed for you.</p>
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

function BlockRow({ block: b, index, last, card, blocked, locked, editing, setEditing, onMove, onRemove, onEdit, onBreak, onRefresh, onKeep, onAcceptSuggestion, onRejectSuggestion, dropBefore, onSaveCard, onSaveWording }: {
  block: WsBlock; index: number; last: boolean; card?: WsCard; locked: boolean; dropBefore: boolean;
  onAcceptSuggestion: (id: string, shown: string, text?: string) => Promise<unknown>; onRejectSuggestion: (id: string) => Promise<unknown>;
  onSaveCard: (b: WsBlock) => void; onSaveWording: (id: string) => Promise<unknown>;
  /** What stops this card leaving in an answer, from lib/card-gate.ts. */
  blocked: string | null;
  editing: boolean; setEditing: (id: string | null) => void;
  onMove: (from: number, to: number) => void; onRemove: (id: string) => void;
  onEdit: (id: string, text: string) => Promise<unknown>; onBreak: (id: string, v: boolean) => Promise<unknown>;
  onRefresh: (id: string) => Promise<unknown>; onKeep: (id: string) => Promise<unknown>;
}) {
  const temp = b.id.startsWith("tmp-");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: b.id, disabled: temp || locked });
  const [text, setText] = useState(b.text);
  const [showSrc, setShowSrc] = useState(false);
  // The latest typed text and whether it was cancelled, read by blur as well as
  // the buttons, so a blur fired while the editor closes never saves stale text.
  const live = useRef({ text: b.text, cancelled: false });
  const startEdit = () => {
    if (temp || locked) return;
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
      className={`ws-block ws-${b.kind} ${isCard ? layerClass(card?.layer ?? null) : ""}${isDragging ? " ws-ghost" : ""}${b.breakBefore && index > 0 ? " ws-para" : ""}${dropBefore ? " ws-drop-before" : ""}`}>
      <div className="ws-block-head ws-grab" {...listeners} {...attributes} aria-label="Drag to reorder, or onto Story Cards to remove"
        title="Drag to reorder, or onto Story Cards to remove">
        <span className="ws-handle" aria-hidden="true">⠿</span>
        <span className="cl-kind">{isCard ? card?.kindLabel ?? "Story Card" : b.kind === "human" ? "Your words" : "Bridge"}</span>
        {isCard && card?.layer && <span className="cl-layer ws-block-layer">· {LAYER_NAME[card.layer]}</span>}
        {b.kind === "bridge" && b.proposed && <span className="ov-tag" title="Proposed in Weave and not accepted yet, so it is not part of the answer.">Proposed, not in the answer</span>}
        {isCard && b.edited && <span className="ov-tag" title="Changed in this draft only. The library card is unchanged.">Edited here</span>}
        {isCard && b.suggested && <span className="ov-tag ws-tag-sugg" title="Auto-draft suggests new wording for this card. Accept, edit or reject it before this answer can leave.">New wording suggested</span>}
        {isCard && card?.createdFrom === "manual" && <span className="uc-tag" title={card.sourceLine ?? USER_GENERATED}>{USER_GENERATED}</span>}
        {isCard && blocked === "unverified" && <span className="ov-tag ws-tag-review" title="Placed before verification was required, or un-verified since. Review it before this answer is used.">Needs review</span>}
        {isCard && blocked === "retired" && <span className="ov-tag ws-tag-sens" title="Retired from the library. Remove it before this answer is used.">Retired card</span>}
        {isCard && card && !placeable(card) && <span className="ov-tag ws-tag-sens" title={card.sensitiveReason ?? ""}>Sensitive, undecided</span>}
        <span className="cl-spacer" />
        {/* Controls in the grab area stay controls: they never start a drag. */}
        <span className="ws-head-controls ws-edit-only" onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        {index > 0 && (
          <label className="ws-break" title="Start a new paragraph with this block">
            <input type="checkbox" checked={b.breakBefore} disabled={temp || locked} onChange={e => void onBreak(b.id, e.target.checked)} /> ¶
          </label>
        )}
        <button type="button" className="sb-btn sb-quiet sb-icon sb-sm" disabled={temp || locked || index === 0} onClick={() => onMove(index, index - 1)} aria-label="Move up" title="Move up">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg></button>
        <button type="button" className="sb-btn sb-quiet sb-icon sb-sm" disabled={temp || locked || last} onClick={() => onMove(index, index + 1)} aria-label="Move down" title="Move down">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg></button>
        <button type="button" className="sb-btn sb-quiet sb-icon sb-sm" disabled={temp || locked} onClick={() => onRemove(b.id)} aria-label="Remove from the answer" title="Remove from the answer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </span>
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
          data-piece="" data-piece-index={index}
          onClick={startEdit} onKeyDown={e => { if (e.key === "Enter") startEdit(); }}>
          {b.text || "Click to write…"}
        </p>
      )}

      {untraced.length > 0 && (
        <div className="ws-warn">{untraced.join(", ")} {untraced.length === 1 ? "is" : "are"} not in this card&rsquo;s sources. Until it is traced, changed or cleared in Polish, this answer cannot leave.</div>
      )}
      {isCard && b.suggested && !editing && (
        <SuggestedWording key={`${b.id}:${b.suggested}`} current={b.text} suggested={b.suggested} locked={locked || temp}
          onAccept={t => onAcceptSuggestion(b.id, b.suggested!, t)} onReject={() => onRejectSuggestion(b.id)} />
      )}
      {reworded && (
        <div className="ws-warn ws-soft">
          This card was reworded in the library since you placed it, so this answer cannot leave until you choose.{" "}
          <button type="button" className="cl-link" onClick={() => void onRefresh(b.id)}>Use the new wording</button>{" "}
          or <button type="button" className="cl-link" onClick={() => void onKeep(b.id)}>keep this wording</button>
        </div>
      )}
      {isCard && b.edited && !editing && !locked && (
        <span className="ws-row-links">
          <button type="button" className="cl-link ws-revert" onClick={() => void onRefresh(b.id)}
            title="Drop the edit and use the card's current wording from the library">Use the card&rsquo;s wording</button>
          <button type="button" className="cl-link" onClick={() => void onSaveWording(b.id)}
            title="Make this wording the card's own, in the Card Library, for every answer">Save this wording to the Card Library</button>
        </span>
      )}
      {b.kind === "human" && !editing && !locked && b.text.trim() && (
        <button type="button" className="cl-link ws-revert" onClick={() => onSaveCard(b)}
          title="Save these words as a Story Card, ready for any answer">Save as a Story Card</button>
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

/** Copy answer, as an item in the action bar's More menu. The finish line still applies: a blocked answer opens what blocks it. */
function CopyItem({ text, blocked, onBlocked, onCopied }: { text: string; blocked: boolean; onBlocked: () => void; onCopied: () => void }) {
  return (
    <MenuItem title="Copy answer" disabled={!text}
      hint={blocked ? "Something in this answer needs dealing with first" : "To paste into the funder's form"}
      onClick={async () => {
        if (blocked) { onBlocked(); return; }
        try { await navigator.clipboard.writeText(text); onCopied(); }
        catch { prompt("Copy the answer:", text); }
      }} />
  );
}

// ---------------------------------------------------------------------------
// Show seams: where each part of the answer came from.
// ---------------------------------------------------------------------------

/**
 * The answer as one text, each part marked by its origin. Honest about
 * authorship: a card's wording is the reader's phrasing of a quote from the
 * client's documents, not the client's own sentence; an edited card is a writer
 * changing that phrasing; "your words" are a writer's own; a bridge is
 * connecting text drafted with AI in Weave and accepted (or edited) by a writer.
 */
function SeamsView({ blocks: all }: { blocks: WsBlock[] }) {
  // Proposed bridges are suggestions, not part of the answer.
  const blocks = all.filter(b => !b.proposed);
  const cls = (b: WsBlock) => b.kind === "human" ? "seam-human" : b.kind === "bridge" ? "seam-bridge" : b.edited ? "seam-edited" : "seam-card";
  return (
    <div className="ws-seams" aria-label="The answer, marked by source">
      <div className="ws-seams-key">
        <span className="seam-card">From a Story Card (phrased from a quote)</span>
        <span className="seam-edited">Story Card, edited by the writer</span>
        <span className="seam-human">Written by the writer</span>
        {blocks.some(b => b.kind === "bridge") && <span className="seam-bridge">Bridge drafted with AI, accepted by the writer</span>}
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

// ---------------------------------------------------------------------------
// Asking before a removal.
// ---------------------------------------------------------------------------

function RemoveDialog({ block, askAgain, onKeep, onRemove }: {
  block: WsBlock; askAgain: boolean; onKeep: () => void; onRemove: (dontAskAgain: boolean) => void;
}) {
  const [dontAsk, setDontAsk] = useState(false);
  const own = block.kind !== "card";
  // "Don't ask me again" is offered only for a plain card: edited cards and your
  // own writing always ask, so offering it there would be a promise not kept.
  const offerSkip = !own && !block.edited && askAgain;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onKeep(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKeep]);
  return (
    <div className="ws-modal-back" role="presentation" onClick={onKeep}>
      <div className="ws-modal" role="alertdialog" aria-modal="true" aria-labelledby="ws-rm-title" onClick={e => e.stopPropagation()}>
        <h3 id="ws-rm-title">{own ? "Delete this text?" : "Remove this card from your answer?"}</h3>
        {own
          ? <p>Your own writing does not come back from the Story Cards panel. You can undo for a few seconds afterwards.</p>
          : <p>It goes back to your Story Cards, ready to use again.{block.edited ? " Your edits to this card in this draft will be lost." : ""}</p>}
        {offerSkip && (
          <label className="ws-modal-check">
            <input type="checkbox" checked={dontAsk} onChange={e => setDontAsk(e.target.checked)} /> Don&rsquo;t ask me again
          </label>
        )}
        <div className="ws-modal-acts">
          <button type="button" className="btn secondary" onClick={onKeep} autoFocus>Keep</button>
          <button type="button" className="btn inline ws-modal-remove" onClick={() => onRemove(offerSkip && dontAsk)}>{own ? "Delete" : "Remove"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Versions and submitting.
// ---------------------------------------------------------------------------

function VersionsDrawer({ draftId, readOnly, onClose, onRestored }: {
  draftId: string; readOnly: boolean; onClose: () => void; onRestored: (r: { restored: number; skipped: number }) => void;
}) {
  const [items, setItems] = useState<VersionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ id: string; label: string; takenAt: string; diffs: SectionDiff[] } | null>(null);
  const load = useCallback(() => listVersionsAction(draftId).then(setItems).catch(e => (setItems([]), setError(e instanceof Error ? e.message : "Could not read the versions."))), [draftId]);
  useEffect(() => { void load(); }, [load]);
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="ws-modal-back" role="presentation" onClick={onClose}>
      <aside className="ws-versions" role="dialog" aria-modal="true" aria-label="Versions" onClick={e => e.stopPropagation()}>
        <div className="ws-versions-head">
          <h3>{open ? open.label : "Versions"}</h3>
          <button type="button" className="bn-x" onClick={open ? () => setOpen(null) : onClose} aria-label={open ? "Back to the list" : "Close"}>{open ? "←" : "×"}</button>
        </div>
        {error && <div className="ap-error">{error}</div>}
        {!open && (
          <>
            {!readOnly && (
              <div className="ws-version-save">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Name this version (optional), e.g. Sent to Ashley" maxLength={120} />
                <button type="button" className="btn secondary" disabled={busy} onClick={async () => {
                  setBusy(true); setError(null);
                  try { await saveVersionAction(draftId, name); setName(""); await load(); }
                  catch (e) { setError(e instanceof Error ? e.message : "Could not save a version."); }
                  finally { setBusy(false); }
                }}>Save a version</button>
              </div>
            )}
            <p className="ov-muted ws-version-note">Every change is already saved as you work. Versions are checkpoints: saved before each stage, when marked completed or submitted, every ten minutes of editing, and whenever you save one here.</p>
            {items === null ? <p className="ov-muted">Loading…</p> : items.length === 0 ? <p className="ov-muted">No versions yet.</p> : (
              <ul className="ws-version-list">
                {items.map(v => (
                  <li key={v.id}>
                    <button type="button" className="ws-version-item" onClick={async () => {
                      setError(null);
                      try { const r = await compareVersionAction(draftId, v.id); setOpen({ id: v.id, ...r }); }
                      catch (e) { setError(e instanceof Error ? e.message : "Could not open that version."); }
                    }}>
                      <strong>{v.label}</strong>
                      <span>{when(v.takenAt)}{v.by ? ` · ${v.by}` : ""}{v.stage ? ` · ${v.stage[0].toUpperCase()}${v.stage.slice(1)}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {open && (
          <div className="ws-version-view">
            <p className="ov-muted">Saved {when(open.takenAt)}. Each question as it was then, beside how it reads now. Changed questions are marked.</p>
            {open.diffs.map(d => (
              <div key={d.sectionId} className={`ws-diff${d.changed ? " ws-diff-changed" : ""}`}>
                <div className="ws-diff-q">{d.prompt}{d.missing ? " (no longer in this application)" : d.changed ? " · changed" : " · same"}</div>
                {d.changed ? (
                  <div className="ws-diff-cols">
                    <div><span className="ws-diff-h">Then</span><p>{d.before || <em>empty</em>}</p></div>
                    <div><span className="ws-diff-h">Now</span><p>{d.missing ? <em>question removed</em> : d.now || <em>empty</em>}</p></div>
                  </div>
                ) : <p className="ws-diff-same">{d.before ? `${d.before.slice(0, 200)}${d.before.length > 200 ? "…" : ""}` : <em>empty</em>}</p>}
              </div>
            ))}
            {!readOnly && (
              <div className="ws-modal-acts">
                <button type="button" className="btn inline ap-go" disabled={busy} onClick={async () => {
                  if (!confirm(`Restore "${open.label}"? The application as it is now is saved as a version first, so this can be undone.`)) return;
                  setBusy(true); setError(null);
                  try { onRestored(await restoreVersionAction(draftId, open.id)); }
                  catch (e) { setError(e instanceof Error ? e.message : "Could not restore that version."); setBusy(false); }
                }}>Restore this version</button>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function SubmitDialog({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (date: string) => void }) {
  const [date, setDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  return (
    <div className="ws-modal-back" role="presentation" onClick={onCancel}>
      <div className="ws-modal" role="alertdialog" aria-modal="true" aria-labelledby="ws-sub-title" onClick={e => e.stopPropagation()}>
        <h3 id="ws-sub-title">Mark this application submitted?</h3>
        <p>A version is saved as the copy the funder received, and the application is locked. To change it afterwards, start a new version from it.</p>
        <label className="ws-modal-check">Submitted on <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: "auto" }} /></label>
        <div className="ws-modal-acts">
          <button type="button" className="btn secondary" onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className="btn inline ap-go" onClick={() => onSubmit(date)}>Mark submitted</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviewing a card before it is used, and the finish line.
// ---------------------------------------------------------------------------

/**
 * The Card Library's own review card, opened where the card is about to be
 * used. In `place` mode, verifying it (or editing it, which counts as
 * verifying) puts it into the answer where it was dropped; retiring it sends it
 * away. Cancel places nothing.
 */
function ReviewDialog({ cardId, mode, note, left, onAction, onSkip, onClose }: {
  cardId: string; mode: "place" | "review"; note?: string; left: number;
  onAction: (what: ReviewOutcome) => void; onSkip: () => void; onClose: () => void;
}) {
  const [card, setCard] = useState<LibraryCard | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    getReviewCardAction(cardId)
      .then(c => { if (live) setCard(c); })
      .catch(e => { if (live) { setCard(null); setError(e instanceof Error ? e.message : "Could not open the card."); } });
    return () => { live = false; };
  }, [cardId, reload]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handle = (what: ReviewOutcome) => {
    // Verified, retired and merged move on. Anything else (a sensitive decision
    // recorded, say) leaves the card on screen, read again, still to verify.
    if (what === "verified" || what === "retired" || what === "merged") onAction(what);
    else setReload(n => n + 1);
  };

  return (
    <div className="ws-modal-back" role="presentation" onClick={onClose}>
      <div className="ws-modal ws-review" role="dialog" aria-modal="true" aria-labelledby="ws-rv-title" onClick={e => e.stopPropagation()}>
        <h3 id="ws-rv-title">{mode === "place" ? "Review this card before it goes in" : "Review this card"}</h3>
        <p className="ov-muted">{note ?? (mode === "place"
          ? "Only verified cards go into a grant. Read the card against its quote: verify it if the quote fully supports it, edit it if the wording needs fixing (that verifies it too), or take it out of use."
          : "Read the card against its quote: verify it, edit it (that verifies it too), or take it out of use.")}</p>
        {card === undefined && <p className="ov-muted">Opening the card…</p>}
        {card === null && <div className="ap-error">{error ?? "That card is no longer in this client's library."}</div>}
        {card && (card.status === "verified" && mode === "review"
          ? <p className="ov-muted">This card is already verified.</p>
          : <CardReview card={card} onAction={handle}
              verifyLabel={mode === "place" ? "Verify and place" : "Verify"}
              editSaveLabel={mode === "place" ? "Save, verify and place" : "Save and verify"} />)}
        <div className="ws-modal-acts">
          {left > 0 && <button type="button" className="btn ghost" onClick={onSkip}>Skip this one ({left} more)</button>}
          <button type="button" className="btn secondary" onClick={onClose} autoFocus>{mode === "place" ? "Cancel, place nothing" : "Close"}</button>
        </div>
      </div>
    </div>
  );
}

/** What stands between this application (or answer) and the funder, one card at a time. */
function BlockersDialog({ list, what, then, onReview, onWording, onGo, onContinue, onClose }: {
  list: Blocker[]; what: string; then: "completed" | "submit" | "approve" | "weave" | null;
  onReview: (b: Blocker) => void; onGo: (b: Blocker) => void; onContinue: () => void; onClose: () => void;
  /** A reworded card: use the library's new wording, or keep the old wording on purpose. */
  onWording: (b: Blocker, keepOld: boolean) => void;
}) {
  const clear = list.length === 0;
  const action = then === "completed" ? "Mark completed" : then === "submit" ? "Mark submitted…" : then === "approve" ? "Approve this answer"
    : then === "weave" ? "Begin Weaving" : null;
  return (
    <div className="ws-modal-back" role="presentation" onClick={onClose}>
      <div className="ws-modal ws-blockers" role="dialog" aria-modal="true" aria-labelledby="ws-bl-title" onClick={e => e.stopPropagation()}>
        <h3 id="ws-bl-title">{clear ? "Every card is ready" : then === "weave" ? "Before weaving, review these cards" : "Some cards need review first"}</h3>
        <p className="ov-muted">{clear
          ? "Every card here is verified and live."
          : `${describeBlockers(list, what)} Every card in a grant must be verified by a person, any sensitive card decided, any retired card removed, and any card reworded since it was placed brought up to date or kept on purpose.`}</p>
        {!clear && (
          <ul className="ws-blocker-list">
            {list.map((b, i) => (
              <li key={`${b.cardId}-${i}`}>
                <span className="ws-q-num">Q{b.question}</span>
                <span className="ws-blocker-text">{(b.text || "").slice(0, 160)}{b.text.length > 160 ? "…" : ""}
                  <span className="ov-muted"> · {ISSUE_LABEL[b.issue]}</span></span>
                {b.issue === "reworded" && b.blockId ? (
                  <span className="ws-blocker-acts">
                    <button type="button" className="btn secondary ap-mini" onClick={() => onWording(b, false)}
                      title="Replace it with the card's current wording from the library">Use new wording</button>
                    <button type="button" className="btn ghost ap-mini" onClick={() => onWording(b, true)}
                      title="Keep the wording as placed. It becomes this draft's own edit; the library card is unchanged.">Keep this wording</button>
                  </span>
                ) : b.issue !== "retired"
                  ? <button type="button" className="btn secondary ap-mini" onClick={() => onReview(b)}>Review</button>
                  : <button type="button" className="btn ghost ap-mini" onClick={() => onGo(b)} title="Go to the question to remove it">Go to Q{b.question}</button>}
              </li>
            ))}
          </ul>
        )}
        <div className="ws-modal-acts">
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
          {clear && action && <button type="button" className="btn inline ap-go" onClick={onContinue}>{action}</button>}
        </div>
      </div>
    </div>
  );
}
