"use client";
// The Document Reader (Phase 1; Design canvas "Document Reader Mockup", first
// artboard). The text on the left, the card panel on the right.
//
// - Search: every match highlighted, "4 / 17", Enter and Shift+Enter, Match
//   case and Whole word; Ctrl/⌘+F focuses the box, and a second press while
//   already in it falls through to the browser's own find.
// - Story Card highlights in the layer colours (the Weave wash), a deeper wash
//   and an outline on the current card. "Story Cards 3 / 12" steps through
//   them in reading order: ] and [, or J and K. Each step scrolls the passage
//   to the middle and pulses it once (not with reduced motion).
// - A marker strip beside the text shows where every highlight sits.
// - "Couldn't be placed": cards whose quote is no longer in the text. Nothing
//   is dropped silently (style guide principle 3).
// - For Granted only: "Show retired".
// The page never scrolls as a whole: on a wide screen the split is fitted to
// the window and the text and the panel scroll on their own (style guide 6).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import type { ReaderCard, ReaderData } from "@/lib/server/reader";
import { findAll, prepare } from "@/lib/locate";
import { segment, step } from "@/lib/reader-segments";
import ReaderCardPanel from "./ReaderCardPanel";
import MenuButton, { MenuItem, DOTS } from "./MenuButton";
import { reprocessDocAction } from "@/lib/server/doc-actions";
import { useRouter } from "next/navigation";

const KIND_NAME: Record<string, string> = { pdf: "PDF", docx: "Word", note: "Note", web: "Web page", xlsx: "Spreadsheet", rtf: "RTF" };

function typingIn(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}
const dialogOpen = () => !!document.querySelector('[aria-modal="true"]');
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function DocumentReader({ data }: { data: ReaderData }) {
  const router = useRouter();
  const { doc, text, pages, access } = data;
  const [showRetired, setShowRetired] = useState(false);
  const [showCards, setShowCards] = useState(true);
  const [panel, setPanel] = useState<"card" | "tray" | "help">(data.focus.cardId ? "card" : data.unplaced.length && !data.placed.length ? "tray" : "help");
  const [cardId, setCardId] = useState<string | null>(data.focus.cardId);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  // The current match, remembered with the search it belongs to, so a new
  // search starts at its first match without an effect resetting it.
  const [matchSel, setMatchSel] = useState<{ key: string; idx: number }>({ key: "", idx: -1 });
  const [pulse, setPulse] = useState<string | null>(null);
  const [splitH, setSplitH] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const splitRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const visible = useCallback((c: ReaderCard) => showRetired || c.status !== "retired", [showRetired]);
  const placed = useMemo(() => data.placed.filter(visible), [data.placed, visible]);
  const unplaced = useMemo(() => data.unplaced.filter(visible), [data.unplaced, visible]);
  const byId = useMemo(() => new Map([...data.placed, ...data.unplaced].map(c => [c.id, c])), [data.placed, data.unplaced]);
  const current = cardId ? byId.get(cardId) ?? null : null;
  // A card that has just left this document (retired for a client, or its
  // passage refused) closes its panel.
  const shown = panel === "card" && (!current || !visible(current)) ? "help" : panel;
  const cardPos = current ? placed.findIndex(c => c.id === current.id) : -1;

  // Search, over the same folding the quote check uses.
  const prepared = useMemo(() => prepare(text), [text]);
  const matches = useMemo(() => query.trim().length >= 2 ? findAll(prepared, query, { matchCase, wholeWord }) : [], [prepared, query, matchCase, wholeWord]);
  const matchKey = `${query}|${matchCase}|${wholeWord}`;
  const matchIdx = matchSel.key === matchKey ? matchSel.idx : (matches.length ? 0 : -1);

  const segs = useMemo(() => segment(
    text.length, pages,
    showCards ? placed.flatMap(c => c.spans.map(s => ({ ...s, cardId: c.id }))) : [],
    [...matches, ...(data.focus.span ? [data.focus.span] : [])],
  ), [text.length, pages, showCards, placed, matches, data.focus.span]);
  const focusIdx = data.focus.span ? matches.length : -2;

  // Fit the split to the window on wide screens, as the Storyboard does.
  useLayoutEffect(() => {
    const fit = () => {
      const el = splitRef.current;
      if (!el) return;
      if (window.innerWidth <= 860) { setSplitH(null); return; }
      const main = document.querySelector<HTMLElement>(".main");
      const top = el.getBoundingClientRect().top + (main?.scrollTop ?? 0);
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 16;
      setSplitH(Math.max(320, window.innerHeight - top - pad));
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => fit());
    const main = document.querySelector(".main");
    if (ro && main) for (const el of Array.from(main.children)) ro.observe(el);
    return () => { window.removeEventListener("resize", fit); ro?.disconnect(); };
  }, []);

  const scrollToEl = useCallback((el: Element | null) => {
    if (!el) return;
    // On a phone the card opens as a sheet over the lower part of the screen, so
    // the passage goes near the top (scroll-margin-top in the CSS), not the middle.
    const phone = window.innerWidth <= 860;
    el.scrollIntoView({ block: phone ? "start" : "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }, []);

  const goCard = useCallback((id: string, opts: { pulse?: boolean } = {}) => {
    setCardId(id); setPanel("card");
    requestAnimationFrame(() => {
      scrollToEl(textRef.current?.querySelector(`[data-cards~="${id}"]`) ?? null);
      if (opts.pulse !== false && !reducedMotion()) { setPulse(id); window.setTimeout(() => setPulse(p => (p === id ? null : p)), 900); }
    });
  }, [scrollToEl]);

  const stepCard = useCallback((dir: 1 | -1) => {
    if (!placed.length) return;
    const from = cardPos >= 0 ? cardPos : -1;
    const next = step(from, placed.length, dir);
    if (next >= 0) goCard(placed[next].id);
  }, [placed, cardPos, goCard]);

  const stepMatch = useCallback((dir: 1 | -1) => {
    if (!matches.length) return;
    setMatchSel({ key: matchKey, idx: step(matchIdx, matches.length, dir) });
  }, [matches.length, matchKey, matchIdx]);
  useEffect(() => {
    if (matchIdx < 0) return;
    scrollToEl(textRef.current?.querySelector(`[data-match="${matchIdx}"]`) ?? null);
  }, [matchIdx, scrollToEl]);

  // Open where the link pointed.
  useEffect(() => {
    // The card is already selected by the initial state; only scroll to it.
    const id = data.focus.cardId;
    if (id && byId.get(id)?.spans.length) {
      requestAnimationFrame(() => {
        scrollToEl(textRef.current?.querySelector(`[data-cards~="${id}"]`) ?? null);
        if (!reducedMotion()) { setPulse(id); window.setTimeout(() => setPulse(p => (p === id ? null : p)), 900); }
      });
    } else if (data.focus.span) requestAnimationFrame(() => scrollToEl(textRef.current?.querySelector(`[data-match="${focusIdx}"]`) ?? null));
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keys: ignored while typing or while a dialog is open (style guide 8).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "f" || e.key === "F")) {
        if (document.activeElement === searchRef.current) return;   // second press: the browser's own find
        if (dialogOpen()) return;
        e.preventDefault();
        searchRef.current?.focus(); searchRef.current?.select();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typingIn(e.target) || dialogOpen()) return;
      if (e.key === "]" || e.key === "j" || e.key === "J") { e.preventDefault(); stepCard(1); }
      else if (e.key === "[" || e.key === "k" || e.key === "K") { e.preventDefault(); stepCard(-1); }
      else if (e.key === "Escape" && panel !== "help") { setPanel("help"); setCardId(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepCard, panel]);

  // The marker strip: where each highlight sits, measured from the text.
  const [markers, setMarkers] = useState<{ id: string; top: number; layer: string | null; cur: boolean }[]>([]);
  const [matchMarks, setMatchMarks] = useState<number[]>([]);
  const [view, setView] = useState<{ top: number; height: number }>({ top: 0, height: 0 });
  useLayoutEffect(() => {
    // Measured after layout, in the next frame.
    const frame = requestAnimationFrame(() => {
    const root = textRef.current;
    if (!root || splitH === null) { setMarkers([]); setMatchMarks([]); return; }
    const total = root.scrollHeight || 1;
    const seen = new Set<string>();
    const out: typeof markers = [];
    root.querySelectorAll<HTMLElement>("[data-cards]").forEach(el => {
      const id = (el.dataset.cards ?? "").split(" ")[0];
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, top: (el.offsetTop / total) * 100, layer: byId.get(id)?.layer ?? null, cur: id === cardId });
    });
    setMarkers(out);
    const ms: number[] = [];
    root.querySelectorAll<HTMLElement>("[data-match]").forEach(el => ms.push((el.offsetTop / total) * 100));
    setMatchMarks(ms);
    });
    return () => cancelAnimationFrame(frame);
  }, [segs, splitH, cardId, byId]);
  useEffect(() => {
    const root = textRef.current;
    if (!root) return;
    const onScroll = () => {
      const total = root.scrollHeight || 1;
      setView({ top: (root.scrollTop / total) * 100, height: (root.clientHeight / total) * 100 });
    };
    onScroll();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [splitH]);

  const reprocess = async () => {
    setMsg("Reading the original file again…");
    const r = await reprocessDocAction(doc.id);
    setMsg(r.ok ? "Read again. The text below is the new reading." : r.error);
    if (r.ok) router.refresh();
  };
  const download = async () => {
    const res = await fetch(`/api/file?documentId=${doc.id}`);
    if (!res.ok) { setMsg("Couldn't open the original file."); return; }
    const { url } = await res.json();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const cardCount = data.placed.length + data.unplaced.length;
  const meta = [KIND_NAME[doc.docKind] ?? doc.docKind.toUpperCase(),
    doc.pageCount ? `${doc.pageCount} page${doc.pageCount === 1 ? "" : "s"}` : null,
    access.highlights ? `${cardCount} Story Card${cardCount === 1 ? "" : "s"} drawn from it` : null].filter(Boolean).join(", ");

  return (
    <div className="rd">
      <header className="rd-head">
        <div className="rd-titles">
          <div className="rd-titleline">
            <h2>{doc.title}</h2>
            {doc.typeLabel && <span className="rd-pill">{doc.typeLabel}</span>}
            {doc.layerName && <span className="rd-pill rd-pill-layer"><span className={`ws-ldot l${doc.layer?.length ?? 0}`} aria-hidden="true" />{doc.layerName}</span>}
            {doc.won && <span className="win-tag">★ Winning grant</span>}
          </div>
          <div className="rd-meta">{meta}</div>
        </div>
        <div className="rd-head-acts">
          <button type="button" className="sb-btn sb-secondary" onClick={download}>Download original</button>
          {access.admin && (
            <MenuButton label="More for this document" icon={DOTS}>
              <MenuItem onClick={reprocess} title="Re-process" hint="Read the original file again. If its text has changed and the client is on the analysis, that is one paid read." />
            </MenuButton>
          )}
        </div>
      </header>

      <div className="rd-tools" role="toolbar" aria-label="Find and step through">
        <div className="rd-search">
          <label className="rd-search-box">
            <span className="rd-sr">Search this document</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input ref={searchRef} type="search" value={query} placeholder="Search this document"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); }
                else if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); }
              }} />
            <span className="rd-count" aria-live="polite">
              {query.trim().length >= 2 ? (matches.length ? `${matchIdx + 1} / ${matches.length}` : "No matches") : ""}
            </span>
          </label>
          <button type="button" className="sb-btn sb-secondary sb-icon sb-sm" aria-label="Previous match (Shift+Enter)" disabled={!matches.length} onClick={() => stepMatch(-1)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
          </button>
          <button type="button" className="sb-btn sb-secondary sb-icon sb-sm" aria-label="Next match (Enter)" disabled={!matches.length} onClick={() => stepMatch(1)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <button type="button" className="rd-opt" aria-pressed={matchCase} onClick={() => setMatchCase(v => !v)} title="Match case">Aa</button>
          <button type="button" className="rd-opt" aria-pressed={wholeWord} onClick={() => setWholeWord(v => !v)} title="Whole word">Whole word</button>
        </div>

        {access.highlights && placed.length > 0 && (
          <div className="rd-stepper">
            <span className="rd-label">Story Cards</span>
            <button type="button" className="sb-btn sb-secondary sb-icon sb-sm" aria-label="Previous Story Card ([)" onClick={() => stepCard(-1)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span className="rd-pos">{cardPos >= 0 ? cardPos + 1 : "–"} / {placed.length}</span>
            <button type="button" className="sb-btn sb-secondary sb-icon sb-sm" aria-label="Next Story Card (])" onClick={() => stepCard(1)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        )}

        <span className="rd-spacer" />

        {access.highlights && (
          <div className="rd-chips">
            <span className="rd-label">Show</span>
            <button type="button" className="rd-chip" aria-pressed={showCards} onClick={() => setShowCards(v => !v)}>
              <span className="rd-chip-dot" aria-hidden="true" />Story Cards {placed.length}
            </button>
            {access.showRetired && (
              <button type="button" className="rd-chip" aria-pressed={showRetired} onClick={() => setShowRetired(v => !v)}
                title="For Granted only: highlight the passages of retired cards too">Show retired</button>
            )}
            {unplaced.length > 0 && (
              <button type="button" className="rd-chip rd-chip-warn" aria-pressed={panel === "tray"} onClick={() => setPanel(p => (p === "tray" ? "help" : "tray"))}>
                {unplaced.length} couldn&apos;t be placed
              </button>
            )}
          </div>
        )}
      </div>

      {msg && <p className="ws-notice rd-msg">{msg}</p>}
      {data.textSource === "rebuilt" && access.admin && (
        <p className="ws-notice ws-soft-notice rd-msg">This text is rebuilt from the document&apos;s passages because its stored text is not in yet. Store it on Admin, Analysis.</p>
      )}
      {data.focus.label && <p className="ws-notice rd-msg">{data.focus.label} is marked below.</p>}

      <div className="rd-split" ref={splitRef} style={splitH ? { height: splitH } : undefined}>
        <div className="rd-textcol">
          <article className="rd-text" ref={textRef} aria-label="Document text" tabIndex={0}>
            {!text && <p className="rd-empty">No text was found in this document.</p>}
            {segs.map(sg => {
              const piece = text.slice(sg.start, sg.end);
              const divider = sg.pageStart !== null
                ? <div className="rd-page" aria-hidden="false"><span>Page {sg.pageStart}</span></div> : null;
              const matchCls = sg.match < 0 ? "" : sg.match === focusIdx ? " rd-focus" : sg.match === matchIdx ? " rd-match rd-match-cur" : " rd-match";
              const inner = sg.match >= 0
                ? <mark className={matchCls.trim()} data-match={sg.match}>{piece}</mark> : piece;
              if (!sg.cards.length) return <Fragment key={sg.start}>{divider}{inner}</Fragment>;
              const first = byId.get(sg.cards[0])!;
              const cur = cardId !== null && sg.cards.includes(cardId);
              const cls = `rd-hl rd-l${first.layer?.length ?? 0}${first.status === "retired" ? " rd-retired" : ""}${sg.cards.length > 1 ? " rd-multi" : ""}${cur ? " rd-cur" : ""}${pulse && sg.cards.includes(pulse) ? " rd-pulse" : ""}`;
              return (
                <Fragment key={sg.start}>
                  {divider}
                  <a href={`?card=${cur ? cardId : first.id}`} className={cls} data-cards={sg.cards.join(" ")}
                    onClick={e => { e.preventDefault(); goCard(cur && cardId ? nextAt(sg.cards, cardId) : first.id, { pulse: false }); }}>
                    {inner}
                  </a>
                </Fragment>
              );
            })}
          </article>
          {splitH !== null && (markers.length > 0 || matchMarks.length > 0) && (
            <div className="rd-strip" aria-hidden="true">
              <span className="rd-strip-view" style={{ top: `${view.top}%`, height: `${Math.max(view.height, 2)}%` }} />
              {matchMarks.map((t, i) => <span key={`m${i}`} className="rd-mark rd-mark-match" style={{ top: `${t}%` }} />)}
              {markers.map(m => (
                <button key={m.id} type="button" tabIndex={-1} className={`rd-mark rd-mark-l${m.layer?.length ?? 0}${m.cur ? " rd-mark-cur" : ""}`}
                  style={{ top: `${m.top}%` }} onClick={() => goCard(m.id)} />
              ))}
            </div>
          )}
        </div>

        <aside className={`rd-panel${shown !== "help" ? " rd-panel-open" : ""}`} aria-label={shown === "tray" ? "Couldn't be placed" : shown === "card" ? "Story Card" : "Keys"}>
          {shown === "card" && current && (
            <ReaderCardPanel card={current} position={cardPos >= 0 ? `Story Card ${cardPos + 1} of ${placed.length}` : current.spans.length ? "Story Card" : "Couldn't be placed"}
              library={data.library[current.id] ?? null} access={access} documentId={doc.id}
              onClose={() => { setPanel("help"); setCardId(null); }} />
          )}
          {shown === "tray" && (
            <div className="rd-box">
              <div className="rd-box-head">
                <span className="rd-label">Couldn&apos;t be placed</span>
                <button type="button" className="sb-btn sb-quiet sb-icon sb-sm" aria-label="Close" onClick={() => setPanel("help")}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              <p className="rd-small">
                {unplaced.length} Story Card{unplaced.length === 1 ? " quotes" : "s quote"} text that is not in this document as it reads now, usually because it was re-processed. Nothing is hidden: review each one.
              </p>
              {unplaced.map(c => (
                <div key={c.id} className={`rd-mini rd-mini-l${c.layer?.length ?? 0}`}>
                  <span className="rd-kind">{c.kindLabel}{c.layer ? <span className="rd-kind-layer"> · {LAYER[c.layer]}</span> : null}{c.status === "retired" ? <span className="rd-kind-layer"> · Retired</span> : null}</span>
                  <p className="rd-mini-st">{c.statement}</p>
                  <p className="rd-small">Its quote: &ldquo;{c.quote}&rdquo;</p>
                  <div className="rd-mini-acts">
                    <button type="button" className="sb-btn sb-secondary sb-sm" onClick={() => { setCardId(c.id); setPanel("card"); }}>Review</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {shown === "help" && (
            <div className="rd-box rd-help">
              <span className="rd-label">Keys</span>
              <p>
                <kbd>Ctrl</kbd>+<kbd>F</kbd> searches this document. <kbd>Enter</kbd> and <kbd>Shift</kbd>+<kbd>Enter</kbd> step through matches.
                {access.highlights && <> <kbd>]</kbd> and <kbd>[</kbd> (or <kbd>J</kbd> and <kbd>K</kbd>) step through Story Cards. <kbd>Esc</kbd> closes the card.</>}
              </p>
              {access.highlights && placed.length > 0 && <p className="rd-small">Select a highlighted passage to see the Story Card drawn from it.</p>}
              {access.highlights && cardCount === 0 && <p className="rd-small">No Story Cards have been drawn from this document yet.</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

const LAYER: Record<string, string> = { I: "Public story", II: "Internal", III: "Living voice" };

/** Clicking a passage two cards share opens the other one the second time. */
function nextAt(ids: string[], current: string): string {
  const i = ids.indexOf(current);
  return ids[(i + 1) % ids.length];
}
