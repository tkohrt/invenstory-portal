"use client";
// A button that opens a short menu (Storyboard cleanup, 17 October 2026): the
// header's ⋯ (Versions, Edit the questions, the funder's application) and the
// action bar's More (Copy answer, Tidy, Show seams, keyboard shortcuts).
//
// Closes on a click outside, on Escape, and after any item is chosen, unless
// the item asks to stay open (data-keep-open). A menu opened from the action
// bar opens UPWARD: anything that hangs below the bar brings back the page
// scroll the Storyboard is sized to avoid (CLAUDE.md, The Garden).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export default function MenuButton({ label, icon, text, up = false, className = "", small = false, floating = false, children }: {
  /** The accessible name of the button. */
  label: string;
  icon?: ReactNode;
  /** Visible text beside the icon, if any. */
  text?: string;
  up?: boolean;
  className?: string;
  /** 30px trigger, for a menu inside a table row or card (sb-sm). */
  small?: boolean;
  /**
   * Position the menu against the window rather than its button, for a menu
   * inside a panel that scrolls or clips (a wide table). It opens upward when
   * there is no room below, and closes when the page scrolls.
   */
  floating?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  /** Close, and give focus back to the button, so a keyboard user is not left on the page body. */
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open || !floating || !trigger.current) { setPos(null); return; }
    const r = trigger.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    setPos(window.innerHeight - r.bottom < 320 && r.top > 320
      ? { bottom: window.innerHeight - r.top + 6, right }
      : { top: r.bottom + 6, right });
    const shut = () => setOpen(false);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    return () => { window.removeEventListener("scroll", shut, true); window.removeEventListener("resize", shut); };
  }, [open, floating]);
  useEffect(() => {
    if (!open) return;
    // Opening moves focus to the first item a person can choose.
    menu.current?.querySelector<HTMLElement>("[role=menuitem]:not(:disabled)")?.focus();
    const away = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <span className={`mb-wrap ${className}`} ref={root}>
      <button type="button" ref={trigger} className={`sb-btn ${text ? "sb-quiet" : "sb-secondary sb-icon"}${small ? " sb-sm" : ""}${open ? " mb-open" : ""}`}
        // A visible word keeps a fuller name when the label begins with it ("Decide on Mastercard Foundation").
        aria-label={text ? (label !== text && label.startsWith(text) ? label : undefined) : label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)}>
        {icon}{text}
      </button>
      {open && (
        <div id={id} ref={menu} role="menu" aria-label={label} className={`mb-menu${up ? " mb-up" : ""}${floating ? " mb-floating" : ""}`}
          style={floating && pos ? { position: "fixed", top: pos.top ?? "auto", bottom: pos.bottom ?? "auto", right: pos.right } : undefined}
          onClick={e => {
            const item = (e.target as HTMLElement).closest("[role=menuitem]");
            if (item && !item.hasAttribute("data-keep-open")) close();
          }}
          onKeyDown={e => {
            // Up and Down move between items, Home and End to the ends; kept from the page's own arrow-key shortcuts.
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            const items = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not(:disabled)") ?? []);
            if (!items.length) return;
            const at = items.indexOf(document.activeElement as HTMLElement);
            const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
              : e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
            items[next].focus();
          }}>
          {children}
        </div>
      )}
    </span>
  );
}

/** One choice in a MenuButton: a name, and a line saying what it does. */
export function MenuItem({ title, hint, onClick, disabled, keepOpen }: {
  title: string; hint?: string; onClick: () => void; disabled?: boolean; keepOpen?: boolean;
}) {
  return (
    <button type="button" role="menuitem" className="mb-item" disabled={disabled} onClick={onClick}
      data-keep-open={keepOpen ? "" : undefined}>
      <span className="mb-title">{title}</span>
      {hint && <span className="mb-hint">{hint}</span>}
    </button>
  );
}

export const DOTS = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
);
