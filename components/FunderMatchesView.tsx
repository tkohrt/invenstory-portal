"use client";
// The Funding page (patch 24, the Funding split): one page, two modes, the
// chat-tabs pattern. GRANTS mode (Grant Finder) shows open calls; FUNDERS mode
// (Funder Compass) shows funders worth approaching. Each mode opens on a
// snapshot (stat tiles) with a search-history rail at the left; the switch at
// the top flips between them. Every card is a June 2026 lead, and the page
// says so rather than letting anyone forget it.
import { knownFunderMatch, RELATIONSHIP_LABEL, type KnownFunder } from "@/lib/setup";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearMatchesAction } from "@/lib/server/match-actions";
import { markFundingSeenAction, dismissFundingNoticeAction } from "@/lib/server/account-actions";
import { toggleSavedAction } from "@/lib/server/saved-actions";
import JobProgress, { useJob } from "./JobProgress";
import { useLedgerWake } from "./useLedgerWake";
import { looksAsleep } from "@/lib/ledger-wake";
import type { Job } from "@/lib/job";
import type { Verdict } from "@/lib/server/matching";
import type { FunderRow } from "@/lib/funder-rows";
import { ACCESS_LABEL, ACCESS_HELP } from "@/lib/access-mode";
import { primaryContact, freshness, ROLE_LABEL, type ContactRecord } from "@/lib/funder-contact";
import { screenFunders, hiddenByScreen } from "@/lib/funder-screen";
import {
  STATE_LABEL, STATE_HELP, statesFor, suppresses, findReason,
  FUNDER_REASONS, GRANT_REASONS,
  type TriageKind, type TriageState,
} from "@/lib/triage";
import { setTriageAction, clearTriageAction } from "@/lib/server/triage-actions";
import SearchProfilePanel, { type PanelProfile } from "./SearchProfilePanel";
import { FUNDING_KIND_LABEL, isFundingKind, type EligibilityProfile } from "@/lib/eligibility-fields";
import { SOURCE_LABEL } from "@/lib/open-data";
import ClientVerdict from "./ClientVerdict";
import { setSelfSearchAction } from "@/lib/server/client-view-actions";
import type { ClientView } from "@/lib/client-view";
import SourcesPanel from "./SourcesPanel";
import MenuButton, { MenuItem, DOTS } from "./MenuButton";
import InfoTip from "./InfoTip";
import { SPARK } from "./Spark";
import type { SourceState, SourceRun, SourceId } from "@/lib/sources";

export type FundingMode = "grants" | "funders";

/** One search in the history rail: dates and counts only, never query text. */
export interface RunRow {
  id: string; ran_at: string; kept: number; dropped: number;
  funders: number; used_profile: boolean;
  swept: number; swept_titles: string[];
  /** Patch 27 (0082): what that run newly found, and which sources answered
      (labels only). Empty for runs recorded before the migration. */
  new_titles: string[];
  sources: string[];
}

/** One saved-for-later row (patch 26), mirroring lib/server/saved.ts. */
export interface SavedRow {
  kind: "grant" | "funder"; target_id: string; title: string | null;
  detail: { funder?: string | null; url?: string | null; close_date?: string | null; award_ceiling?: number | null };
  saved_at: string;
  /** The reopen stamp (patch 28); absent on rows from before migration 0083. */
  reopened_at?: string | null;
  reopened_detail?: { grant_id?: string | null; title?: string | null; close_date?: string | null; url?: string | null; award_ceiling?: number | null };
}

interface Cached {
  grant_id: string; verdict: Verdict; reason: string | null;
  close_date: string | null; award_ceiling: number | null; matched_at: string;
  first_matched_at: string | null;
  title: string | null; funder: string | null; url: string | null;
  rationale: string | null; source_site: string | null; verified_at: string | null;
  /** Patch 4 (0073): which source, what kind of money, its currency. */
  source?: string | null; money_kind?: string | null; currency?: string | null;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  eligible: "Eligible", likely: "Likely", check: "Needs a check", watch: "Watchlist",
};

// What each rung of the ladder actually means, shown on hover.
//
// NAMING RULE (client-visible surface): clients see "Ground Truth" and nothing
// else. Never the Funder Ledger, never the vendor dataset, never the service.
// This mirrors the existing brand rule that external writing says "For Granted's
// funder discovery process" rather than naming the source. Everything a client
// reads here is For Granted's work; how it is assembled is not their concern.
//
// Every rung still ends in the same place on purpose: nothing here substitutes
// for reading the funder's own page.
/** Freshness in For Granted's own terms, never the source dataset's. */
function verified(m: { verified_at: string | null }): { label: string; help: string } {
  if (!m.verified_at) {
    return {
      label: "Not independently verified",
      help: "For Granted has not yet confirmed this record at the funder's own site. Treat the details as a starting point.",
    };
  }
  const d = new Date(m.verified_at);
  return {
    label: `Verified ${d.toLocaleDateString()}`,
    help: `A member of the For Granted team confirmed these details at the funder's own site on ${d.toLocaleDateString()}. Deadlines and priorities can still change.`,
  };
}

const VERDICT_HELP: Record<Verdict, string> = {
  eligible:
    "The eligibility text names your organization type, and nothing is blocking. "
    + "The strongest signal available from a June 2026 snapshot. Still verify at the source.",
  likely:
    "Nothing is blocking, and there is at least one real alignment signal: your state, "
    + "a cause-area overlap, or a strong alignment score. Worth an hour. Verify at the source.",
  check:
    "Either something is blocking (federal money without SAM.gov, a cost match you cannot meet), "
    + "or there is nothing to go on but topical similarity. Read the eligibility text before spending time on it.",
  watch:
    "Not open right now. The last cycle has closed and the fit looks real, so it is worth watching "
    + "for the next one. Save it, and confirm dates on the funder's own page as the season approaches.",
};

/**
 * When this first appeared, which is a different question from when it was
 * last confirmed.
 *
 * matched_at cannot answer it. A run is a snapshot: every surviving row is
 * stamped with the same time and anything the run did not return is swept, so
 * matched_at is identical on every row in the table and a column built on it
 * would repeat one date down the page. first_matched_at is set on insert and
 * never updated, so it survives later runs.
 *
 * "New" is judged against THIS run rather than against the clock, so a
 * shortlist read a week after the run that produced it still says which rows
 * were new to that run.
 */
function firstSeen(row: { matched_at?: string | null; first_matched_at?: string | null }):
  { label: string; help: string } {
  const first = row.first_matched_at ? new Date(row.first_matched_at) : null;
  if (!first || isNaN(first.getTime())) {
    return { label: "Earlier", help: "This predates the record of when matches first appeared." };
  }
  const run = row.matched_at ? new Date(row.matched_at) : null;
  // A minute of slack: the row's timestamp is set by the database on insert
  // and the run's by the application, so they are close rather than equal.
  const isNew = !!run && !isNaN(run.getTime()) && first.getTime() >= run.getTime() - 60_000;
  return isNew
    ? { label: "New", help: "First surfaced by the most recent run. It was not on the previous shortlist." }
    : {
        label: first.toLocaleDateString(),
        help: `First surfaced on ${first.toLocaleDateString()} and returned by every run since, including the most recent.`,
      };
}

function money(n: number | null, currency?: string | null) {
  if (n == null) return "Not stated";
  // EU calls are in euros (patch 4); everything before was US dollars.
  const c = (currency ?? "USD").toUpperCase();
  const sym = c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : `${c} `;
  return n >= 1_000_000 ? `${sym}${(n / 1_000_000).toFixed(1)}M` : `${sym}${Math.round(n / 1000)}K`;
}

/** Where a row came from, when it is not Ground Truth, and what kind of money it is. */
function originLine(source?: string | null, kind?: string | null): string | null {
  const bits: string[] = [];
  if (source && source !== "ledger" && SOURCE_LABEL[source]) bits.push(`from ${SOURCE_LABEL[source]}`);
  if (kind && kind !== "grants" && isFundingKind(kind)) bits.push(FUNDING_KIND_LABEL[kind]);
  return bits.length ? bits.join(" · ") : null;
}

function deadline(d: string | null) {
  if (!d) return "Rolling";
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
  const label = new Date(d).toLocaleDateString();
  if (days < 0) return `${label} (closed)`;
  if (days <= 30) return `${label} · ${days}d left`;
  return label;
}

/** Peer grantees, phrased as evidence for an approach rather than a promise. */
function evidenceText(f: FunderRow): string {
  // Amounts and years included: "Goodwill of NW Ohio ($1.0M, 2023)" is a
  // reason to write the letter, where a bare name is only a hint.
  const shown = f.evidence.slice(0, 3).filter(e => e.name).map(e => {
    const bits = [e.total_usd ? money(e.total_usd) : null, e.latest_year].filter(Boolean);
    return bits.length ? `${e.name} (${bits.join(", ")})` : e.name;
  });
  if (!shown.length) return "";
  // Counted against the true total, not the twelve rows we store: a funder with
  // fifty grantees should read "and 47 more", not "and 9 more".
  const more = Math.max(0, (f.evidence_count || f.evidence.length) - shown.length);
  return more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
}

/**
 * What a row is actually claiming.
 *
 * Three different things end up in this table and only one of them is a match
 * against this client. Saying so is the difference between a shortlist someone
 * can trust and a list that quietly overstates its own evidence.
 */
function signal(f: FunderRow): { label: string; cls: string; help: string } {
  if (f.from_graph) return {
    label: "Already funds peers", cls: "fm-eligible",
    help: "On the giving history on record, this funder has made grants to organizations like this one. The strongest signal on this page, and still a June 2026 record, so confirm it before acting.",
  };
  if (f.from_overlay) return {
    label: "For Granted record", cls: "",
    help: "A funder For Granted added or verified directly. It has not been assessed against this organization specifically; it is here because the team thought it worth knowing about.",
  };
  return {
    label: "Focus aligns", cls: "",
    help: "Their stated focus lines up with this organization's work. Weaker than a giving history: read their guidelines before investing time.",
  };
}

export default function FunderMatchesView({
  matches, funders, orgName, configured, health, isAdmin, contacts, eligibility,
  profile, lastQueries, matchJob, profileJob, profileStored, pendingRationales, judgments, webSection = null,
  canRun = false, viewingAsClient = false, selfSearch = null, clientViews = {},
  sources = [], sourcesRun = { ranAt: null, bySource: {} }, selfSearchOn = false, knownFunders = [],
  mode = "grants", runs = [], grantsOn = true, fundersOn = true, seenAt = null, savedItems = [], dismissedNotices = [], focusId = null,
}: {
  /** Row to scroll to and flash (patch 32): "g:<grant_id>" or "f:<funder_id>". */
  focusId?: string | null;
  /** Notification-bar keys this person has dismissed (patch 28). */
  dismissedNotices?: string[];
  /** When this client last visited this mode (patch 25); null for admins, the
      as-client preview, and a first visit. Drives the NEW tags. */
  seenAt?: string | null;
  /** The save-for-later bucket (patch 26). Survives sweeps; newest first. */
  savedItems?: SavedRow[];
  /** Which Funding mode this page shows (patch 24). The page clamps it to an enabled mode for clients. */
  mode?: FundingMode;
  /** The search history, newest first: dates and counts only, no query text. */
  runs?: RunRow[];
  /** Whether each mode is on for this client (admins: always both). Drives which switch pills show. */
  grantsOn?: boolean;
  fundersOn?: boolean;
  /** Funders the client said they already know, from company setup (patch 14). */
  knownFunders?: KnownFunder[];
  /** Every source and whether it is searched (patch 11). */
  sources?: SourceState[];
  /** What each source did on the last run, with no query text. */
  sourcesRun?: { ranAt: string | null; bySource: Partial<Record<SourceId, SourceRun>> };
  /** Whether this client may run searches (and so change sources) itself. */
  selfSearchOn?: boolean;
  /** May start a search from this page: For Granted, or a client allowed to (patch 7). */
  canRun?: boolean;
  /** For Granted looking at the page as the client sees it (?view=client). */
  viewingAsClient?: boolean;
  /** The "run searches themselves" switch, for For Granted; null for a client. */
  selfSearch?: boolean | null;
  /** The client's own Worth a look / Not for us, keyed "kind:id". */
  clientViews?: Record<string, ClientView>;
  /** Found on the web (patch 5), rendered by the page and placed after the funders. */
  webSection?: React.ReactNode;
  matches: Cached[]; funders: FunderRow[]; orgName: string; configured: boolean;
  /** Matches still owed a real explanation, because a run was cut short. */
  pendingRationales: number;
  health: { ok: boolean; detail: string }; isAdmin: boolean;
  /** For Granted internal, admin sessions only. Empty for a client. */
  contacts: Record<string, ContactRecord[]>;
  /** Drives the eligibility screen. Null means run the data-quality screen only. */
  eligibility: EligibilityProfile | null;
  /** For Granted's working view of what the search is built from. Admin only. */
  profile: PanelProfile | null;
  lastQueries: { track: string; text: string }[];
  /** Work already in flight when the page loaded, so a reload rejoins it. */
  matchJob: Job | null;
  profileJob: Job | null;
  /** Documents already read and kept for this client, from the server. */
  profileStored: { done: number; total: number };
  /**
   * What For Granted has already decided about these rows, keyed "kind:id".
   *
   * Kept in its own table rather than on the match rows, so a run that sweeps
   * a row away does not sweep the judgment with it. Empty for a client session.
   */
  judgments: Record<string, {
    state: TriageState; reason: string | null; note: string | null; decidedAt: string;
  }>;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The run happens on the server against a job row, not in this tab, so the
  // page can be closed and come back to it.
  const { job, events, start: startJob, starting, running, error: jobError, gaveUp } = useJob(matchJob);
  const [dismissed, setDismissed] = useState(false);
  const shownJob = dismissed ? null : job;

  // Refresh once the work lands, so the tables show the new run rather than
  // asking somebody to reload.
  const finished = job?.status;
  // Refresh on failure as well as success: a run can fail after the grant
  // tables were replaced, and reading a stale table beside a failure banner is
  // how somebody acts on the wrong data.
  useEffect(() => {
    if (finished === "done" || finished === "failed") router.refresh();
    if (finished === "done" && job?.id) setDigestFor(job.id);
  }, [finished, router, job?.id]);
  // Rows the source records as making no grants to anyone. Set aside rather
  // than dropped, and one click from view, so a wrong screen is visible.
  const [showNoHistory, setShowNoHistory] = useState(false);
  // Rows For Granted has ruled out. Set aside at RENDER time rather than
  // dropped from the run, so the judgment stays reversible and the row's
  // first-seen date stays honest if it is ever put back.
  const [showRuledOut, setShowRuledOut] = useState(false);
  const judgmentOf = (kind: TriageKind, id: string) => judgments[`${kind}:${id}`] ?? null;
  const isRuledOut = (kind: TriageKind, id: string) => {
    const j = judgmentOf(kind, id);
    return !!j && suppresses(j.state);
  };

  const screened = screenFunders(funders, eligibility);
  const afterScreen = showNoHistory
    ? [...screened.shown, ...screened.hidden.map(h => h.row)]
    : screened.shown;
  const ruledOutFunders = afterScreen.filter(f => isRuledOut("funder", f.funder_id));
  const visibleFunders0 = showRuledOut
    ? afterScreen
    : afterScreen.filter(f => !isRuledOut("funder", f.funder_id));

  const ruledOutGrants = matches.filter(m => isRuledOut("grant", m.grant_id));
  const visibleMatches0 = showRuledOut
    ? matches
    : matches.filter(m => !isRuledOut("grant", m.grant_id));

  // The client's own "Not for us" rows step aside on their page, one click
  // from view (patch 7). For Granted always sees them, with the client's words.
  const viewOf = (kind: "grant" | "funder", id: string) => clientViews[`${kind}:${id}`] ?? null;
  const [showSetAside, setShowSetAside] = useState(false);
  const setAside = (kind: "grant" | "funder", id: string) => !isAdmin && viewOf(kind, id)?.state === "not_for_us";
  const visibleMatches = showSetAside ? visibleMatches0 : visibleMatches0.filter(m => !setAside("grant", m.grant_id));
  const visibleFunders = showSetAside ? visibleFunders0 : visibleFunders0.filter(f => !setAside("funder", f.funder_id));
  // The Watchlist (patch 26): closed-but-aligned calls live under their own
  // panel, never among open calls, so every "open" number excludes them.
  const openMatches = visibleMatches.filter(m => m.verdict !== "watch");
  const watchMatches = visibleMatches.filter(m => m.verdict === "watch");
  const openMatchesAll = matches.filter(m => m.verdict !== "watch");
  // Counted for the mode on screen, so the toggle's number matches its table.
  const modeSetAside = mode === "grants"
    ? matches.filter(m => setAside("grant", m.grant_id)).length
    : funders.filter(f => setAside("funder", f.funder_id)).length;
  const modeRuledOut = mode === "grants" ? ruledOutGrants.length : ruledOutFunders.length;
  // Why rows were set aside, so the toggle names a reason rather than a number.
  const hiddenReasons = [...new Set(screened.hidden.map(h => h.reason))];

  // Wake the funding service on load, in its own request. It sleeps when idle
  // and the first call after a nap spends most of a minute starting up, which
  // inside a run is the difference between finishing and being killed at the
  // function limit. Out here it costs nothing: by the time somebody has read
  // the page and pressed Run, it is usually already awake.
  // Patch 19: the page now knows when the wake-up has finished, so a search
  // pressed before then waits for it (up to half a minute) instead of failing.
  const lw = useLedgerWake(canRun && configured);
  const [waitingForWake, setWaitingForWake] = useState(false);
  const run = async () => {
    setDismissed(false); setErr(null);
    if (lw.waking) { setWaitingForWake(true); await lw.ready(); setWaitingForWake(false); }
    void startJob("/api/jobs/match", "match");
  };

  // A run that still found Ground Truth asleep is tried again once, on its
  // own, after waking it. Only a run started on this visit; an old failure
  // shown on load is left as it is.
  const [openedAt] = useState(() => Date.now());
  const retried = useRef(false);
  const [wakeNotice, setWakeNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!canRun || retried.current || job?.status !== "failed" || !looksAsleep(job.error)) return;
    if (Date.parse(job.startedAt) < openedAt) return;
    retried.current = true;
    // Not cleared on re-render: the retry flag is already set, so clearing it
    // here would lose the retry for good.
    setTimeout(() => {
      setWakeNotice("Ground Truth was asleep. It is starting up now, and the search will try again on its own.");
      setDismissed(true);
      void lw.wakeAgain()
        .then(() => { setDismissed(false); return startJob("/api/jobs/match", "match"); })
        .finally(() => setWakeNotice(null));
    }, 0);
  }, [canRun, job?.status, job?.error, job?.startedAt, openedAt, lw, startJob]);

  // Explanations are the long tail of a run and the part most likely to be cut
  // off by the function limit. They are also the only part that is safe to
  // resume, so the page keeps asking until nothing is owed.
  const { job: rJob, events: rEvents, start: startRationales, running: rRunning, gaveUp: rGaveUp } = useJob(null);

  // Derived, not mirrored. The prop is the truth after any refresh; a finished
  // pass reports what it left behind, and that reading wins until the next one.
  const lastPass = rJob?.status === "done"
    ? Number((rJob.result as { remaining?: number } | null)?.remaining ?? 0)
    : null;
  const owed = lastPass ?? pendingRationales;

  const rFinished = rJob?.status;
  useEffect(() => {
    if (rFinished !== "done") return;
    router.refresh();
    // Still owed after a pass means the budget ran out, not that it failed.
    // Another pass picks up where this one stopped.
    const remaining = Number((rJob?.result as { remaining?: number } | null)?.remaining ?? 0);
    if (remaining > 0) void startRationales("/api/jobs/rationales", "rationales");
  }, [rFinished, rJob, router, startRationales]);

  const clear = () => start(async () => {
    try { await clearMatchesAction(); setErr(null); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not clear."); }
  });

  /**
   * The heading, the caveat and the button that runs a search.
   *
   * Held in a variable rather than written inline because it moves. For an
   * admin the profile is the INPUT to a match and belongs above the thing it
   * feeds; the order on screen then matches the order of the work. A client
   * never sees the profile, so for them this stays where it was, at the top.
   */
  // Patch 11 and 12: who may search sits with the sources, in the Sources
  // panel, rather than as its own bar on the page.
  const [selfErr, setSelfErr] = useState<string | null>(null);
  const selfSearchSlot = isAdmin && selfSearch !== null ? (
    <div className="fm-selfsearch">
      <button type="button" role="switch" aria-checked={!!selfSearch} aria-label={`Let ${orgName} run searches themselves`} className="rs-switch"
        onClick={() => { setSelfErr(null); void setSelfSearchAction(!selfSearch).then(r => { if (!r.ok) setSelfErr(r.error); router.refresh(); }); }} />
      <span>
        <strong>Let {orgName} run searches themselves</strong>
        <span className="src-meta fm-block">{selfSearch
          ? "On: they can search for funding, search the web and change any source not locked, up to three searches and two web searches a day, within their AI allowance."
          : "Off: For Granted runs every search and chooses the sources."}</span>
        {selfErr && <span className="ap-error fm-block" role="alert">{selfErr}</span>}
      </span>
    </div>
  ) : null;

  const runLabel = waitingForWake || wakeNotice ? "Waiting for Ground Truth…" : running ? "Searching…" : starting ? "Starting…"
    : matches.length ? (isAdmin ? "Re-run matching" : "Search again") : (isAdmin ? "Run matching" : "Search for funding");
  const hasResults = matches.length > 0 || funders.length > 0;

  // The mode switch (patch 24): plain links, so the browser history works and
  // nothing re-mounts the jobs machinery. A client sees only the modes turned
  // on for them; the one-pill case shows no switch at all.
  const modeHref = (m: FundingMode) => `/funding?mode=${m}${viewingAsClient ? "&view=client" : ""}`;
  const pills: { m: FundingMode; label: string }[] = [];
  if (isAdmin || grantsOn) pills.push({ m: "grants", label: "Grants" });
  if (isAdmin || fundersOn) pills.push({ m: "funders", label: "Funders" });
  const modeSwitch = pills.length > 1 ? (
    <div role="group" aria-label="Grants or funders" className="fund-switch">
      {pills.map(p => (
        <a key={p.m} href={modeHref(p.m)} aria-current={mode === p.m ? "page" : undefined}
           className={mode === p.m ? "on" : ""}>{p.label}</a>
      ))}
    </div>
  ) : null;

  /**
   * NEW, for a client, means new since YOUR last visit to this mode (patch
   * 25), not new to the latest run: two searches between visits keep both
   * batches tagged until the client comes back. A first visit shows no tags
   * (a wall of NEW on day one would make the word meaningless) and quietly
   * sets the baseline. Admins keep the run-relative reading, which is the
   * right question for the person running searches.
   */
  const rowIsNew = (row: { matched_at?: string | null; first_matched_at?: string | null }): boolean => {
    if (isAdmin) return firstSeen(row).label === "New";
    if (!seenAt || !row.first_matched_at) return false;
    return new Date(row.first_matched_at).getTime() > new Date(seenAt).getTime();
  };
  const newHelp = isAdmin
    ? "First surfaced by the most recent run. It was not on the previous shortlist."
    : "First appeared since your last visit to this page.";

  // Record the visit once per mode, clients only (the action ignores admins
  // too, so a preview can never consume the client's tags). The tags on screen
  // stay for this whole visit; the next visit starts from now.
  useEffect(() => {
    if (!isAdmin && !viewingAsClient) void markFundingSeenAction(mode);
  }, [isAdmin, viewingAsClient, mode]);

  // The run digest (patch 25): when a search finishes on this visit, one
  // dismissible line reports what happened, disappearances included.
  const [digestFor, setDigestFor] = useState<string | null>(null);

  // Which past search's summary is open in the rail (patch 27); one at a time.
  const [openRun, setOpenRun] = useState<string | null>(null);

  // Row focus (patch 32): ?focus=g:<id> or f:<id>, set by the global search
  // bar's suggestions, scrolls to the row and flashes it once. The first
  // matching row wins (a saved grant can render in two sections).
  useEffect(() => {
    if (!focusId) return;
    const el = document.querySelector(`[data-gid="${CSS.escape(focusId)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("fm-focus-flash");
    const t = setTimeout(() => el.classList.remove("fm-focus-flash"), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  // Save for later (patch 26): the star. Optimistic, with the server's answer
  // winning: a failed toggle puts the star back and says why.
  const savedKeyOf = (kind: string, id: string) => `${kind}:${id}`;
  const savedBase = new Set(savedItems.map(s2 => savedKeyOf(s2.kind, s2.target_id)));
  const [savedOverride, setSavedOverride] = useState<Record<string, boolean>>({});
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const isSaved = (kind: "grant" | "funder", id: string) =>
    savedOverride[savedKeyOf(kind, id)] ?? savedBase.has(savedKeyOf(kind, id));
  const toggleSave = async (m: { grant_id: string; title: string | null; funder: string | null; url: string | null; close_date: string | null; award_ceiling: number | null }) => {
    const key = savedKeyOf("grant", m.grant_id);
    const next = !isSaved("grant", m.grant_id);
    setSavedOverride(o => ({ ...o, [key]: next }));
    const r = await toggleSavedAction({
      kind: "grant", target_id: m.grant_id, title: m.title,
      detail: { funder: m.funder, url: m.url, close_date: m.close_date, award_ceiling: m.award_ceiling },
    });
    if ("error" in r) { setSavedOverride(o => ({ ...o, [key]: !next })); setSaveErr(r.error); }
    else setSaveErr(null);
  };
  const SaveStar = ({ m }: { m: { grant_id: string; title: string | null; funder: string | null; url: string | null; close_date: string | null; award_ceiling: number | null } }) => {
    const on = isSaved("grant", m.grant_id);
    return (
      <button type="button" className={`fm-star${on ? " fm-star-on" : ""}`} aria-pressed={on}
        title={on ? "Remove from your saved list." : "Save for later. Saved grants keep their place even after a new search replaces this list."}
        onClick={() => void toggleSave(m)}>
        {on ? "★ Saved" : "☆ Save"}
      </button>
    );
  };
  // The saved bucket as this visit sees it: the server list, minus removals,
  // plus stars pressed just now (rendered from the live row they came from).
  const savedGrants = [
    ...Object.entries(savedOverride)
      .filter(([k, v]) => v && k.startsWith("grant:") && !savedBase.has(k))
      .map(([k]) => {
        const id = k.slice("grant:".length);
        const m = matches.find(x => x.grant_id === id);
        return {
          kind: "grant" as const, target_id: id, title: m?.title ?? id,
          detail: { funder: m?.funder ?? null, url: m?.url ?? null, close_date: m?.close_date ?? null, award_ceiling: m?.award_ceiling ?? null },
          saved_at: new Date().toISOString(),
          reopened_at: null as string | null,
          reopened_detail: {} as SavedRow["reopened_detail"],
        };
      }),
    ...savedItems.filter(s2 => s2.kind === "grant"),
  ].filter(s2 => savedOverride[savedKeyOf("grant", s2.target_id)] !== false);

  // The snapshot tiles and the history rail read the lists as this session
  // sees them (after screening, triage and the client's own Not-for-us), so
  // the numbers match the tables below them.
  const newGrants = () => openMatches.filter(m => rowIsNew(m)).length;
  const closingSoon = () => openMatches.filter(m => {
    if (!m.close_date) return false;
    const days = Math.ceil((new Date(m.close_date).getTime() - Date.now()) / 86_400_000);
    return days >= 0 && days <= 30;
  }).length;

  // Freshness of the whole page: when the last search ran, in plain words,
  // wearing the attention color from two weeks and graduating to a notice
  // past thirty days (the staleness ladder, decided 10 Nov).
  const latestRunAt = runs[0]?.ran_at ?? null;
  const ageDays = latestRunAt ? Math.floor((Date.now() - new Date(latestRunAt).getTime()) / 86_400_000) : null;
  const ageLabel = ageDays == null ? null
    : ageDays <= 0 ? "Updated today" : ageDays === 1 ? "Updated yesterday"
    : ageDays < 14 ? `Updated ${ageDays} days ago`
    : ageDays <= 30 ? `Updated ${Math.round(ageDays / 7)} weeks ago`
    : `Updated ${new Date(latestRunAt!).toLocaleDateString()}`;
  const ageCls = ageDays == null ? "" : ageDays > 30 ? " fund-age-stale" : ageDays >= 14 ? " fund-age-aging" : "";

  // The notification bar (patch 28; ladder decided 10 Nov): one bar per page
  // visit, chosen by priority, always news or a reward, never a chore list,
  // dismissible by the news's own key so the same news never returns. The run
  // digest outranks everything while it is showing. Grants rungs built here:
  // saved grant reopened, then deadline pressure on saved items, then search
  // staleness. Funders rungs: newly verified funder, then staleness. The
  // curated-list, draft-momentum and dossier rungs join as those features land.
  const [dismissedLocal, setDismissedLocal] = useState<string[]>([]);
  const isDismissed = (k: string) => dismissedNotices.includes(k) || dismissedLocal.includes(k);
  const dismissNotice = (k: string) => {
    setDismissedLocal(d => [...d, k]);
    if (!viewingAsClient) void dismissFundingNoticeAction(k);
  };
  const notice = ((): { key: string; text: string; cta?: { href: string; label: string } } | null => {
    if (digestFor) return null; // the digest is the bar right now
    if (mode === "grants") {
      const reopened = savedItems.find(s2 => s2.kind === "grant" && s2.reopened_at
        && savedOverride[savedKeyOf("grant", s2.target_id)] !== false
        && !isDismissed(`reopen:${s2.target_id}:${s2.reopened_at}`));
      if (reopened) {
        const d = reopened.reopened_detail ?? {};
        const closes = d.close_date ? `, and closes ${new Date(d.close_date).toLocaleDateString()}` : "";
        return {
          key: `reopen:${reopened.target_id}:${reopened.reopened_at}`,
          text: `Good news: ${d.title ?? reopened.title ?? "a grant you saved"} is open again${closes}. You saved it for exactly this.`,
          cta: { href: "#fm-calls", label: "See the call" },
        };
      }
      for (const m of openMatches) {
        if (!m.close_date || !isSaved("grant", m.grant_id)) continue;
        const days = Math.ceil((new Date(m.close_date).getTime() - Date.now()) / 86_400_000);
        if (days < 0 || days > 14) continue;
        const k = `deadline:${m.grant_id}:${m.close_date}`;
        if (isDismissed(k)) continue;
        return {
          key: k,
          text: `${m.title ?? "A grant you saved"} closes ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}. It is on your saved list.`,
          cta: { href: "#fm-calls", label: "See the call" },
        };
      }
    }
    if (mode === "funders") {
      const nv = visibleFunders.filter(f => f.verified_at && rowIsNew(f));
      if (nv.length) {
        const k = `verified:${nv[0].funder_id}:${nv[0].first_matched_at ?? ""}`;
        if (!isDismissed(k)) {
          return {
            key: k,
            text: nv.length === 1
              ? `${nv[0].name} was verified by For Granted since your last visit.`
              : `${nv.length} funders were verified by For Granted since your last visit.`,
          };
        }
      }
    }
    if (hasResults && canRun && ageDays != null && ageDays > 30 && runs[0] && !isDismissed(`stale:${runs[0].id}`)) {
      return {
        key: `stale:${runs[0].id}`,
        text: `These results are from ${new Date(latestRunAt!).toLocaleDateString()}. A fresh search usually finds new openings; the ${isAdmin ? "Run matching" : "Search"} button above does it.`,
      };
    }
    return null;
  })();

  /**
   * The heading and the page's actions (patch 12, the Storyboard rules): the
   * title first; Sources and the fit report as secondary buttons; rare tools in
   * the ⋯ menu; one primary, the search.
   */
  const heading = (
    <>
      <div className="page-head fm-head">
        <div className="fm-head-text">
          <div className="fund-title-row">
            <h2>Funding</h2>
            {modeSwitch}
          </div>
          <p>
            {mode === "grants"
              ? <>Open calls screened for {orgName}: eligibility first, then the soonest deadline.</>
              : <>Funders whose giving lines up with {orgName}&apos;s work, with the evidence.</>}{" "}
            <InfoTip label="How to read these matches">
              {isAdmin
                ? <>Anything not yet checked against Ground Truth is a <strong>lead, not a fact</strong>. Verify eligibility and deadlines on the funder&apos;s own site before it reaches a client or an application.</>
                : <>Every match is a lead. Check deadlines and eligibility on the funder&apos;s own site before you apply; your For Granted team can help.</>}
            </InfoTip>
          </p>
        </div>
        <span className="spacer" />
        <div className="fm-actions">
          {sources.length > 0 && (
            <span data-tour="fm-sources" className="fm-tour-wrap"><SourcesPanel states={sources} lastRun={sourcesRun} orgName={orgName}
              role={isAdmin ? "admin" : "client"} preview={viewingAsClient} selfSearch={selfSearchOn}
              canRun={canRun && configured} running={running || starting || waitingForWake || !!wakeNotice} onRun={() => void run()} adminSlot={selfSearchSlot} /></span>
          )}
          {/* Patch 6 (1 Nov 2026): every lead on one printable page with the fit answers. */}
          {hasResults && <a className="sb-btn sb-secondary" href="/funder-matches/report" data-tour="fm-report">Open the fit report</a>}
          {isAdmin && (
            <MenuButton label="More Funder Matches actions" icon={DOTS}>
              <MenuItem title={`View as ${orgName}`} hint="This page exactly as the client sees it, with nothing changeable."
                onClick={() => router.push(`/funding?mode=${mode}&view=client`)} />
              <MenuItem title="Clear cached matches" hint="Empties these tables. The next search builds them again."
                disabled={!hasResults || pending} onClick={clear} />
            </MenuButton>
          )}
          {canRun && (
            <button type="button" className="sb-btn sb-primary" data-tour="fm-search" onClick={() => void run()} disabled={starting || running || waitingForWake || !!wakeNotice || !configured}
              title={!configured ? "Ground Truth is not connected yet." : isAdmin ? undefined : "Searches Ground Truth and the sources listed under Sources. Uses part of the monthly AI allowance."}>
              {runLabel}
            </button>
          )}
        </div>
      </div>

      {/* If the sources could not be read, the switch must still be reachable. */}
      {sources.length === 0 && selfSearchSlot}

      {/* Patch 7: For Granted sees the page as the client does. */}
      {viewingAsClient && (
        <div className="ov-note fm-asclient">
          You are seeing this page as {orgName} sees it: no contacts, no Search Profile, none of For Granted&apos;s
          decisions, and nothing For Granted ruled out. <a href={`/funding?mode=${mode}`}>Back to For Granted&apos;s view</a>
        </div>
      )}

      {!configured && (
        <div className="ov-note">
          {isAdmin
            ? <>Ground Truth is not connected in this environment. Set <code>FUNDER_LEDGER_URL</code>{" "}
              and <code>FUNDER_LEDGER_KEY</code> and this page goes live.</>
            : <>Ground Truth is being prepared for {orgName}. Your For Granted team will be in touch
              once matches are ready.</>}
        </div>
      )}
      {configured && !health.ok && (
        <div className="ov-note">{isAdmin ? `Ground Truth status: ${health.detail}` : "Matches are being refreshed."}</div>
      )}
    </>
  );

  /**
   * What For Granted thinks of one row, and how to change it.
   *
   * One component for both lanes, because the mechanics are identical and only
   * the words differ. The reason picker appears only for a state that rules the
   * row out, since that is exactly when a reason is required: a rejection with
   * no reason cannot be counted, cannot suppress usefully, and cannot become a
   * correction to the shared record.
   */
  const Triage = ({ kind, id, label }: { kind: TriageKind; id: string; label: string }) => {
    const j = judgmentOf(kind, id);
    const [picking, setPicking] = useState<TriageState | null>(null);
    const [busy, setBusy] = useState(false);

    const apply = (state: TriageState, reason?: string) => {
      setBusy(true);
      setTriageAction({ kind, targetId: id, label, state, reason: reason ?? null })
        .then(() => setPicking(null))
        .catch(e => setErr(e instanceof Error ? e.message : "That did not save."))
        .finally(() => { setBusy(false); router.refresh(); });
    };
    const undo = () => {
      setBusy(true);
      clearTriageAction(kind, id)
        .catch(e => setErr(e instanceof Error ? e.message : "That did not save."))
        .finally(() => { setBusy(false); router.refresh(); });
    };

    if (picking) {
      const codes = kind === "funder" ? FUNDER_REASONS : GRANT_REASONS;
      return (
        <div className="tri-reasons" role="group" aria-label={`Why ${STATE_LABEL[picking].toLowerCase()}?`}>
          <div className="tri-reasons-head">Why {STATE_LABEL[picking].toLowerCase()}?</div>
          {codes.map(c => (
            <button key={c.code} type="button" className="tri-reason" disabled={busy}
                    title={c.global
                      ? `${c.help} Filed as a proposed Ground Truth correction for review.`
                      : c.help}
                    onClick={() => apply(picking, c.code)}>
              {c.label}{c.global && <span className="tri-global" title="True for every client. Goes to the Ground Truth queue as a proposal.">shared</span>}
            </button>
          ))}
          <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setPicking(null)}>Cancel</button>
        </div>
      );
    }

    if (j) {
      const r = findReason(kind, j.reason);
      return (
        <div className="tri-set">
          <span className={`ov-tag tri-${j.state}`} title={STATE_HELP[j.state]}>
            {STATE_LABEL[j.state]}
          </span>
          {r && <span className="tri-why" title={r.help}>{r.label}</span>}
          <button type="button" className="sb-btn sb-quiet sb-sm" disabled={busy} onClick={undo}
            aria-label={`Undo ${STATE_LABEL[j.state]} for ${label}`}>Undo</button>
        </div>
      );
    }

    return (
      <MenuButton label={`Decide on ${label}`} text="Decide" small floating>
        {statesFor(kind).map(st => (
          <MenuItem key={st} title={STATE_LABEL[st]} hint={STATE_HELP[st]} disabled={busy}
            onClick={() => suppresses(st) ? setPicking(st) : apply(st)} />
        ))}
      </MenuButton>
    );
  };

  const compiled = matches[0]?.matched_at ?? funders[0]?.matched_at ?? null;

  return (
    <div className="fm-page">
      {heading}
      {/* The Search Profile is the input to a match, For Granted's only. Under
          the title (patch 12), not above it: the page's subject comes first. */}
      {isAdmin && (
        <SearchProfilePanel
          profile={profile} lastQueries={lastQueries} orgName={orgName}
          job={profileJob} stored={profileStored} />
      )}

      {(wakeNotice || (canRun && configured && lw.waking && waitingForWake)) && (
        <p className="fm-wake" role="status">{wakeNotice ?? "Waking Ground Truth, which naps when nobody has searched for a while. Your search starts as soon as it answers."}</p>
      )}
      <JobProgress job={shownJob} events={events} onDismiss={() => setDismissed(true)} lostContact={gaveUp} />
      <JobProgress job={rJob} events={rEvents} lostContact={rGaveUp} />

      {canRun && owed > 0 && !rRunning && (
        <div className="ov-note fm-owed">
          {owed} match{owed === 1 ? "" : "es"} {owed === 1 ? "is" : "are"} showing a
          rule-based summary because the last run ran out of time before explaining
          {owed === 1 ? " it" : " them"}.
          {" "}
          <button type="button" className="sb-btn sb-ai sb-sm" title="Writes the missing explanations. Uses a small part of the monthly AI allowance."
                  onClick={() => void startRationales("/api/jobs/rationales", "rationales")}>
            {SPARK}Finish the explanations
          </button>
        </div>
      )}
      {jobError && <div className="ap-error" role="alert">{jobError}</div>}
      {err && <div className="ap-error" role="alert">{err}</div>}

      {/* The run digest (patch 25): what the search that just finished did,
          disappearances included, so nothing drops off the list silently. */}
      {digestFor && runs[0] && (
        <div className="ov-note fund-digest" role="status">
          Search finished: {runs[0].kept} open call{runs[0].kept === 1 ? "" : "s"} ({newGrants()} new), {runs[0].funders} funder{runs[0].funders === 1 ? "" : "s"}
          {runs[0].swept > 0 && (
            <span title={runs[0].swept_titles.length ? `No longer returned by any source: ${runs[0].swept_titles.join("; ")}` : undefined}>
              , {runs[0].swept} no longer open
            </span>
          )}.
          <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setDigestFor(null)}>Dismiss</button>
        </div>
      )}

      {/* The notification bar (patch 28): one per visit, by the ladder, always
          news or a reward, dismissible. The run digest above outranks it. */}
      {notice && (
        <div className="ov-note fund-digest" role="status">
          {notice.text}
          {notice.cta && <a className="sb-btn sb-secondary sb-sm" href={notice.cta.href}>{notice.cta.label}</a>}
          <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => dismissNotice(notice.key)}>Dismiss</button>
        </div>
      )}

      <div className="fund-body">
        {/* The search history: every run, dates and counts only. Current
            results always sit on top, with the page's freshness in plain
            words. Results roll up into the tables; past runs are the record
            of the work (decided 10 Nov). */}
        <aside className="fund-rail" aria-label="Search history">
          <div className="fund-rail-head">{mode === "grants" ? "Grant searches" : "Funder searches"}</div>
          <div className="fund-run on">
            <strong>Current results</strong>
            <span className={`fund-run-meta${ageCls}`}>{ageLabel ?? (compiled ? `Compiled ${new Date(compiled).toLocaleDateString()}` : "No search yet")}</span>
            <span className="fund-run-meta">
              {mode === "grants"
                ? `${openMatches.length} open call${openMatches.length === 1 ? "" : "s"}`
                : `${visibleFunders.length} funder${visibleFunders.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {/* Each past search opens a lightweight read-only summary (patch 27,
              decided 10 Nov): results roll up into Current results only, and
              the rail keeps the record of the work. Dates, counts and source
              labels, never the query text. */}
          {runs.map((r, i) => (
            <div key={r.id} className="fund-run">
              <button type="button" className="fund-run-btn" aria-expanded={openRun === r.id}
                onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                title={openRun === r.id ? "Close this search's summary" : "Open this search's summary"}>
                <strong>{new Date(r.ran_at).toLocaleDateString()}{i === 0 ? " · latest" : ""}</strong>
                <span className="fund-run-meta">{r.kept} call{r.kept === 1 ? "" : "s"} · {r.funders} funder{r.funders === 1 ? "" : "s"}</span>
              </button>
              {openRun === r.id && (
                <div className="fund-run-detail">
                  <div>{new Date(r.ran_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
                  <div>{r.kept} open call{r.kept === 1 ? "" : "s"} kept · {r.dropped} screened out · {r.funders} funder{r.funders === 1 ? "" : "s"}</div>
                  {r.new_titles.length > 0 && (
                    <div><strong>New that search:</strong> {r.new_titles.join("; ")}</div>
                  )}
                  {r.swept > 0 && (
                    <div><strong>No longer open after it:</strong> {r.swept_titles.length ? r.swept_titles.join("; ") : `${r.swept} call${r.swept === 1 ? "" : "s"}`}</div>
                  )}
                  {r.sources.length > 0 && <div>Searched: {r.sources.join(", ")}</div>}
                  <div>Built from {r.used_profile ? "the Inven(s)tory" : "the eligibility answers"}.</div>
                  <div className="ov-muted">Results roll up into Current results; this is the record of the search.</div>
                </div>
              )}
            </div>
          ))}
          {runs.length === 0 && <span className="fund-run-meta fund-run-none">Searches appear here once the first one runs.</span>}
          {isAdmin && selfSearch !== null && (
            <span className="fund-run-meta fund-run-none">{orgName} {selfSearch ? "can" : "cannot"} run searches</span>
          )}
        </aside>

        <div className="fund-main">
      {/* The snapshot: four numbers that match the tables below them. */}
      {hasResults && (
        <div className="fund-tiles">
          {mode === "grants" ? (
            <>
              <div className="fund-tile"><div className="fund-n">{openMatches.length}</div><div className="fund-l">Open call{openMatches.length === 1 ? "" : "s"}</div></div>
              <div className="fund-tile"><div className="fund-n">{closingSoon()}</div><div className="fund-l">Closing within 30 days</div></div>
              <div className="fund-tile"><div className="fund-n">{watchMatches.length}</div><div className="fund-l">On your watchlist</div></div>
              <div className="fund-tile"><div className="fund-n">{savedGrants.length}</div><div className="fund-l">Saved for later</div></div>
            </>
          ) : (
            <>
              <div className="fund-tile"><div className="fund-n">{visibleFunders.length}</div><div className="fund-l">Aligned funder{visibleFunders.length === 1 ? "" : "s"}</div></div>
              <div className="fund-tile"><div className="fund-n">{visibleFunders.filter(f => f.from_graph).length}</div><div className="fund-l">Already fund orgs like yours</div></div>
              <div className="fund-tile"><div className="fund-n">{visibleFunders.filter(f => f.verified_at).length}</div><div className="fund-l">Verified by For Granted</div></div>
              <div className="fund-tile"><div className="fund-n">{visibleFunders.filter(f => knownFunderMatch(f.name, knownFunders)).length}</div><div className="fund-l">Already known to you</div></div>
            </>
          )}
        </div>
      )}

      {/* A failed star says why, wherever it was pressed. */}
      {mode === "grants" && saveErr && <div className="ov-note">{saveErr}</div>}

      {mode === "grants" && (openMatchesAll.length === 0 ? (
        <div className="empty" id="fm-calls" data-tour="fm-results">
          {!hasResults
            ? <>No matches yet.{canRun && configured ? ` Press ${isAdmin ? "Run matching" : "Search for funding"} to build the list, and check Sources to see where it will look.` : " Your For Granted team will run the first search."}</>
            : <>No open calls survived screening this run.{watchMatches.length > 0 && <> The watchlist below has calls worth being ready for.</>} The funders under the Funders
              switch are still worth approaching: most foundation money never appears as a public call.</>}
        </div>
      ) : (
        <section id="fm-calls" className="fm-sec" aria-labelledby="fm-calls-h" data-tour="fm-results">
          <div className="fm-sec-head">
            <h3 id="fm-calls-h">Open calls</h3>
            <span className="fm-count">{openMatches.length}</span>
            <InfoTip label="What the verdicts mean">
              <strong>Eligible</strong>: {VERDICT_HELP.eligible}<br /><br />
              <strong>Likely</strong>: {VERDICT_HELP.likely}<br /><br />
              <strong>Needs a check</strong>: {VERDICT_HELP.check}
            </InfoTip>
          </div>
          <p className="fm-sub">Calls with a deadline or rolling intake that {orgName} could apply to. Each is a lead to confirm with the funder before applying.</p>
          <div className="fm-scroll">
          <table className="aq-table fm-table">
            <thead>
              <tr>
                <th>Opportunity</th><th>Funder</th><th>Verdict</th>
                <th>Deadline</th><th>Ceiling</th><th>Seen and checked</th>
                <th>Why this client</th>{isAdmin ? <th>Decision</th> : <th>Your view</th>}
              </tr>
            </thead>
            <tbody>
              {openMatches.map(m => (
                <tr key={m.grant_id} data-gid={`g:${m.grant_id}`}>
                  <td className="fm-name">
                    {m.url
                      ? <a href={m.url} target="_blank" rel="noopener noreferrer">{m.title || m.grant_id}</a>
                      : (m.title || m.grant_id)}
                  </td>
                  <td className="fm-funder">
                    {m.funder || <span className="ov-muted" title="The dataset does not carry a funder name for this record. Resolved once the opportunity page is fetched.">Unknown</span>}
                    {originLine(m.source, m.money_kind)
                      ? <div className="fm-listed">{originLine(m.source, m.money_kind)}</div>
                      : m.source_site && <div className="fm-listed">listed on {m.source_site.replace(/^https?:\/\//i, "").toLowerCase()}</div>}
                  </td>
                  <td>
                    <span className={`ov-tag fm-${m.verdict} fm-verdict`} title={VERDICT_HELP[m.verdict]}>
                      {VERDICT_LABEL[m.verdict]}
                    </span>
                  </td>
                  <td className="fm-nowrap">{deadline(m.close_date)}</td>
                  <td className="fm-nowrap">{money(m.award_ceiling, m.currency)}</td>
                  <td className="fm-seen">
                    {/* Patch 12: first seen and verified share a column, so the reason fits beside them. */}
                    <span className={rowIsNew(m) ? "fm-new" : "ov-muted"}
                          title={rowIsNew(m) ? newHelp : firstSeen(m).help}>{rowIsNew(m) ? "New" : firstSeen(m).label === "Earlier" ? "Earlier" : `Since ${firstSeen(m).label === "New" ? new Date(m.first_matched_at!).toLocaleDateString() : firstSeen(m).label}`}</span>
                    <div className={m.verified_at ? "fm-verified" : "ov-muted"} title={verified(m).help}>
                      {verified(m).label}
                    </div>
                  </td>
                  <td className="fm-why">
                    {m.rationale || <span className="ov-muted">{m.reason ?? "No explanation yet"}</span>}
                    {m.rationale && m.reason && (
                      <div className="fm-screen">Screen: {m.reason}</div>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="fm-decide">
                      <Triage kind="grant" id={m.grant_id} label={m.title || m.grant_id} />
                      <ClientVerdict kind="grant" targetId={m.grant_id} view={viewOf("grant", m.grant_id)} mode="admin" />
                      <a className="sb-btn sb-secondary sb-sm fm-draft" href={`/draft/new?grant=${encodeURIComponent(m.grant_id)}`}
                         title="Start a draft from this opportunity's application. For Granted only.">Draft this</a>
                      <SaveStar m={m} />
                    </td>
                  )}
                  {!isAdmin && (
                    <td className="fm-decide">
                      <ClientVerdict kind="grant" targetId={m.grant_id} view={viewOf("grant", m.grant_id)} mode={viewingAsClient ? "admin" : "client"} />
                      <SaveStar m={m} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      ))}

      {/* The Watchlist (patch 26): closed calls that screened as a real fit.
          Most recently closed first; the most recent close is the one most
          likely to reopen soonest. */}
      {mode === "grants" && watchMatches.length > 0 && (
        <section id="fm-watch" className="fm-sec" aria-labelledby="fm-watch-h">
          <div className="fm-sec-head">
            <h3 id="fm-watch-h">Not open now, worth watching</h3>
            <span className="fm-count">{watchMatches.length}</span>
            <InfoTip label="What this list is">
              These calls fit {orgName}, but their last cycle has closed. Funders often run the
              same programme on a similar calendar each year, so the most recently closed sit first.
              Save the ones you want to be ready for, and confirm dates on the funder&rsquo;s own page
              as the season approaches.
            </InfoTip>
          </div>
          <p className="fm-sub">Closed calls that screened as a real fit for {orgName}. Save one to keep it past the next search.</p>
          <div className="fm-scroll">
          <table className="aq-table fm-table">
            <thead>
              <tr><th>Opportunity</th><th>Funder</th><th>Last deadline</th><th>Ceiling</th><th>Why this client</th><th>Save</th></tr>
            </thead>
            <tbody>
              {watchMatches.map(m => (
                <tr key={m.grant_id} data-gid={`g:${m.grant_id}`}>
                  <td className="fm-name">
                    {m.url
                      ? <a href={m.url} target="_blank" rel="noopener noreferrer">{m.title || m.grant_id}</a>
                      : (m.title || m.grant_id)}
                  </td>
                  <td className="fm-funder">{m.funder || <span className="ov-muted">Unknown</span>}</td>
                  <td className="fm-nowrap" title="When the last cycle closed. The next cycle's dates are the funder's to announce.">
                    {m.close_date ? new Date(m.close_date).toLocaleDateString() : "Not listed"}
                  </td>
                  <td className="fm-nowrap">{money(m.award_ceiling, m.currency)}</td>
                  <td className="fm-why">{m.rationale || <span className="ov-muted">{m.reason ?? "No explanation yet"}</span>}</td>
                  <td className="fm-decide"><SaveStar m={m} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}

      {/* Saved for later (patch 26): the client's own bucket. Not a snapshot;
          it survives every sweep, which is why a row can outlive its source. */}
      {mode === "grants" && savedGrants.length > 0 && (
        <section id="fm-saved" className="fm-sec" aria-labelledby="fm-saved-h">
          <div className="fm-sec-head">
            <h3 id="fm-saved-h">Saved for later</h3>
            <span className="fm-count">{savedGrants.length}</span>
            <InfoTip label="What this list is">
              Grants somebody starred. They stay here through every new search, so when a call
              reopens you already know you were interested. Press the star again to remove one.
            </InfoTip>
          </div>
          <div className="fm-scroll">
          <table className="aq-table fm-table">
            <thead>
              <tr><th>Opportunity</th><th>Funder</th><th>Last known deadline</th><th>Ceiling</th><th>Saved</th><th></th></tr>
            </thead>
            <tbody>
              {savedGrants.map(s2 => (
                <tr key={s2.target_id} data-gid={`g:${s2.target_id}`}>
                  <td className="fm-name">
                    {s2.detail.url
                      ? <a href={s2.detail.url} target="_blank" rel="noopener noreferrer">{s2.title || s2.target_id}</a>
                      : (s2.title || s2.target_id)}
                    {s2.reopened_at && (
                      <> <span className="fm-new" title={`A search on ${new Date(s2.reopened_at).toLocaleDateString()} found this call open again${s2.reopened_detail?.close_date ? `; it closes ${new Date(s2.reopened_detail.close_date).toLocaleDateString()}` : ""}.`}>Open again</span></>
                    )}
                  </td>
                  <td className="fm-funder">{s2.detail.funder || <span className="ov-muted">Unknown</span>}</td>
                  <td className="fm-nowrap">{s2.detail.close_date ? new Date(s2.detail.close_date).toLocaleDateString() : "Not listed"}</td>
                  <td className="fm-nowrap">{money(s2.detail.award_ceiling ?? null)}</td>
                  <td className="fm-nowrap">{new Date(s2.saved_at).toLocaleDateString()}</td>
                  <td className="fm-decide">
                    <SaveStar m={{ grant_id: s2.target_id, title: s2.title, funder: s2.detail.funder ?? null, url: s2.detail.url ?? null, close_date: s2.detail.close_date ?? null, award_ceiling: s2.detail.award_ceiling ?? null }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}

      {/* Gated on hidden too. Otherwise a run where every funder is screened
          out hides the toggle inside the block the toggle would have to open,
          and the rows become unreachable rather than one click away. */}
      {mode === "funders" && !hasResults && (
        <div className="empty">
          No matches yet.{canRun && configured ? ` Press ${isAdmin ? "Run matching" : "Search for funding"} to build the list, and check Sources to see where it will look.` : " Your For Granted team will run the first search."}
        </div>
      )}
      {mode === "funders" && hasResults && visibleFunders.length === 0 && !screened.hidden.length && (
        <div className="empty">
          No funders to show from this search. The open calls under the Grants switch may still be worth a look.
        </div>
      )}
      {mode === "funders" && (visibleFunders.length > 0 || screened.hidden.length > 0) && (
        <section id="fm-funders" className="fm-sec" aria-labelledby="fm-funders-h">
          <div className="fm-sec-head">
            <h3 id="fm-funders-h">Funders worth approaching</h3>
            <span className="fm-count">{visibleFunders.length}</span>
            <InfoTip label="How to read the funders">
              These are not open calls. They are organizations whose giving lines up with {orgName}&apos;s work.
              The ones marked <strong>Already funds peers</strong> have a record of granting to organizations like
              this one, the strongest reason on this page to spend an afternoon on an approach. Records read a
              June 2026 snapshot, and a funder&apos;s priorities and staff both move. Read the <strong>Access</strong>{" "}
              column first: an invitation-only funder will not read a cold proposal however well it fits, and
              &ldquo;Likely&rdquo; there means we inferred it rather than checked.
            </InfoTip>
          </div>
          <p className="fm-sub">Funders to research and approach, usually with a letter of inquiry. Read the Access column first.</p>
          {visibleFunders.length > 0 && (
          <div className="fm-scroll">
          <table className="aq-table fm-table">
            <thead>
              <tr>
                <th>Funder</th><th>Access</th><th>Signal</th><th>Typical grant</th>
                <th>Evidence</th>{isAdmin && <th>Who reads it</th>}
                <th>Seen and checked</th><th>Why this client</th>
                {isAdmin ? <th>Decision</th> : <th>Your view</th>}
              </tr>
            </thead>
            <tbody>
              {visibleFunders.map(f => (
                <tr key={f.funder_id} data-gid={`f:${f.funder_id}`}>
                  <td className="fm-name">
                    {f.website
                      ? <a href={f.website} target="_blank" rel="noopener noreferrer">{f.name}</a>
                      : f.name}
                    {f.location && <div className="fm-listed">{f.location}</div>}
                    {(() => { const k = knownFunderMatch(f.name, knownFunders); return k && <div className="fm-known" title="From the funders listed in company setup">Already known to you: {RELATIONSHIP_LABEL[k.relationship].toLowerCase()}</div>; })()}
                    {originLine(f.source) && <div className="fm-listed">{originLine(f.source)}</div>}
                    {hiddenByScreen(f) && (
                      <div className="fm-nohistory"
                           title="No outgoing grants on file for this organization. Often an operating charity that delivers services itself rather than funding others, which semantic search cannot tell apart from a funder. Worth a look only if you have another reason.">
                        No grants on record
                      </div>
                    )}
                    {/* Relayed verbatim. A donor-advised fund is not an approachable
                        foundation, and softening that wastes a client's time. */}
                    {f.caveat && <div className="fm-caveat">{f.caveat}</div>}
                  </td>
                  <td className="fm-access">
                    {/* The distinction between checked and guessed is the whole
                        point of Ground Truth, so it is visible, not buried in a
                        tooltip: an inferred answer is styled differently and
                        says "likely". */}
                    <span className={`ov-tag fm-acc-${f.access_mode}${f.access_verified ? "" : " fm-acc-guess"}`}
                          title={`${ACCESS_HELP[f.access_mode]}${f.access_note ? `\n\n${f.access_note}` : ""}${
                            f.access_verified
                              ? "\n\nFor Granted confirmed this at the funder's own materials."
                              : f.access_mode === "unknown"
                                ? ""
                                : "\n\nInferred from the record, not confirmed by anyone. Check before acting on it."}`}>
                      {f.access_verified || f.access_mode === "unknown"
                        ? ACCESS_LABEL[f.access_mode]
                        : `Likely ${ACCESS_LABEL[f.access_mode].toLowerCase()}`}
                    </span>
                  </td>
                  <td className="fm-nowrap">
                    <span className={`ov-tag ${signal(f).cls} fm-verdict`} title={signal(f).help}>
                      {signal(f).label}
                    </span>
                  </td>
                  <td className="fm-nowrap">
                    {f.typical_grant_range || <span className="ov-muted">Not stated</span>}
                  </td>
                  <td className="fm-why">
                    {f.evidence.length
                      ? <span title="Organizations this funder has actually granted to, from the giving history on record.">{evidenceText(f)}</span>
                      : <span className="ov-muted">No giving history on record</span>}
                  </td>
                  {isAdmin && (
                    <td className="fc-cell">
                      {(() => {
                        const c = primaryContact(contacts[f.ein ?? ""] ?? []);
                        if (!c) return <span className="ov-muted">No contact yet</span>;
                        const fr = freshness(c.last_verified_at);
                        return (
                          <>
                            <div>{c.name}</div>
                            <div className="ov-muted">
                              {c.title || ROLE_LABEL[c.role]}
                              {c.portfolio ? ` · ${c.portfolio}` : ""}
                            </div>
                            <div className={fr.stale ? "fc-stale" : "ov-muted"}
                                 title={fr.stale
                                   ? "Nobody has confirmed this in over a year. People move; check before writing."
                                   : "Recently confirmed."}>
                              {fr.label}
                            </div>
                          </>
                        );
                      })()}
                    </td>
                  )}
                  <td className="fm-seen">
                    {/* Patch 12: first seen and verified share a column, so the reason fits beside them. */}
                    <span className={rowIsNew(f) ? "fm-new" : "ov-muted"}
                          title={rowIsNew(f) ? newHelp : firstSeen(f).help}>{rowIsNew(f) ? "New" : firstSeen(f).label === "Earlier" ? "Earlier" : `Since ${firstSeen(f).label === "New" ? new Date(f.first_matched_at!).toLocaleDateString() : firstSeen(f).label}`}</span>
                    <div className={f.verified_at ? "fm-verified" : "ov-muted"} title={verified(f).help}>
                      {verified(f).label}
                    </div>
                  </td>
                  <td className="fm-why">
                    {f.match_reason
                      ? f.match_reason
                      : f.from_overlay
                        // Not a reason. This funder was never assessed against
                        // this client, and the column header promises that it
                        // was, so say the true thing instead.
                        ? <span className="ov-muted">Not assessed against {orgName}</span>
                        : f.focus
                          ? <span className="ov-muted" title="The funder's own stated focus, not a match explanation.">{f.focus}</span>
                          : <span className="ov-muted">No reason given</span>}
                  </td>
                  {isAdmin && (
                    <td className="fm-decide">
                      <Triage kind="funder" id={f.funder_id} label={f.name} />
                      <ClientVerdict kind="funder" targetId={f.funder_id} view={viewOf("funder", f.funder_id)} mode="admin" />
                      <a className="sb-btn sb-secondary sb-sm fm-draft" href={`/draft/new?funder=${encodeURIComponent(f.funder_id)}`}
                         title="Start a draft from this funder's application or guidelines. For Granted only.">Draft this</a>
                    </td>
                  )}
                  {!isAdmin && (
                    <td className="fm-decide">
                      <ClientVerdict kind="funder" targetId={f.funder_id} view={viewOf("funder", f.funder_id)} mode={viewingAsClient ? "admin" : "client"} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          )}

          {visibleFunders.length === 0 && (
            <div className="empty">
              Every funder this run returned was set aside: {hiddenReasons.join("; ")}.
              They are below if you want to look.
            </div>
          )}

          {screened.hidden.length > 0 && (
            <button type="button" className="sb-btn sb-quiet sb-sm fm-toggle"
                    onClick={() => setShowNoHistory(v => !v)}>
              {showNoHistory
                ? `Hide the ${screened.hidden.length} set aside`
                : `Show ${screened.hidden.length} set aside (${hiddenReasons.join("; ")})`}
            </button>
          )}
        </section>
      )}

      {!isAdmin && modeSetAside > 0 && (
        <button type="button" className="sb-btn sb-quiet sb-sm fm-toggle" onClick={() => setShowSetAside(v => !v)}>
          {showSetAside ? "Hide the ones you marked Not for us" : `Show ${modeSetAside} you marked Not for us`}
        </button>
      )}

      {mode === "grants" && webSection}

      {isAdmin && modeRuledOut > 0 && (
        <div className="ov-note tri-hidden">
          {/* Set aside, never silently. A shortlist that quietly drops rows is
              impossible to audit, and a wrong judgment would be invisible. */}
          {mode === "grants"
            ? `${ruledOutGrants.length} opportunit${ruledOutGrants.length === 1 ? "y" : "ies"}`
            : `${ruledOutFunders.length} funder${ruledOutFunders.length === 1 ? "" : "s"}`}
          {" "}ruled out by For Granted and hidden from this table.
          {" "}
          <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setShowRuledOut(v => !v)}>
            {showRuledOut ? "Hide them again" : "Show them"}
          </button>
        </div>
      )}

        </div>
      </div>

    </div>
  );
}
