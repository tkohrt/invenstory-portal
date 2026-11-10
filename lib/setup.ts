// Company setup on first sign-in (patch 14 of the onboarding build, 3 November
// 2026; mockup "Portal Setup and Tours Mockup", agreed by Shane).
//
// One guided setup per client organization, done by the FIRST client user to
// sign in after the account is made. Eight steps; each is completed or
// explicitly skipped ("Complete later" / "Skip for now"), except Layer III,
// whose explanation must be read (the recording itself may be skipped).
// Teammates never see the setup: they see a note that it is under way.
// Clients that existed before this build were marked complete by 0077, so no
// current client is sent into setup.
//
// Pure and free of `server-only`, tested in tests/portal/setup.test.ts.

export const SETUP_STEPS = [
  { key: "you", label: "You" },
  { key: "eligibility", label: "Funding Eligibility" },
  { key: "layer1", label: "Layer I" },
  { key: "layer2", label: "Layer II" },
  { key: "layer3", label: "Layer III" },
  { key: "funding", label: "Funding so far" },
  { key: "team", label: "Team" },
  { key: "next", label: "What's next" },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];
export type StepState = "done" | "skipped";

export function isStepKey(v: unknown): v is SetupStepKey {
  return typeof v === "string" && SETUP_STEPS.some(s => s.key === v);
}

export const ROLES = [
  { v: "founder", l: "Executive director or founder" },
  { v: "development", l: "Development or grants lead" },
  { v: "program", l: "Program staff" },
  { v: "board", l: "Board member" },
  { v: "consultant", l: "Consultant or grant writer" },
  { v: "other", l: "Other" },
] as const;

export const RELATIONSHIPS = [
  { v: "funded", l: "Funded us" },
  { v: "applied", l: "Applied, waiting" },
  { v: "declined", l: "Declined us" },
  { v: "known", l: "We know them" },
] as const;

export const GOALS = [
  { v: "funders", title: "Find funders", desc: "See who could fund you, and why.", where: "We will open Funder Matches first.", path: "/funder-matches" },
  { v: "draft", title: "Work on an application", desc: "See the applications your For Granted team is preparing with you.", where: "We will open your applications first.", path: "/drafts" },
  { v: "organize", title: "Get organized", desc: "See what your Inven(s)tory knows and what is missing.", where: "We will open your Inven(s)tory first.", path: "/invenstory" },
] as const;
export type Goal = (typeof GOALS)[number]["v"];

export interface KnownFunder { name: string; relationship: (typeof RELATIONSHIPS)[number]["v"] }
export interface Deadline { what: string; date: string | null }
export interface Invite { email: string; access: "edit" | "view"; requested_at: string; created?: boolean }

export interface SetupAnswers {
  role?: string | null;
  known_funders?: KnownFunder[];
  deadlines?: Deadline[];
  invites?: Invite[];
  goal?: Goal | null;
  interview_requested_at?: string | null;
  /** The website address last read on step 1, so a failed read is not retried on every Continue. */
  website_tried?: string | null;
}

export interface SetupState {
  tenantId: string;
  ownerUserId: string | null;
  status: "in_progress" | "complete";
  steps: Partial<Record<SetupStepKey, StepState>>;
  answers: SetupAnswers;
  layer3ReadAt: string | null;
  /** Marked complete by the 0077 backfill: a client from before this build. */
  legacy: boolean;
  completedAt: string | null;
}

/** What the portal does with this person: send them to setup, tell them it is under way, or nothing. */
export type SetupGate = { kind: "run" } | { kind: "wait"; done: number; total: number } | { kind: "none" };

export function setupGate(state: SetupState | null, user: { id: string; role: "admin" | "client" }, isBrain = false): SetupGate {
  if (user.role === "admin" || isBrain || !state) return { kind: "none" };
  if (state.status === "complete") return { kind: "none" };
  if (!state.ownerUserId || state.ownerUserId === user.id) return { kind: "run" };
  return { kind: "wait", done: stepsSettled(state), total: SETUP_STEPS.length };
}

/** Steps completed or skipped. */
export function stepsSettled(state: Pick<SetupState, "steps">): number {
  return SETUP_STEPS.filter(s => state.steps[s.key]).length;
}

/** Where to pick up: the first step neither completed nor skipped. */
export function resumeAt(state: Pick<SetupState, "steps">): SetupStepKey {
  return (SETUP_STEPS.find(s => !state.steps[s.key])?.key) ?? "next";
}

/** Skipped steps, for "Still to do" and Getting started. */
export function stillToDo(state: Pick<SetupState, "steps">): SetupStepKey[] {
  return SETUP_STEPS.filter(s => state.steps[s.key] === "skipped").map(s => s.key);
}

/** Layer III can be skipped only after its explanation has been read. */
export function canSettle(step: SetupStepKey, how: StepState, state: Pick<SetupState, "layer3ReadAt">): boolean {
  if (step === "layer3") return !!state.layer3ReadAt;
  if (step === "next") return how === "done";
  return true;
}

/** The workspace feature each goal opens (lib/workspace.ts keys); the Inven(s)tory is always on. */
export const GOAL_FEATURE: Record<Goal, string | null> = { funders: "funder_matches", draft: "drafts", organize: null };

/** Goals whose tool is switched on for this client. */
export function goalsOn(vis: Record<string, boolean>): Goal[] {
  return GOALS.filter(g => { const f = GOAL_FEATURE[g.v]; return !f || vis[f] !== false; }).map(g => g.v);
}

export function goalPath(goal: unknown, vis: Record<string, boolean> = {}): string {
  const g = GOALS.find(x => x.v === goal);
  if (!g) return "/invenstory";
  const f = GOAL_FEATURE[g.v];
  return f && vis[f] === false ? "/invenstory" : g.path;
}

// ---- Cleaning what a client sends ----

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

export function cleanRole(v: unknown): string | null {
  return ROLES.some(r => r.v === v) ? (v as string) : null;
}

export function cleanKnownFunders(v: unknown): KnownFunder[] {
  if (!Array.isArray(v)) return [];
  const out: KnownFunder[] = [];
  for (const x of v.slice(0, 50)) {
    const name = clip((x as { name?: unknown })?.name, 200);
    const rel = (x as { relationship?: unknown })?.relationship;
    if (!name) continue;
    if (out.some(o => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, relationship: RELATIONSHIPS.some(r => r.v === rel) ? rel as KnownFunder["relationship"] : "known" });
  }
  return out;
}

export function cleanDeadlines(v: unknown): Deadline[] {
  if (!Array.isArray(v)) return [];
  const out: Deadline[] = [];
  for (const x of v.slice(0, 30)) {
    const what = clip((x as { what?: unknown })?.what, 200);
    const raw = clip((x as { date?: unknown })?.date, 10);
    if (!what) continue;
    out.push({ what, date: /^\d{4}-\d{2}-\d{2}$/.test(raw) && !isNaN(Date.parse(raw)) ? raw : null });
  }
  return out;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function cleanInvites(v: unknown, now = new Date().toISOString()): Invite[] {
  if (!Array.isArray(v)) return [];
  const out: Invite[] = [];
  for (const x of v.slice(0, 10)) {
    const email = clip((x as { email?: unknown })?.email, 254).toLowerCase();
    if (!EMAIL.test(email) || out.some(o => o.email === email)) continue;
    const access = (x as { access?: unknown })?.access === "view" ? "view" : "edit";
    out.push({ email, access, requested_at: now });
  }
  return out;
}

/** A website address worth reading, or null. Adds https:// when it is missing. */
export function cleanWebsite(v: unknown): string | null {
  const t = clip(v, 500);
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!/\./.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

/** For Funder Matches: is this funder one the client said they already know? */
export function knownFunderMatch(name: string, known: KnownFunder[]): KnownFunder | null {
  const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/\b(the|inc|llc|foundation|fund|trust)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const n = norm(name);
  if (!n) return null;
  return known.find(k => { const m = norm(k.name); return !!m && (m === n || (m.length > 5 && (n.includes(m) || m.includes(n)))); }) ?? null;
}

export const RELATIONSHIP_LABEL: Record<KnownFunder["relationship"], string> = Object.fromEntries(RELATIONSHIPS.map(r => [r.v, r.l])) as Record<KnownFunder["relationship"], string>;
