"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { openStandardAnswersAction } from "@/lib/server/workspace-actions";
import type { DraftStatus, GrantDraft } from "@/lib/types";
import type { DraftProgress } from "@/lib/server/drafts";
import type { StandardProgress } from "@/lib/server/draft-start";

const STATUS_LABEL: Record<DraftStatus, string> = {
  drafting: "Drafting", client_review: "With client", completed: "Completed", submitted: "Submitted", won: "Awarded", lost: "Declined",
};
const STAGE_LABEL = { arrange: "Arrange", weave: "Weave", polish: "Polish" } as const;
const money = (c: number | null) => c == null ? null : "$" + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
// A bare date ("2026-10-09") is a calendar day, not midnight UTC: read it as local.
const asDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
const day = (iso: string) => asDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

type Filter = "open" | "completed" | "submitted" | "all";
const FILTERS: { key: Filter; label: string; has: (s: DraftStatus) => boolean }[] = [
  { key: "open", label: "In progress", has: s => s === "drafting" || s === "client_review" },
  { key: "completed", label: "Completed", has: s => s === "completed" },
  { key: "submitted", label: "Submitted", has: s => s === "submitted" || s === "won" || s === "lost" },
  { key: "all", label: "All", has: () => true },
];

export default function DraftsView({ tenantName, drafts, isAdmin, progress = {}, standard = null }: {
  tenantName: string; drafts: GrantDraft[]; isAdmin: boolean;
  progress?: Record<string, DraftProgress>; standard?: StandardProgress | null;
}) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"deadline" | "edited">("deadline");
  const [now] = useState(() => Date.now());
  const openStandard = async () => {
    setOpening(true); setOpenError(null);
    try {
      const r = await openStandardAnswersAction();
      router.push(`/drafts/${r.draftId}${r.added && r.since ? `?since=${encodeURIComponent(r.since)}` : ""}`);
    }
    catch (e) { setOpenError(e instanceof Error ? e.message : "Could not open Standard Answers."); setOpening(false); }
  };

  const edited = (d: GrantDraft) => {
    const p = progress[d.id]?.lastEdited;
    return p && p > d.updated_at ? p : d.updated_at;
  };
  const apps = drafts.filter(d => d.purpose !== "standard_answers");
  const counts = Object.fromEntries(FILTERS.map(f => [f.key, apps.filter(d => f.has(d.status)).length])) as Record<Filter, number>;
  const shown = apps.filter(d => FILTERS.find(f => f.key === filter)!.has(d.status)).sort((a, b) => {
    if (sort === "deadline") {
      // What is still being worked on comes before what has gone out.
      const closed = (x: GrantDraft) => x.status === "submitted" || x.status === "won" || x.status === "lost";
      if (closed(a) !== closed(b)) return closed(a) ? 1 : -1;
      // Soonest deadline first; no deadline after every dated one.
      if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
      if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
    }
    return edited(b).localeCompare(edited(a));
  });
  const stdPct = standard && standard.recommended ? Math.round((standard.approved / standard.recommended) * 100) : 0;

  return (
    <div>
      {isAdmin && <div className="admin-flag" style={{ marginBottom: 6 }}>Admin · {tenantName}</div>}
      <div className="page-head">
        <div><h2>Drafts</h2><p>{isAdmin
          ? `Every application For Granted is drafting for ${tenantName}, soonest deadline first.`
          : `Grant applications For Granted is preparing for ${tenantName}.`}</p></div>
        <div className="spacer" />
        {isAdmin && (
          <button className="btn inline" onClick={() => router.push("/draft/new")}
            title="Bring in a funder's application and draft it from Story Cards. For Granted only.">＋ Draft an application</button>
        )}
      </div>
      {openError && <div className="ap-error" role="alert">{openError}</div>}

      {isAdmin && standard && (
        <button type="button" className="dl-standard" onClick={() => void openStandard()} disabled={opening}>
          <div className="dl-standard-txt">
            <span className="ov-tag">Pinned</span>
            <h4>Standard Answers</h4>
            <p>The questions funders ask again and again, answered once from Story Cards and approved. Every application starts from them.</p>
          </div>
          <div className="dl-standard-prog">
            <strong>{standard.approved} of {standard.recommended}</strong>
            <span>recommended questions approved</span>
            <div className="draft-progress"><i style={{ width: `${stdPct}%` }} /></div>
            <span className="dl-open">{opening ? "Opening…" : standard.started ? "Continue →" : "Start →"}</span>
          </div>
        </button>
      )}

      {apps.length > 0 && (
        <div className="dl-tools">
          <div className="seg" role="tablist" aria-label="Show">
            {FILTERS.map(f => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
                className={`chip${filter === f.key ? " on" : ""}`} onClick={() => setFilter(f.key)}>{f.label} <span className="dl-count">{counts[f.key]}</span></button>
            ))}
          </div>
          <span className="spacer" />
          <label className="dl-sort">Sort by{" "}
            <select value={sort} onChange={e => setSort(e.target.value as "deadline" | "edited")}>
              <option value="deadline">Deadline</option>
              <option value="edited">Last edited</option>
            </select>
          </label>
        </div>
      )}

      {apps.length === 0 && <div className="empty">No applications yet.{isAdmin ? " Use Draft an application to bring one in." : " Nothing is ready to show you here yet."}</div>}
      {apps.length > 0 && shown.length === 0 && <div className="empty">Nothing here.</div>}

      {shown.length > 0 && (
        <div className="dl-list">
          <div className="dl-row dl-head" aria-hidden="true">
            <span>Application</span><span>Status</span><span>Deadline</span><span>Progress</span><span>Last edited</span>
          </div>
          {shown.map(d => {
            const p = progress[d.id];
            const done = p?.done ?? 0;
            const total = p?.total ?? 0;
            const pct = total ? Math.round((done / total) * 100) : 0;
            const due = d.deadline ? Math.ceil((asDate(d.deadline).getTime() - now) / 86_400_000) : null;
            const open = d.status === "drafting" || d.status === "client_review" || d.status === "completed";
            return (
              <Link key={d.id} href={`/drafts/${d.id}`} className="dl-row">
                <span className="dl-title">
                  <strong>{d.title}</strong>
                  <span className="dl-sub">
                    {d.funder && <span>{d.funder}</span>}
                    {money(d.amount_cents) && <span>{money(d.amount_cents)}</span>}
                    {!d.confirmed_at && <span>{d.parsed_at ? "Questions to confirm" : "Reading the application"}</span>}
                    {d.confirmed_at && d.stage && <span>Stage: {STAGE_LABEL[d.stage]}</span>}
                  </span>
                </span>
                <span><span className={`status-pill ${d.status}`}>{STATUS_LABEL[d.status]}</span></span>
                <span className={`dl-due${open && due != null && due <= 14 ? (due < 0 ? " late" : " soon") : ""}`}>
                  {d.deadline ? <>{day(d.deadline)}{open && due != null && <em>{due < 0 ? "passed" : due === 0 ? "today" : `${due} day${due === 1 ? "" : "s"}`}</em>}</> : "None set"}
                </span>
                <span className="dl-prog">
                  {total ? <>{done} of {total} done<span className="draft-progress"><i style={{ width: `${pct}%` }} /></span></> : "Not started"}
                </span>
                <span className="dl-edited">{day(edited(d))}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
