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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDraggable, useDroppable,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addCardBlockAction, addHumanBlockAction, approveStandardAnswerAction, arrangeForMeAction, editBlockAction,
  fillFromStandardsAction, logShownAction, openStandardAnswersAction,
  keepWordingAction, refreshBlockWordingAction, removeBlockAction, reorderBlocksAction, setBreakAction, setSectionDoneAction,
  restoreBlockAction, startFromStandardAction, tidyAction, type RemovedBlock,
  acceptBridgesAction, weaveSectionAction,
} from "@/lib/server/workspace-actions";
import WeaveView from "./WeaveView";
import WeaveReminder from "./WeaveReminder";
import InfoTip from "./InfoTip";
import { bridgeGaps } from "@/lib/weave";
import { setUiPrefAction } from "@/lib/server/account-actions";
import {
  autosaveVersionAction, compareVersionAction, enterStageAction, saveBeforeWeaveAction, listVersionsAction, newDraftFromAction, restoreVersionAction,
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
import { CARD_KIND_MAP, untracedFigures } from "@/lib/story-card";
import type { Workspace, WsBlock, WsCard, WsSection, WsStandard } from "@/lib/server/workspace";
import type { GrantDraft } from "@/lib/types";

const LAYER_NAME: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };
const STATUS_LABEL: Record<WsSection["status"], string> = { empty: "Not started", drafting: "Drafting", done: "Done" };
const SOURCE_LABEL: Record<string, string> = { paste: "pasted text", pdf: "a PDF", docx: "a Word file", url: "a web page", match: "Funder Matches" };

const layerClass = (l: string | null) => (l === "I" ? "l1" : l === "II" ? "l2" : l === "III" ? "l3" : "");

export default function DraftWorkspace({ tenantName, draft, ws, sourceText, initialQuestion, since, confirmRemove = true }: {
  tenantName: string; draft: GrantDraft; ws: Workspace; sourceText: string; initialQuestion: number;
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
  const [seams, setSeams] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Reviewing cards before they are used (decided 2 October 2026). `place` puts
  // each card into the answer once verified; `review` only verifies.
  const [review, setReview] = useState<{ mode: "place" | "review"; queue: { cardId: string; position: number | null }[]; note?: string } | null>(null);
  // Statuses changed in this page since it loaded, until the refresh catches up.
  const [statusNow, setStatusNow] = useState<Record<string, "verified" | "retired">>({});
  // The finish line: what stands in the way, and what to do once it is clear.
  const [blockers, setBlockers] = useState<{ scope: "draft" | "section"; then: "completed" | "submit" | "approve" | "weave" | null } | null>(null);
  // Weave: which stage the page shows, and the reminder before a weave runs.
  const [stage, setStage] = useState<"arrange" | "weave">(draft.stage === "weave" ? "weave" : "arrange");
  const [weaveAsk, setWeaveAsk] = useState<{ again: boolean } | null>(null);
  // Answers woven on this page that came back with no bridges: no "not woven yet" invitation for them.
  const [wovenHere, setWovenHere] = useState<Set<string>>(() => new Set());
  const [arrangeReview, setArrangeReview] = useState<string[] | null>(null);
  // Removing a block: which is being dragged, where a card would land, the
  // question being asked, and the Undo on offer.
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [askRemove, setAskRemove] = useState(confirmRemove);
  const [confirming, setConfirming] = useState<{ block: WsBlock; via: "button" | "drag" } | null>(null);
  const [undo, setUndo] = useState<{ sectionId: string; removed: RemovedBlock; label: string } | null>(null);
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
      const top = el.getBoundingClientRect().top + (document.querySelector(".main")?.scrollTop ?? 0);
      setSplitHeight(Math.max(420, window.innerHeight - top - 16));
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
    setIdx(i); setTidy(null); setEditing(null); setNotice(null); setPanelOpen(false); setArrangeReview(null);
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
  const noSensors = useSensors();
  const locked = pending > 0 || readOnly;

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
      text: cardById.get(cardId)?.statement ?? "", ownText: null, edited: false, breakBefore: false, proposed: false,
    };
    setBlocksBy(m => {
      const list = [...(m[section.id] ?? [])];
      list.splice(Math.min(position, list.length), 0, temp);
      return { ...m, [section.id]: list };
    });
    return run(() => addCardBlockAction(section.id, cardId, position, r ? { position: r.position, score: r.score } : null),
      putBlocks(section.id));
  }, [section, ranked, cardById, run, putBlocks]);

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
    setBlocksBy(m => ({ ...m, [section.id]: order.map(id => byId.get(id)!).filter(Boolean) }));
    void run(() => reorderBlocksAction(section.id, order, via), putBlocks(section.id));
  }, [section, blocks, run, putBlocks]);

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
    setDragging(d?.type === "card" && d.cardId ? cardById.get(d.cardId) ?? null : null);
    setActiveBlock(d?.type === "card" ? null : String(e.active.id));
  };
  const onDragOver = (e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null);
  const endDrag = () => { setDragging(null); setActiveBlock(null); setOverId(null); };

  // ---- Removing, with a question when it matters and Undo always ------------
  const doRemove = useCallback((b: WsBlock, via: "button" | "drag") => {
    if (!section) return;
    const position = blocks.findIndex(x => x.id === b.id);
    const removed: RemovedBlock = {
      kind: b.kind, cardId: b.cardId, cardVersion: b.cardVersion, text: b.ownText,
      edited: b.edited, breakBefore: b.breakBefore, position: Math.max(0, position), proposed: b.proposed,
    };
    const sectionId = section.id;
    setBlocksBy(m => ({ ...m, [sectionId]: (m[sectionId] ?? []).filter(x => x.id !== b.id) }));
    void run(() => removeBlockAction(sectionId, b.id, via), next => {
      putBlocks(sectionId)(next);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndo({ sectionId, removed, label: b.kind === "card" ? "Card removed. It is back among your Story Cards."
        : b.kind === "bridge" ? (b.proposed ? "Bridge rejected." : "Bridge removed.") : "Text removed." });
      undoTimer.current = setTimeout(() => setUndo(null), 8_000);
    });
  }, [section, blocks, run, putBlocks]);

  /** Edited cards and your own writing always ask; a plain card asks until "Don't ask me again". */
  const requestRemove = useCallback((b: WsBlock, via: "button" | "drag") => {
    // A bridge Weave wrote is rejected at once (Undo brings it back); one a writer edited asks first.
    const mustAsk = b.kind === "card" ? b.edited || askRemove : b.kind === "bridge" ? b.edited : !!b.text.trim();
    if (mustAsk) setConfirming({ block: b, via }); else doRemove(b, via);
  }, [askRemove, doRemove]);

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
  // The finish line, for this question and for the whole application.
  const allBlocks = sections.flatMap(s => blocksBy[s.id] ?? []);
  const draftBlockers = finishBlockers(sections, allBlocks, gateCard);
  const sectionBlockers = draftBlockers.filter(b => b.sectionId === section.id);
  /** Run `then` once the finish line is clear, or show what stands in the way. */
  const atFinishLine = (scope: "draft" | "section", then: "completed" | "submit" | "approve", next: () => void) => {
    const list = scope === "draft" ? draftBlockers : sectionBlockers;
    if (list.length) setBlockers({ scope, then }); else next();
  };

  // ---- Weave ---------------------------------------------------------------
  // Gaps a bridge could fill once earlier, unaccepted proposals are cleared.
  const weavePieces = blocks.filter(b => !b.proposed).map(b => ({ id: b.id, kind: b.kind, text: b.text, breakBefore: b.breakBefore }));
  const weaveGaps = bridgeGaps(weavePieces).length;
  const proposedCount = blocks.filter(b => b.proposed).length;
  const hasBridges = blocks.some(b => b.kind === "bridge");

  const switchStage = (st: "arrange" | "weave") => {
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
    if (sectionBlockers.length) { setBlockers({ scope: "section", then: "weave" }); return; }
    if (weaveBlockedWhy) { say(weaveBlockedWhy); return; }
    setWeaveAsk({ again: hasBridges });
  };

  const doWeave = () => {
    setWeaveAsk(null);
    const sectionId = section.id;
    // The "Before Weave" version is taken now, just before bridges are written
    // (skipped when nothing changed since the last version).
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

  return (
    <div className={`ws ws-page${readOnly ? " ws-readonly" : ""}`}>
      <header className="ws-top">
        <h2 className="ws-title">{draft.title}</h2>
        <About standard={standard} tenantName={tenantName}
          meta={standard ? null : [draft.funder, money, draft.deadline ? `due ${new Date(draft.deadline + "T12:00:00").toLocaleDateString()}` : null].filter(Boolean).join(" · ")} />
        {!standard && <span className={`status-pill ${draft.status ?? "drafting"}`}>{STATUS_NAME[(draft.status ?? "drafting") as DraftStatus]}</span>}
        <span className="spacer" />
        {!standard && !readOnly && (draft.status === "completed"
          ? <>
              <button type="button" className="btn ghost ap-mini" disabled={locked} onClick={() => void run(() => setDraftStatusAction(draft.id, "drafting"), () => router.refresh())}>Back to drafting</button>
              <button type="button" className="btn secondary ap-mini" disabled={locked} onClick={() => atFinishLine("draft", "submit", () => setSubmitting(true))}>Mark submitted…</button>
            </>
          : <button type="button" className="btn secondary ap-mini" disabled={locked}
              title="Finished and ready to send. Still editable; a version is saved."
              onClick={() => atFinishLine("draft", "completed", markCompleted)}>Mark completed</button>)}
        {!standard && draft.status === "submitted" && (
          <>
            <button type="button" className="btn ghost ap-mini" onClick={() => void run(() => setDraftStatusAction(draft.id, "won"), () => router.refresh())}>Mark awarded</button>
            <button type="button" className="btn ghost ap-mini" onClick={() => void run(() => setDraftStatusAction(draft.id, "lost"), () => router.refresh())}>Mark declined</button>
          </>
        )}
        <button type="button" className="btn ghost ap-mini" onClick={() => setVersionsOpen(true)}>Versions</button>
        <span className="ws-flag">Admin · {tenantName} · For Granted only</span>
        <span className="ws-saved" aria-live="polite">{pending ? "Saving…" : savedAt ? "All changes saved" : ""}</span>
      </header>
      {readOnly && (
        <div className="ws-locked" role="status">
          <span><strong>{draft.status === "submitted" ? "Submitted" : STATUS_NAME[draft.status as DraftStatus]}</strong>
            {draft.submitted_at ? ` on ${new Date(draft.submitted_at).toLocaleDateString()}` : ""}. This is the copy the funder received, so it is locked.</span>
          <button type="button" className="btn secondary ap-mini" disabled={pending > 0}
            onClick={() => void run(() => newDraftFromAction(draft.id), id => router.push(`/drafts/${id}`))}>Start a new version from this one</button>
        </div>
      )}

      <DndContext sensors={readOnly ? noSensors : sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver}
        onDragEnd={onDragEnd} onDragCancel={endDrag}>
        <div className="ws-split" ref={splitRef} style={splitHeight ? { height: splitHeight } : undefined}>
          <CardPanel key={section.id} sectionId={section.id} ranked={ranked} usedWhere={usedWhere} current={idx + 1} statusNow={statusNow}
            wantedKinds={section.wantedKinds} locked={readOnly || stage === "weave"} onAdd={id => addCard(id, blocks.length)}
            open={panelOpen} onClose={() => setPanelOpen(false)} removing={!!activeBlock} />

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
                <button type="button" role="tab" aria-selected={stage === "arrange"} className={`chip${stage === "arrange" ? " active" : ""}`}
                  disabled={pending > 0} onClick={() => { if (stage !== "arrange") switchStage("arrange"); }}
                  title="Choose and order the cards">Arrange</button>
                <button type="button" role="tab" aria-selected={stage === "weave"} className={`chip${stage === "weave" ? " active" : ""}`}
                  disabled={pending > 0}
                  onClick={() => { if (stage !== "weave") switchStage("weave"); }}
                  title="Read the answer as prose, with short bridges between the cards to accept or reject">Weave</button>
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
                        + (r.needsReview ? `; ${r.needsReview} left empty because their standard answer holds cards not yet verified (open one and press Start from the standard answer to review them)` : "")
                        + (r.skipped ? `; ${r.skipped} left empty because their standard answer holds a sensitive or retired card` : "")
                        + ". Rearrange each for this funder.");
                      router.refresh();
                    })}>Fill {fillable} from Standard Answers</button>
                </div>
              )}

              {error && <div className="ap-error" role="alert">{error} <button className="btn ghost ap-mini" onClick={() => setError(null)}>Dismiss</button></div>}
              {arrangeReview && arrangeReview.length > 0 && (
                <div className="ws-notice ws-notice-x" role="status">
                  <span>{arrangeReview.length} more card{arrangeReview.length === 1 ? "" : "s"} would fit this question but {arrangeReview.length === 1 ? "is" : "are"} not verified yet.{" "}
                    <button type="button" className="btn secondary ap-mini" disabled={locked}
                      onClick={() => { setReview({ mode: "place", queue: arrangeReview.map(cardId => ({ cardId, position: null })) }); setArrangeReview(null); }}>Review {arrangeReview.length === 1 ? "it" : "them"}</button></span>
                  <button type="button" className="bn-x" onClick={() => setArrangeReview(null)} aria-label="Dismiss">×</button>
                </div>
              )}
              {notice && (
                <div className="ws-notice ws-notice-x" role="status">
                  <span>{notice}</span>
                  <button type="button" className="bn-x" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
                </div>
              )}

              {stage === "weave" && blocks.length > 0 && !hasBridges && !readOnly && !wovenHere.has(section.id) && (
                <div className="ws-notice wv-start">
                  <span>{weaveBlockedWhy
                    ? weaveBlockedWhy
                    : "Read the cards as one passage. Begin Weaving drafts short connecting sentences between them, for you to accept, edit or reject."}</span>
                  <button type="button" className="btn inline ap-go" disabled={locked || !!weaveBlockedWhy}
                    title={weaveBlockedWhy ?? "Uses a small part of the monthly AI allowance"} onClick={requestWeave}>Begin Weaving</button>
                </div>
              )}
              {stage === "weave" ? (
                blocks.length
                  ? <WeaveView blocks={blocks} cardById={cardById} gateCard={gateCard} locked={locked}
                      handlers={{
                        onAccept: id => run(() => acceptBridgesAction(section.id, id), putBlocks(section.id)),
                        onEdit: (id, t) => run(() => editBlockAction(section.id, id, t), putBlocks(section.id)),
                        onRemove: id => { const b = blocks.find(x => x.id === id); if (b) requestRemove(b, "button"); },
                        onReview: cardId => setReview({ mode: "review", queue: [{ cardId, position: null }] }),
                        onRefresh: id => run(() => refreshBlockWordingAction(section.id, id), putBlocks(section.id)),
                        onKeep: id => run(() => keepWordingAction(section.id, id), putBlocks(section.id)),
                      }} />
                  : <div className="ws-empty-answer"><p>Nothing to weave yet. Go back to <strong>Arrange</strong> to place cards in this answer.</p></div>
              ) : <AnswerColumn
                blocks={blocks} cardById={cardById} gateCard={gateCard} locked={locked} editing={editing} setEditing={setEditing}
                dropBefore={dragging && overId && overId !== "answer" && overId !== "panel" ? overId : null}
                dropAtEnd={!!dragging && overId === "answer"}
                onMove={(from, to) => reorder(moveItem(blocks, from, to).map(b => b.id), "buttons")}
                onRemove={id => { const b = blocks.find(x => x.id === id); if (b) requestRemove(b, "button"); }}
                onEdit={(id, t) => run(() => editBlockAction(section.id, id, t), putBlocks(section.id))}
                onBreak={(id, v) => run(() => setBreakAction(section.id, id, v), putBlocks(section.id))}
                onRefresh={id => run(() => refreshBlockWordingAction(section.id, id), putBlocks(section.id))}
                onKeep={id => run(() => keepWordingAction(section.id, id), putBlocks(section.id))}
                empty={
                  <EmptyAnswer
                    std={!standard && std?.sectionId ? std : undefined}
                    onStart={() => void run(() => startFromStandardAction(section.id), r => {
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

              <div className="ws-foot">
                {!standard && !readOnly && <button type="button" className="btn ghost" onClick={() => void reopen()}>Edit the questions</button>}
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
                {stage === "weave" && !readOnly && (
                  <>
                    {proposedCount > 0 && (
                      <button type="button" className="btn inline ap-go ws-edit-only" disabled={locked}
                        title="Accept every bridge proposed in this answer"
                        onClick={() => void run(() => acceptBridgesAction(section.id, null), putBlocks(section.id))}>Accept all ({proposedCount})</button>
                    )}
                    {hasBridges || wovenHere.has(section.id)
                      ? <button type="button" className="btn secondary ws-edit-only" disabled={locked || !!weaveBlockedWhy}
                          title={weaveBlockedWhy ?? "Propose bridges again: replaces the ones not yet accepted, and fills any gap without one"}
                          onClick={requestWeave}>Weave again</button>
                      : <button type="button" className="btn inline ap-go ws-edit-only" disabled={locked || !!weaveBlockedWhy}
                          title={weaveBlockedWhy ?? "Draft connecting sentences between the cards. Uses a small part of the monthly AI allowance."}
                          onClick={requestWeave}>Begin Weaving</button>}
                  </>
                )}
                {stage === "arrange" && blocks.length === 0 && (
                  <button type="button" className="btn secondary ws-edit-only" disabled={locked} title="Places the best cards for this question, in order. Cards only: nothing is written for you."
                    onClick={() => void run(() => arrangeForMeAction(section.id), r => {
                      putBlocks(section.id)(r.blocks);
                      if (!r.placed && r.needsReview.length) {
                        setReview({ mode: "place", queue: r.needsReview.map(cardId => ({ cardId, position: null })),
                          note: "None of the best cards for this question is verified yet. Review each; verifying one places it." });
                        return;
                      }
                      say(`Placed ${r.placed} verified card${r.placed === 1 ? "" : "s"}: one of each kind this question asks for first, then more while about four-fifths of the ${standard ? "typical length" : "limit"} allowed. Nothing was written; edit, reorder or remove as you like.`);
                      setArrangeReview(r.needsReview.length ? r.needsReview : null);
                    })}>Arrange for me</button>
                )}
                {stage === "arrange" && <button type="button" className="btn secondary ws-edit-only" disabled={locked} onClick={() => {
                  setEditing("__new");
                  void run(() => addHumanBlockAction(section.id, blocks.length), next => {
                    putBlocks(section.id)(next);
                    const added = next.find(b => b.kind === "human" && !b.text && !blocks.some(o => o.id === b.id));
                    setEditing(added?.id ?? null);
                  });
                }}>＋ Write your own text</button>}
                {stage === "arrange" && <button type="button" className="btn secondary ws-edit-only" disabled={locked || blocks.length < 3}
                  title={blocks.length < 3 ? "Tidy needs at least three pieces" : "Ask for a suggested order, with a reason. Nothing changes unless you accept it."}
                  onClick={() => void run(() => tidyAction(section.id), r => {
                    if ("error" in r) say(r.error);
                    else if (r.order.every((id, i) => id === blocks[i]?.id)) say(`Tidy would keep this order. ${r.rationale}`);
                    else { setTidy(r); reveal(); }
                  })}>Tidy</button>}
              </span>
              <span className="ws-bar-group">
                <button type="button" className={`btn ghost${seams ? " ws-seams-on" : ""}`} disabled={!blocks.length}
                  onClick={() => { setSeams(v => !v); if (!seams) reveal(); }}
                  title="See the answer as one text, marked by where each part came from">{seams ? "Hide seams" : "Show seams"}</button>
                <CopyButton text={text} blocked={sectionBlockers.length > 0}
                  onBlocked={() => setBlockers({ scope: "section", then: null })} />
              </span>
              <span className="spacer" />
              <span className="ws-bar-group ws-edit-only">
                {statusBy[section.id] === "done"
                  ? <button type="button" className="btn ghost" disabled={locked}
                      onClick={() => void run(() => setSectionDoneAction(section.id, false), st => setStatusBy(m => ({ ...m, [section.id]: st })))}>Reopen this answer</button>
                  : <button type="button" className="btn secondary ws-done-btn" disabled={locked || !blocks.length}
                      onClick={() => void run(() => setSectionDoneAction(section.id, true), st => setStatusBy(m => ({ ...m, [section.id]: st })))}>Mark this answer done</button>}
                {standard && (
                  <button type="button" className="btn inline ap-go" disabled={locked || !text || (std?.sectionId === section.id && !changedSinceApproval)}
                    title="Make this the approved Standard Answer, linked to the cards it was built from. Applications start from approved answers."
                    onClick={() => atFinishLine("section", "approve", approveNow)}>
                    {std?.sectionId === section.id ? (changedSinceApproval ? "Approve the changes" : "Approved") : "Approve this answer"}
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
        {versionsOpen && (
          <VersionsDrawer draftId={draft.id} readOnly={readOnly} onClose={() => setVersionsOpen(false)}
            onRestored={(r) => { setVersionsOpen(false); say(`Restored ${r.restored} question${r.restored === 1 ? "" : "s"}${r.skipped ? `; ${r.skipped} no longer in this application were skipped` : ""}. The previous state was saved as a version first.`); router.refresh(); }} />
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
            onWording={(b, keep) => { if (b.blockId) void run(() => (keep ? keepWordingAction : refreshBlockWordingAction)(b.sectionId, b.blockId!), putBlocks(b.sectionId)); }}
            onGo={b => { setBlockers(null); const i = sections.findIndex(x => x.id === b.sectionId); if (i >= 0) go(i); }}
            onContinue={() => {
              const t = blockers.then; setBlockers(null);
              if (t === "completed") markCompleted(); else if (t === "submit") setSubmitting(true); else if (t === "approve") approveNow();
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
            <button type="button" className="btn secondary ap-mini" disabled={locked} onClick={() => {
              const u = undo; setUndo(null);
              if (undoTimer.current) clearTimeout(undoTimer.current);
              void run(() => restoreBlockAction(u.sectionId, u.removed), putBlocks(u.sectionId));
            }}>Undo</button>
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {dragging ? <div className={`ws-card ws-overlay ${layerClass(dragging.layer)}`}><p className="cl-statement">{dragging.statement}</p></div>
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

/** The page's description, behind an ⓘ that opens on hover. */
function About({ standard, tenantName, meta }: { standard: boolean; tenantName: string; meta: string | null }) {
  return (
    <span className="ws-about-wrap">
      {meta && <span className="ws-meta">{meta}</span>}
      <InfoTip label={standard ? "About Standard Answers" : "About this page"}>
        {standard
          ? <>The questions funders ask again and again, answered once from {tenantName}&rsquo;s Story Cards. An approved answer can start any application&rsquo;s matching question. Lengths shown are typical, not limits.</>
          : <>This application&rsquo;s questions, answered from {tenantName}&rsquo;s Story Cards. Drag cards into the answer, or use Arrange for me; every sentence keeps its source. Weave then reads it as prose, with short bridges between the cards for you to accept or reject. Polish comes next.</>}
      </InfoTip>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The card panel.
// ---------------------------------------------------------------------------

function CardPanel({ sectionId, ranked, usedWhere, current, statusNow, wantedKinds, locked, onAdd, open, onClose, removing }: {
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
  const logged = useRef(new Set<string>());

  const statusOf = (c: WsCard) => statusNow[c.id] ?? c.status;
  const filtering = !!(kind || layer || q.trim() || verifiedOnly);
  const list = ranked.filter(r => {
    if (statusNow[r.card.id] === "retired") return false;
    if (verifiedOnly && statusOf(r.card as WsCard) !== "verified") return false;
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
    <aside ref={dropRef} className={`ws-panel${open ? " ws-panel-open" : ""}${removing ? " ws-panel-removing" : ""}${removing && isOver ? " ws-panel-over" : ""}`} aria-label="Story Cards">
      {removing && <div className="ws-remove-zone" aria-hidden="true">{isOver ? "Release to remove" : "Drop here to remove"}</div>}
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
        <label className="ws-verified-only" title="Only cards a person has verified. Others can still be used: dropping one opens its review.">
          <input type="checkbox" checked={verifiedOnly} onChange={e => { setVerifiedOnly(e.target.checked); setLimit(PANEL_SIZE); }} /> Verified only
        </label>
      </div>
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
        {c.layer && <span className="cl-layer">{LAYER_NAME[c.layer]}</span>}
        <span className="cl-spacer" />
        {verified ? <span className="cl-badge cl-badge-ok">Verified</span> : <span className="cl-badge ws-badge-review" title="Not yet verified. Dropping it in, or pressing Review and add, opens its review first.">Needs review</span>}
      </div>
      <p className="cl-statement">{c.statement}</p>
      <div className="ws-reason">{reasonFor(r, c.kindLabel, c.newestSource)}</div>
      {!ok && (
        <div className="ws-warn ws-soft">Sensitive: {c.sensitiveReason ?? "it may identify a person's protected information."} Record consent,
          de-identify it, or rule it not sensitive in the <a href="/admin/card-library">Card Library</a> before placing it.</div>
      )}
      <div className="cl-card-acts">
        <button type="button" className="btn inline cl-primary ws-edit-only" disabled={locked || !ok} onClick={() => onAdd(c.id)}
          title={ok ? (verified ? undefined : "Opens the card's review; verifying it adds it") : "Sensitive: decide it in the Card Library first"}>{verified || !ok ? "Add" : "Review and add"}</button>
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

function AnswerColumn({ blocks, cardById, gateCard, locked, editing, setEditing, onMove, onRemove, onEdit, onBreak, onRefresh, onKeep, empty, dropBefore, dropAtEnd }: {
  blocks: WsBlock[]; cardById: Map<string, WsCard>; gateCard: (id: string) => GateCard | null; locked: boolean;
  /** While a card from the panel is dragged: the block it would land before, or the end. */
  dropBefore: string | null; dropAtEnd: boolean;
  editing: string | null; setEditing: (id: string | null) => void;
  onMove: (from: number, to: number) => void; onRemove: (id: string) => void;
  onEdit: (id: string, text: string) => Promise<unknown>; onBreak: (id: string, v: boolean) => Promise<unknown>;
  onRefresh: (id: string) => Promise<unknown>; onKeep: (id: string) => Promise<unknown>; empty: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "answer" });
  return (
    <div ref={setNodeRef} className={`ws-answer${isOver ? " ws-over" : ""}`} aria-label="The answer">
      {blocks.length === 0 ? empty : (
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((b, i) => (
            <BlockRow key={b.id} block={b} index={i} last={i === blocks.length - 1} dropBefore={dropBefore === b.id}
              card={b.cardId ? cardById.get(b.cardId) : undefined} locked={locked}
              blocked={b.kind === "card" && b.cardId ? placeIssue(gateCard(b.cardId)) : null}
              editing={editing === b.id} setEditing={setEditing}
              onMove={onMove} onRemove={onRemove} onEdit={onEdit} onBreak={onBreak} onRefresh={onRefresh} onKeep={onKeep} />
          ))}
        </SortableContext>
      )}
      <div className={`ws-dropzone${dropAtEnd && blocks.length ? " ws-drop-line" : ""}`}>{blocks.length ? "Drop a card here to add it at the end" : null}</div>
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

function BlockRow({ block: b, index, last, card, blocked, locked, editing, setEditing, onMove, onRemove, onEdit, onBreak, onRefresh, onKeep, dropBefore }: {
  block: WsBlock; index: number; last: boolean; card?: WsCard; locked: boolean; dropBefore: boolean;
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
        {b.kind === "bridge" && b.proposed && <span className="ov-tag" title="Proposed in Weave and not accepted yet, so it is not part of the answer.">Proposed, not in the answer</span>}
        {isCard && b.edited && <span className="ov-tag" title="Changed in this draft only. The library card is unchanged.">Edited here</span>}
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
        <button type="button" className="btn ghost ap-mini" disabled={temp || locked || index === 0} onClick={() => onMove(index, index - 1)} aria-label="Move up">↑</button>
        <button type="button" className="btn ghost ap-mini" disabled={temp || locked || last} onClick={() => onMove(index, index + 1)} aria-label="Move down">↓</button>
        <button type="button" className="btn ghost ap-mini ap-del" disabled={temp || locked} onClick={() => onRemove(b.id)}>Remove</button>
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
          onClick={startEdit} onKeyDown={e => { if (e.key === "Enter") startEdit(); }}>
          {b.text || "Click to write…"}
        </p>
      )}

      {untraced.length > 0 && (
        <div className="ws-warn">{untraced.join(", ")} {untraced.length === 1 ? "is" : "are"} not in this card&rsquo;s sources. The figure audit in Polish will stop the export until it is traced or removed.</div>
      )}
      {reworded && (
        <div className="ws-warn ws-soft">
          This card was reworded in the library since you placed it, so this answer cannot leave until you choose.{" "}
          <button type="button" className="cl-link" onClick={() => void onRefresh(b.id)}>Use the new wording</button>{" "}
          or <button type="button" className="cl-link" onClick={() => void onKeep(b.id)}>keep this wording</button>
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

function CopyButton({ text, blocked, onBlocked }: { text: string; blocked: boolean; onBlocked: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn secondary" disabled={!text}
      title={blocked ? "This answer holds cards that need review before it is copied out" : undefined}
      onClick={async () => {
      if (blocked) { onBlocked(); return; }
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
