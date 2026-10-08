"use client";
// A small "i" in a circle that explains something on hover (Shane, 8 October
// 2026). It also opens when tabbed to with the keyboard, and on a tap, since
// touch screens have no hover; a second tap or a tap elsewhere closes it.
import { useEffect, useRef, useState, type ReactNode } from "react";

export default function InfoTip({ label = "More information", children, align = "left" }: {
  label?: string; children: ReactNode; align?: "left" | "right";
}) {
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!pinned) return;
    const off = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [pinned]);
  return (
    <span ref={ref} className={`info-tip${pinned ? " open" : ""}`}>
      <button type="button" className="info-tip-i" aria-label={label} aria-expanded={pinned}
        onClick={() => setPinned(p => !p)}>i</button>
      <span className={`info-tip-pop info-tip-${align}`} role="tooltip">{children}</span>
    </span>
  );
}
