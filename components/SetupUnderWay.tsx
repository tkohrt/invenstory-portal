"use client";
// What a teammate sees while the first person is still doing the company
// setup (patch 14, onboarding build, 3 November 2026), with a way into the
// page's tour (patch 15).
import { usePathname } from "next/navigation";
import { TOUR_EVENT, tourForPath } from "@/lib/tours";

export default function SetupUnderWay({ by, done, total }: { by: string | null; done: number; total: number }) {
  const tour = tourForPath(usePathname());
  return (
    <div className="su-wait" role="status">
      <div>
        <b>{by ?? "Someone on your team"} is setting up your organization ({done} of {total} steps done).</b>
        <span> You can look around in the meantime. Pages fill in as documents are read; nothing here needs you yet.</span>
      </div>
      {tour && <button type="button" className="sb-btn sb-secondary sb-sm"
        onClick={() => window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { key: tour.key } }))}>Show me around</button>}
    </div>
  );
}
