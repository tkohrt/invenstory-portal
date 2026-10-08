"use client";
// The portal's one Back button (Shane, 8 October 2026), at the right of the top
// bar on every page. It returns to the page you came from inside the portal.
// Arriving from outside (a bookmark, a link in an email or Slack), it goes one
// level up instead, so it never sends anyone out of the portal. Hidden on the
// Inven(s)tory home page, where there is nowhere to go back to.
//
// The trail of pages visited is kept for this tab in sessionStorage. Moving
// between questions inside a draft only changes the address's ?q=, not the
// page, so Back leaves the draft rather than stepping through its questions.
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const KEY = "fg.nav.trail";
const HOME = "/invenstory";
/** Addresses that are not pages of their own, and where "one level up" from them should go. */
const NOT_PAGES: Record<string, string> = { "/": HOME, "/admin": "/admin/clients", "/story-intelligence": HOME };

function readTrail(): string[] {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; }
  catch { return []; }
}
function writeTrail(t: string[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(t.slice(-50))); } catch { /* storage unavailable: Back goes one level up */ }
}

/** One level up from a path: /drafts/abc to /drafts, /chat to the home page. */
export function parentOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  const up = "/" + parts.join("/");
  return NOT_PAGES[up] ?? (up === "/" ? HOME : up);
}

export default function BackButton() {
  const path = usePathname();
  const router = useRouter();

  // Keep the trail: a new page is added; returning to the page before (the
  // browser's own back, or this button) takes the last one off.
  useEffect(() => {
    const t = readTrail();
    if (t[t.length - 1] === path) return;
    if (t[t.length - 2] === path) t.pop(); else t.push(path);
    writeTrail(t);
  }, [path]);

  if (path === HOME || path === "/") return null;

  const back = () => {
    const t = readTrail();
    if (t.length >= 2 && t[t.length - 1] === path) router.back();
    else router.push(parentOf(path));
  };

  return (
    <button type="button" className="btn ghost back-btn" onClick={back} title="Back to the page you came from" aria-label="Back">
      <span aria-hidden="true">←</span><span className="back-word"> Back</span>
    </button>
  );
}
