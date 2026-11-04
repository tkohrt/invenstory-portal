"use client";
// First-use tours (patch 15, onboarding build, 3 November 2026). Mounted once
// in the Shell. Starts on its own the first time a client opens a tool, from
// the "?" menu, or from Portal Guide (window event TOUR_EVENT, or ?tour=1).
// The page is never changed: a ring is drawn over the element from outside.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { setUiPrefAction } from "@/lib/server/account-actions";
import { TOURS, TOUR_EVENT, autoStartTour, isTourKey, placeCard, presentSteps, tourForPath, tourPrefKey, type Tour, type TourStep } from "@/lib/tours";

/** The first marked element that is actually on screen (a hidden twin is skipped). */
const find = (target: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`))
  .find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null;

export default function TourHost({ role, prefs }: { role: "admin" | "client"; prefs: Record<string, unknown> | null }) {
  const path = usePathname();
  const router = useRouter();
  const [tour, setTour] = useState<Tour | null>(null);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string>>(new Set());
  /** Started in this visit: a refresh of the page's data does not start it again. */
  const started = useRef<Set<string>>(new Set());

  const start = useCallback((t: Tour) => {
    const s = presentSteps(t.steps, x => !!find(x));
    if (!s.length) return;
    started.current.add(t.key);
    setSteps(s); setI(0); setTour(t);
    // Asked for with ?tour=1: take it out of the address, so a refresh does not start it again.
    const u = new URL(window.location.href);
    if (u.searchParams.has("tour")) { u.searchParams.delete("tour"); window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash); }
  }, []);

  const end = useCallback(() => {
    if (tour && !seen.current.has(tour.key)) {
      seen.current.add(tour.key);
      void setUiPrefAction(tourPrefKey(tour.key), true).catch(() => { /* shown again next time; harmless */ });
    }
    setTour(null); setBox(null);
  }, [tour]);

  // A tour belongs to its page: leaving the page ends it, without marking it seen.
  const live = tour && tour.path === path ? tour : null;
  useEffect(() => {
    if (!tour || tour.path === path) return;
    const id = window.setTimeout(() => { setTour(null); setBox(null); }, 0);
    return () => window.clearTimeout(id);
  }, [tour, path]);

  // On its own, once, for a client; or when asked with ?tour=1.
  useEffect(() => {
    const t = tourForPath(path);
    if (!t) return;
    const asked = new URLSearchParams(window.location.search).get("tour") === "1";
    if (!asked && (seen.current.has(t.key) || started.current.has(t.key) || !autoStartTour({ key: t.key, role, prefs }))) return;
    const id = window.setTimeout(() => start(t), 700);
    return () => window.clearTimeout(id);
  }, [path, role, prefs, start]);

  // From the "?" menu or Portal Guide: this page's tour, or another tool's.
  useEffect(() => {
    const on = (e: Event) => {
      const key = (e as CustomEvent<{ key?: string }>).detail?.key;
      const t = isTourKey(key) ? TOURS[key] : tourForPath(window.location.pathname);
      if (!t) return;
      if (t.path !== window.location.pathname) router.push(`${t.path}?tour=1`);
      else start(t);
    };
    window.addEventListener(TOUR_EVENT, on);
    return () => window.removeEventListener(TOUR_EVENT, on);
  }, [router, start]);

  // Follow the element as the page moves.
  useLayoutEffect(() => {
    if (!live) return;
    const el = find(steps[i]?.target ?? "");
    if (!el) { const r = requestAnimationFrame(() => setBox(null)); return () => cancelAnimationFrame(r); }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => setBox(el.getBoundingClientRect());
    const r = requestAnimationFrame(measure);
    const t = window.setTimeout(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { cancelAnimationFrame(r); window.clearTimeout(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [live, steps, i]);

  useEffect(() => {
    if (!live) return;
    card.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") end(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [live, i, end]);

  if (!live || !steps[i]) return null;
  const step = steps[i];
  const last = i === steps.length - 1;
  const pad = 6;
  const ring = box ? { top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 } : null;
  const pos = ring ? placeCard(ring, { width: window.innerWidth, height: window.innerHeight }) : { top: window.innerHeight / 2 - 95, left: window.innerWidth / 2 - 160 };

  return (
    <div className="tour-layer">
      {ring ? <div className="tour-ring" style={ring} aria-hidden /> : <div className="tour-dim" aria-hidden />}
      <div ref={card} className="tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-title" tabIndex={-1} style={pos}>
        <div className="tour-count">Tour · Step {i + 1} of {steps.length}</div>
        <h4 id="tour-title">{step.title}</h4>
        <p>{step.body}</p>
        <div className="tour-foot">
          <button type="button" className="sb-btn sb-quiet sb-sm" onClick={end}>Skip tour</button>
          <span className="spacer" />
          {i > 0 && <button type="button" className="sb-btn sb-secondary sb-sm" onClick={() => setI(i - 1)}>Back</button>}
          <button type="button" className="sb-btn sb-primary sb-sm" onClick={() => (last ? end() : setI(i + 1))}>{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
