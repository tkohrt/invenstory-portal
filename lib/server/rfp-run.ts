import "server-only";
// One RFP Engine run for one client (patch 58, 17 Nov 2026). The runMatch
// analog: candidate pull (SQL, no model), the rules (lib/rfp-rubric.ts), fit
// for the survivors that need it (capped, and reused when a notice has not
// changed), then the results cache and the run record. A run is a snapshot:
// earlier results this run did not find are swept, unless a person triaged them.
import { db } from "./db";
import { judgeFit } from "./rfp-fit";
import { withAiUsage } from "./ai-usage";
import { generationConfigured } from "./llm";
import { rfpEngineOn, getGovReadiness } from "./gov-readiness";
import { cleanRfpProfile, profileProblem, type RfpProfile } from "@/lib/rfp-profile";
import {
  screenRfp, verdict, BUCKET_OF, LIFT, RUBRIC_VERSION,
  type Action, type Bucket, type Fit, type RfpNoticeInput, type Tier,
} from "@/lib/rfp-rubric";

/** Most notices pulled per run. The rules see all of them. */
export const MAX_CANDIDATES = 80;
/** Most model fit calls per run: the editorial cap (a screen, not a librarian). */
export const MAX_FIT_CALLS = 15;

interface Candidate {
  id: string; source_kind: string; title: string; agency: string | null;
  notice_type: string; notice_type_raw: string | null; naics: string[]; set_aside: string | null;
  due_at: string | null; description: string | null; evidence_tier: Tier; content_hash: string; naics_match: boolean;
}
interface Prior {
  notice_id: string; first_seen_at: string; notice_hash: string | null; rubric_version: string;
  fit: Fit | null; rationale: string | null; evidence: unknown; deal_breaker: string | null; strategic_note: string | null;
  shapeable: boolean; client_triage: string | null; admin_triage: string | null;
}

export interface RfpRunResult {
  ok: boolean; error?: string; runId?: string;
  candidates: number; screenedOut: number; scored: number; reused: number; deferred: number;
  counts: Partial<Record<Bucket, number>>; newCount: number; swept: number;
}

export async function getRfpProfile(tenantId: string): Promise<{ available: boolean; profile: RfpProfile; updatedAt: string | null }> {
  const { data, error } = await db.from("rfp_profile").select("capabilities, naics, keywords, updated_at").eq("tenant_id", tenantId).maybeSingle();
  if (error) return { available: false, profile: cleanRfpProfile({}), updatedAt: null };
  const r = data as { capabilities: string; naics: string[]; keywords: string[]; updated_at: string } | null;
  return { available: true, profile: cleanRfpProfile(r ?? {}), updatedAt: r?.updated_at ?? null };
}

function toInput(c: Candidate): RfpNoticeInput {
  return {
    title: c.title, agency: c.agency, notice_type: c.notice_type, notice_type_raw: c.notice_type_raw,
    set_aside: c.set_aside, description: c.description, due_at: c.due_at, evidence_tier: c.evidence_tier,
    jurisdiction: c.source_kind === "federal_extract" || c.source_kind === "grants_gov" ? "federal" : "state_local",
  };
}

export async function runRfp(tenantId: string, trigger: "cron" | "admin", userId: string | null): Promise<RfpRunResult> {
  const empty = { candidates: 0, screenedOut: 0, scored: 0, reused: 0, deferred: 0, counts: {}, newCount: 0, swept: 0 };
  if (!(await rfpEngineOn(tenantId))) return { ok: false, error: "The RFP Engine is off for this client.", ...empty };
  const prof = await getRfpProfile(tenantId);
  if (!prof.available) return { ok: false, error: "The RFP profile table is missing. Has migration 0096 been applied?", ...empty };
  const problem = profileProblem(prof.profile);
  if (problem) return { ok: false, error: problem, ...empty };
  const gov = await getGovReadiness(tenantId);

  const { data: run, error: runErr } = await db.from("rfp_run").insert({ tenant_id: tenantId, trigger, rubric_version: RUBRIC_VERSION, status: "running" }).select("id").single();
  if (runErr || !run) return { ok: false, error: "Could not start the run record.", ...empty };
  const runId = (run as { id: string }).id;
  const errors: string[] = [];
  const finish = async (status: "ok" | "partial" | "failed", r: Omit<RfpRunResult, "ok" | "runId">, extra: Record<string, unknown> = {}) => {
    await db.from("rfp_run").update({
      finished_at: new Date().toISOString(), status, candidates: r.candidates, screened_out: r.screenedOut, scored: r.scored,
      counts: r.counts, swept: r.swept, errors: errors.slice(0, 30), ...extra,
    }).eq("tenant_id", tenantId).eq("id", runId);
  };

  // 1. Candidate pull: SQL only.
  // tenant-safe: rfp_candidates reads the shared index; nothing tenant-specific in it.
  const { data: cand, error: candErr } = await db.rpc("rfp_candidates", { p_naics: prof.profile.naics, p_keywords: prof.profile.keywords, p_limit: MAX_CANDIDATES });
  if (candErr) {
    errors.push(`Candidate pull failed: ${candErr.message}`);
    await finish("failed", { ...empty });
    return { ok: false, error: "The candidate pull failed. Has migration 0096 been applied?", runId, ...empty };
  }
  const candidates = (cand ?? []) as Candidate[];

  const { data: priorRows } = await db.from("rfp_eligible")
    .select("notice_id, first_seen_at, notice_hash, rubric_version, fit, rationale, evidence, deal_breaker, strategic_note, shapeable, client_triage, admin_triage")
    .eq("tenant_id", tenantId);
  const prior = new Map(((priorRows ?? []) as Prior[]).map(p => [p.notice_id, p]));

  // 2. The rules, for every candidate.
  const now = new Date();
  const screened = candidates.map(c => ({ c, input: toInput(c), s: screenRfp(toInput(c), gov.answers, now) }));
  const needFit = screened.filter(x => x.s.action === null);
  const screenedOut = screened.filter(x => x.s.action === "skip_team" || x.s.action === "cannot_score").length;

  // 3. Fit: reuse an unchanged notice's earlier fit; otherwise call the model,
  // up to the cap. NAICS matches first, then soonest due (the pull's order).
  const reuse = (x: (typeof needFit)[number]) => {
    const p = prior.get(x.c.id);
    return p && p.fit && p.notice_hash === x.c.content_hash && p.rubric_version === RUBRIC_VERSION ? p : null;
  };
  const toCall = needFit.filter(x => !reuse(x));
  const calling = generationConfigured() ? toCall.slice(0, MAX_FIT_CALLS) : [];
  const deferredIds = new Set(toCall.slice(calling.length).map(x => x.c.id));
  if (!generationConfigured() && toCall.length) errors.push("The AI provider is not configured; notices that need a fit judgment were left for the next run.");

  const fits = new Map<string, Awaited<ReturnType<typeof judgeFit>>>();
  await withAiUsage({ tenantId, userId, actor: "system", feature: "rfp_scan" }, async () => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(5, calling.length) }, async () => {
      for (let i = next++; i < calling.length; i = next++) {
        const x = calling[i]!;
        try { fits.set(x.c.id, await judgeFit(prof.profile.capabilities, x.input, x.s.stage)); }
        catch (e) { errors.push(`Fit failed for ${x.c.id}: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }));
  });

  // 4. Verdicts and the rows to write.
  const counts: Partial<Record<Bucket, number>> = {};
  const rows: Record<string, unknown>[] = [];
  const newIds: string[] = [], newTitles: string[] = [];
  let scored = 0, reused = 0;
  for (const x of screened) {
    if (deferredIds.has(x.c.id)) continue;
    let action: Action | null = x.s.action;
    let fitRow: { fit: Fit | null; rationale: string | null; evidence: unknown; deal_breaker: string | null; strategic_note: string | null; shapeable: boolean } =
      { fit: null, rationale: null, evidence: [], deal_breaker: null, strategic_note: null, shapeable: false };
    const notes = [...x.s.notes];
    if (action === null) {
      const r = reuse(x);
      if (r) {
        reused++;
        fitRow = { fit: r.fit, rationale: r.rationale, evidence: r.evidence, deal_breaker: r.deal_breaker, strategic_note: r.strategic_note, shapeable: r.shapeable };
        const v = verdict(x.s, { fit: r.fit!, shapeable: r.shapeable, dealBreaker: r.deal_breaker, strategic: r.strategic_note });
        action = v.action;
      } else {
        const j = fits.get(x.c.id);
        if (!j) { errors.push(`No usable fit for notice ${x.c.id}; left for the next run.`); continue; }
        scored++;
        const v = verdict(x.s, j);
        action = v.action; notes.push(...v.notes.slice(x.s.notes.length));
        fitRow = { fit: j.fit, rationale: j.rationale + (j.quotesVerified ? "" : " (quotes not found word for word)"), evidence: j.evidence, deal_breaker: j.dealBreaker, strategic_note: j.strategic, shapeable: j.shapeable };
      }
    }
    const bucket = BUCKET_OF[action];
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    const p = prior.get(x.c.id);
    if (!p) { newIds.push(x.c.id); if (newTitles.length < 20) newTitles.push(x.c.title.slice(0, 200)); }
    const lift = x.s.liftClass;
    rows.push({
      tenant_id: tenantId, notice_id: x.c.id, run_id: runId, rubric_version: RUBRIC_VERSION,
      action, bucket, ...fitRow,
      rationale: fitRow.rationale ?? notes[0] ?? null,
      fit_provisional: false,
      gate_result: x.s.gateResult,
      gate_blockers: x.s.findings.filter(f => f.standing === "blocked").map(f => ({ gate: f.gate, reason: f.reason })),
      gate_checks: [
        ...x.s.findings.filter(f => f.standing === "check").map(f => ({ gate: f.gate, reason: f.reason })),
        ...notes.filter(n => n !== fitRow.rationale).map(n => ({ gate: "note", reason: n })),
      ],
      lift_class: lift, lift_hours: lift ? LIFT[lift].hours : null,
      notice_hash: x.c.content_hash,
      client_triage: p?.client_triage ?? null, admin_triage: p?.admin_triage ?? null,
      first_seen_at: p?.first_seen_at ?? now.toISOString(),
      verified_at: now.toISOString(),
    });
  }

  if (rows.length) {
    const { error } = await db.from("rfp_eligible").upsert(rows, { onConflict: "tenant_id,notice_id" });  // tenant-safe: every row carries this tenant_id
    if (error) {
      errors.push(`Results not saved: ${error.message}`);
      await finish("failed", { ...empty, candidates: candidates.length, screenedOut, scored });
      return { ok: false, error: "The results could not be saved.", runId, ...empty };
    }
  }

  // 5. Sweep: a run is a snapshot. Keep anything a person triaged, and
  // anything only deferred this time.
  const keep = new Set([...rows.map(r => r.notice_id as string), ...deferredIds]);
  const stale = [...prior.values()].filter(p => !keep.has(p.notice_id) && !p.client_triage && !p.admin_triage).map(p => p.notice_id);
  let swept = 0;
  for (let i = 0; i < stale.length; i += 100) {
    const chunk = stale.slice(i, i + 100);
    const { error } = await db.from("rfp_eligible").delete().eq("tenant_id", tenantId).in("notice_id", chunk);
    if (error) errors.push(`Sweep failed: ${error.message}`); else swept += chunk.length;
  }

  const result = { candidates: candidates.length, screenedOut, scored, reused, deferred: deferredIds.size, counts, newCount: newIds.length, swept };
  await finish(errors.length ? "partial" : "ok", result, {
    new_ids: newIds, new_titles: newTitles,
    query_log: { naics: prof.profile.naics, keywords: prof.profile.keywords, fit_calls: calling.length, reused, deferred: deferredIds.size },
  });
  return { ok: true, runId, ...result };
}
