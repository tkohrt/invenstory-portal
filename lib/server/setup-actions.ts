"use server";
// Company setup, the writes (patch 14, onboarding build, 3 November 2026).
//
// Only the person who claimed the setup may move it on. Everything a client
// sends is cleaned by the pure rules in lib/setup.ts before it is stored.
// For Granted can see, finish, or reset a client's setup, and turns a
// teammate request into a login (clients cannot make logins themselves).
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { getSession, type PortalSession } from "./session";
import { db } from "./db";
import { getSetupState, addWebDocument, hasWebsiteDoc } from "./setup";
import { getEligibilityProfile } from "./eligibility";
import { saveEligibilityProfileAction } from "./eligibility-actions";
import {
  canSettle, cleanRole, cleanKnownFunders, cleanDeadlines, cleanInvites, cleanWebsite, goalPath, GOALS, isStepKey,
  type SetupAnswers, type SetupState, type SetupStepKey, type StepState, type Goal,
} from "@/lib/setup";
import type { EligibilityProfile } from "@/lib/eligibility-fields";

type Result = { ok: true; message?: string; next?: string } | { ok: false; error: string };

async function owner(): Promise<{ s: PortalSession; state: SetupState } | { error: string }> {
  const s = await getSession();
  if (!s) return { error: "Please sign in again." };
  if (s.role !== "client") return { error: "Setup is done by the client." };
  const state = await getSetupState(s.tenantId);
  if (!state) return { error: "Setup is not available right now. Please try again shortly." };
  if (state.ownerUserId !== s.user.id) return { error: "Another person on your team is doing the setup." };
  return { s, state };
}

async function write(tenantId: string, patch: Record<string, unknown>) {
  const { error } = await db.from("tenant_setup").update({ ...patch, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId);
  return error;
}

function withStep(state: SetupState, step: SetupStepKey, how: StepState) {
  return { ...state.steps, [step]: how };
}

/** Step 1: the organization's website, the person's name and role. */
export async function saveYouAction(input: { website?: string; fullName?: string; role?: string }): Promise<Result> {
  const o = await owner(); if ("error" in o) return { ok: false, error: o.error };
  const { s, state } = o;
  const name = typeof input.fullName === "string" ? input.fullName.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  if (name) await db.from("app_user").update({ full_name: name }).eq("id", s.user.id);  // tenant-safe: the signed-in person's own row, by id from the session
  const site = cleanWebsite(input.website);
  if (input.website && !site) return { ok: false, error: "That website address does not look right. Check it, or leave it empty." };
  let message: string | undefined;
  if (site) {
    const { data: t } = await db.from("tenant").select("website").eq("id", s.tenantId).maybeSingle();  // tenant-safe: the session's own tenant row, by id
    const changed = (t as { website?: string | null } | null)?.website !== site;
    if (changed) await db.from("tenant").update({ website: site }).eq("id", s.tenantId);  // tenant-safe: the session's own tenant row, by id
    if (changed || !(await hasWebsiteDoc(s.tenantId))) {
      const r = await addWebDocument({ tenantId: s.tenantId, userId: s.user.id, role: "client", url: site, layer: "I", tag: "website" });
      message = r.ok ? "We read your website and added it to Layer I." : `Your website could not be read: ${r.error}`;
    }
  }
  const answers: SetupAnswers = { ...state.answers, role: cleanRole(input.role) };
  const err = await write(s.tenantId, { answers, steps: withStep(state, "you", "done") });
  if (err) return { ok: false, error: "That did not save. Please try again." };
  revalidatePath("/setup");
  return { ok: true, message };
}

/**
 * Step 2: Funding Eligibility. Merged with what is already saved, because the
 * eligibility save cleans a whole profile from what it is given.
 */
export async function saveSetupEligibilityAction(input: Partial<EligibilityProfile>, how: StepState): Promise<Result> {
  const o = await owner(); if ("error" in o) return { ok: false, error: o.error };
  const { s, state } = o;
  const current = await getEligibilityProfile(s.tenantId);
  const r = await saveEligibilityProfileAction({ ...current, ...input });
  if (!r.ok) return { ok: false, error: r.error ?? "Your answers could not be saved." };
  const err = await write(s.tenantId, { steps: withStep(state, "eligibility", how) });
  if (err) return { ok: false, error: "That did not save. Please try again." };
  revalidatePath("/setup");
  return { ok: true };
}

/** A web link added on a Layer step. */
export async function addSetupLinkAction(url: string, layer: "I" | "II"): Promise<Result> {
  const o = await owner(); if ("error" in o) return { ok: false, error: o.error };
  const clean = cleanWebsite(url);
  if (!clean) return { ok: false, error: "That does not look like a web address." };
  const r = await addWebDocument({ tenantId: o.s.tenantId, userId: o.s.user.id, role: "client", url: clean, layer: layer === "II" ? "II" : "I" });
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/setup");
  return { ok: true, message: r.title };
}

/** Layer III: the explanation was read. Required before the step can be left. */
export async function markLayer3ReadAction(read: boolean): Promise<Result> {
  const o = await owner(); if ("error" in o) return { ok: false, error: o.error };
  const err = await write(o.s.tenantId, { layer3_read_at: read ? new Date().toISOString() : null });
  if (err) return { ok: false, error: "That did not save. Please try again." };
  return { ok: true };
}

/** Layer III: ask For Granted for a recorded interview. */
export async function requestInterviewAction(): Promise<Result> {
  const o = await owner(); if ("error" in o) return { ok: false, error: o.error };
  const { s, state } = o;
  const err = await write(s.tenantId, { answers: { ...state.answers, interview_requested_at: new Date().toISOString() } });
  if (err) return { ok: false, error: "That did not save. Please try again." };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "setup_interview_request", detail: "founder interview" });
  return { ok: true, message: "Asked. Your For Granted team will email you to find a time." };
}

/** Step 6: funders already known, deadlines already on the list. */
export async function saveFundingSoFarAction(input: { known_funders?: unknown; deadlines?: unknown }, how: StepState): Promise<Result> {
  const o = await owner(); if ("error" in o) return { ok: false, error: o.error };
  const { s, state } = o;
  const answers: SetupAnswers = how === "done"
    ? { ...state.answers, known_funders: cleanKnownFunders(input.known_funders), deadlines: cleanDeadlines(input.deadlines) }
    : state.answers;
  const err = await write(s.tenantId, { answers, steps: withStep(state, "funding", how) });
  if (err) return { ok: false, error: "That did not save. Please try again." };
  revalidatePath("/setup"); revalidatePath("/funder-matches");
  return { ok: true };
}

/**
 * Step 7: teammates. Stored as requests: For Granted makes each login (the
 * portal has no self-serve invite), so the wording never says an email went out.
 */
export async function saveTeamAction(input: { invites?: unknown }, how: StepState): Promise<Result> {
  const o = await owner(); if ("error" in o) return { ok: false, error: o.error };
  const { s, state } = o;
  let answers = state.answers;
  let message: string | undefined;
  if (how === "done") {
    const fresh = cleanInvites(input.invites).filter(i => i.email !== s.user.email.toLowerCase());
    const kept = (state.answers.invites ?? []).filter(i => i.created);
    const merged = [...kept, ...fresh.filter(f => !kept.some(k => k.email === f.email))];
    answers = { ...state.answers, invites: merged };
    if (fresh.length) {
      await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "setup_invite_request", detail: fresh.map(f => `${f.email} (${f.access})`).join(", ").slice(0, 900) });
      message = `Sent to your For Granted team, who will set up ${fresh.length === 1 ? "a login" : `${fresh.length} logins`} and email ${fresh.length === 1 ? "it" : "them"} out.`;
    }
  }
  const err = await write(s.tenantId, { answers, steps: withStep(state, "team", how) });
  if (err) return { ok: false, error: "That did not save. Please try again." };
  revalidatePath("/setup");
  return { ok: true, message };
}

/** Steps 3, 4 and 5: nothing to store but the choice (files are filed as they upload). */
export async function settleStepAction(step: string, how: StepState): Promise<Result> {
  const o = await owner(); if ("error" in o) return { ok: false, error: o.error };
  const { s, state } = o;
  if (!isStepKey(step) || !["layer1", "layer2", "layer3"].includes(step)) return { ok: false, error: "Unknown step." };
  if (how !== "done" && how !== "skipped") return { ok: false, error: "Unknown choice." };
  if (!canSettle(step, how, state)) return { ok: false, error: "Please read the explanation first. The recording itself can wait." };
  const err = await write(s.tenantId, { steps: withStep(state, step, how) });
  if (err) return { ok: false, error: "That did not save. Please try again." };
  revalidatePath("/setup");
  return { ok: true };
}

/** Step 8: where to start. Setup is complete. */
export async function finishSetupAction(goal: string): Promise<Result> {
  const o = await owner(); if ("error" in o) return { ok: false, error: o.error };
  const { s, state } = o;
  const g = GOALS.some(x => x.v === goal) ? goal as Goal : null;
  const now = new Date().toISOString();
  const err = await write(s.tenantId, {
    answers: { ...state.answers, goal: g }, steps: withStep(state, "next", "done"),
    status: "complete", completed_at: now,
  });
  if (err) return { ok: false, error: "That did not save. Please try again." };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "setup_complete", detail: g ?? "no goal" });
  revalidatePath("/", "layout");
  return { ok: true, next: goalPath(g) };
}

// ---- For Granted ----

async function admin(): Promise<PortalSession | null> {
  const s = await getSession();
  return s && s.role === "admin" ? s : null;
}

/** Finish a client's setup for them, or send it back to the start. */
export async function adminSetSetupAction(tenantId: string, to: "complete" | "reset"): Promise<Result> {
  const s = await admin(); if (!s) return { ok: false, error: "admin required" };
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return { ok: false, error: "Unknown client." };
  const now = new Date().toISOString();
  const row: Record<string, unknown> = to === "complete"
    ? { tenant_id: tenantId, status: "complete", completed_at: now, updated_at: now }
    : { tenant_id: tenantId, status: "in_progress", owner_user_id: null, steps: {}, layer3_read_at: null, completed_at: null, legacy: false, updated_at: now };
  // tenant-safe: admin-only; the row is keyed by the tenant id given
  const { error } = await db.from("tenant_setup").upsert(row, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: error.message };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: `setup_${to}`, detail: "by For Granted" });
  revalidatePath(`/admin/clients/${tenantId}`);
  return { ok: true };
}

function tempPassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

/** Turn a teammate request into a login. Returns the temporary password once. */
export async function createTeammateLoginAction(tenantId: string, email: string): Promise<{ ok: true; email: string; tempPassword: string } | { ok: false; error: string }> {
  const s = await admin(); if (!s) return { ok: false, error: "admin required" };
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return { ok: false, error: "Unknown client." };
  const state = await getSetupState(tenantId);
  if (!state) return { ok: false, error: "Setup could not be read." };
  const want = email.trim().toLowerCase();
  const invite = (state.answers.invites ?? []).find(i => i.email === want);
  if (!invite) return { ok: false, error: "That person is not on the client's list." };
  if (invite.created) return { ok: false, error: "A login was already made for that person." };
  const { data: dup } = await db.from("app_user").select("id").eq("email", want).maybeSingle();  // tenant-safe: admin-only action; global email-uniqueness check
  if (dup) return { ok: false, error: "A user with that email already exists." };
  const pw = tempPassword();
  const { data: au, error: e1 } = await db.auth.admin.createUser({ email: want, password: pw, email_confirm: true });
  if (e1 || !au?.user) return { ok: false, error: e1?.message ?? "Could not create the login." };
  const { error: e2 } = await db.from("app_user").insert({ tenant_id: tenantId, email: want, full_name: want, role: "client", auth_id: au.user.id });
  if (e2) { await db.auth.admin.deleteUser(au.user.id); return { ok: false, error: e2.message }; }
  const invites = (state.answers.invites ?? []).map(i => i.email === want ? { ...i, created: true } : i);
  await db.from("tenant_setup").update({ answers: { ...state.answers, invites }, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId);
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: "create_teammate", detail: `${want} (${invite.access})` });
  revalidatePath(`/admin/clients/${tenantId}`);
  return { ok: true, email: want, tempPassword: pw };
}
