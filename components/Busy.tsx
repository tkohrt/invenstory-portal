"use client";
// A small, honest waiting indicator for work that finishes in seconds.
//
// The animation is not the point. The sentence is. "Loading" tells somebody
// nothing they cannot already see; "reading 9 documents, about 30 seconds"
// tells them whether to wait or come back. Where a wait has a known cause, like
// a service that sleeps when idle, saying so is the difference between "working"
// and "broken".
//
// For work that can outlive a request, use JobProgress instead: this cannot
// survive a reload and does not know whether the work died.
import { useEffect, useState } from "react";

export default function Busy({ label, hint, slowAfterMs = 8000, slowHint }: {
  /** What is happening, in words. Not "Loading". */
  label: string;
  /** Always-visible second line, when there is something worth saying up front. */
  hint?: string;
  /** When a wait stops being ordinary and deserves an explanation. */
  slowAfterMs?: number;
  slowHint?: string;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!slowHint) return;
    const t = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(t);
  }, [slowAfterMs, slowHint]);

  return (
    <div className="busy" role="status" aria-live="polite">
      <span className="jp-spin" aria-hidden="true" />
      <span>
        {label}
        {hint && <span className="busy-hint">{hint}</span>}
        {slow && slowHint && <span className="busy-hint">{slowHint}</span>}
      </span>
    </div>
  );
}

/** Placeholder rows, so a table that is still loading does not read as empty. */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="skel" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div className="skel-row" key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <span className="skel-cell" key={c} style={{ width: `${[38, 18, 26, 18][c % 4]}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
