import "server-only";
// Running the golden set against the live model (patch 54). The rules half is
// tested offline (tests/portal/rfp-golden.test.ts); this is the half that
// checks the model's fit judgments still land the settled verdicts.
import { db } from "./db";
import { judgeFit } from "./rfp-fit";
import { withAiUsage } from "./ai-usage";
import { CHAT_MODEL_ID } from "./bedrock";
import { generationConfigured } from "./llm";
import { GOLDEN_ROWS, GOLDEN_GATES, GOLDEN_AS_OF } from "@/lib/rfp-golden";
import { screenRfp, verdict, RUBRIC_VERSION, GOLDEN_BAR, type Action } from "@/lib/rfp-rubric";

export interface GoldenRowResult {
  id: string; label: string; expected: Action; accept: Action[]; got: Action | null;
  agreed: boolean; comparable: boolean; fit: string | null; frozenFit: string | null;
  rationale: string | null; quotesVerified: boolean | null; byRules: boolean;
  evidence: { from: "client" | "notice"; text: string }[];
}
export interface GoldenRunResult {
  ok: boolean; error?: string;
  agreement: number; agreed: number; total: number;
  comparableAgreement: number; comparableAgreed: number; comparable: number;
  passed: boolean; rows: GoldenRowResult[]; recorded: boolean;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  }));
  return out;
}

export async function runGolden(userId: string): Promise<GoldenRunResult> {
  const empty = { agreement: 0, agreed: 0, total: 0, comparableAgreement: 0, comparableAgreed: 0, comparable: 0, passed: false, rows: [], recorded: false };
  if (!generationConfigured()) return { ok: false, error: "The AI provider is not configured, so fit cannot be judged.", ...empty };
  // tenant-safe: rfp_golden_profile is For Granted's own single row, not tenant data.
  const { data: prof, error: profErr } = await db.from("rfp_golden_profile").select("profile").eq("id", "golden").maybeSingle();
  if (profErr) return { ok: false, error: "The golden profile table is missing. Has migration 0095 been applied?", ...empty };
  const profile = (prof as { profile: string } | null)?.profile?.trim();
  if (!profile) return { ok: false, error: "The golden set's client profile has not been loaded yet (rfp_golden_profile).", ...empty };

  const rows = await withAiUsage({ tenantId: null, userId, actor: "system", feature: "rfp_golden" }, () =>
    mapLimit(GOLDEN_ROWS, 5, async (r): Promise<GoldenRowResult> => {
      const accept = [r.expected, ...(r.accept ?? [])];
      const s = screenRfp(r.notice, GOLDEN_GATES, GOLDEN_AS_OF);
      const base = { id: r.id, label: r.label, expected: r.expected, accept, comparable: r.comparable, frozenFit: r.frozen?.fit ?? null };
      if (s.action) {
        return { ...base, got: s.action, agreed: accept.includes(s.action), fit: null, rationale: s.notes[0] ?? null, quotesVerified: null, byRules: true, evidence: [] };
      }
      const j = await judgeFit(profile, r.notice, s.stage);
      if (!j) return { ...base, got: null, agreed: false, fit: null, rationale: "No usable reply from the model.", quotesVerified: null, byRules: false, evidence: [] };
      const v = verdict(s, j);
      return { ...base, got: v.action, agreed: accept.includes(v.action), fit: j.fit, rationale: j.rationale, quotesVerified: j.quotesVerified, byRules: false, evidence: j.evidence };
    }));

  const agreed = rows.filter(r => r.agreed).length;
  const comp = rows.filter(r => r.comparable);
  const comparableAgreed = comp.filter(r => r.agreed).length;
  const agreement = agreed / rows.length;
  // Held to the bar on all 20 rows (stricter than the original 8-row metric,
  // which is reported alongside).
  const passed = agreement >= GOLDEN_BAR;
  // tenant-safe: rfp_golden_run is For Granted's regression record, not tenant data.
  const { error } = await db.from("rfp_golden_run").insert({
    run_by: userId, rubric_version: RUBRIC_VERSION, model: CHAT_MODEL_ID || "unknown",
    comparable: rows.length, agreed, agreement: Number(agreement.toFixed(4)), bar: GOLDEN_BAR, passed,
    rows: rows.map(r => ({ id: r.id, expected: r.expected, got: r.got, fit: r.fit, frozen_fit: r.frozenFit, agreed: r.agreed, by_rules: r.byRules, quotes_verified: r.quotesVerified, rationale: r.rationale, evidence: r.evidence })),
  });
  if (error) console.error("[rfp-golden] run not recorded", error.message);
  return {
    ok: true, agreement, agreed, total: rows.length,
    comparableAgreement: comp.length ? comparableAgreed / comp.length : 0, comparableAgreed, comparable: comp.length,
    passed, rows, recorded: !error,
  };
}

export interface RfpAdminStatus {
  available: boolean;
  sources: { key: string; name: string; enabled: boolean; lastRun: { started_at: string; status: string; seen: number; new_count: number; updated_count: number; closed_count: number; duration_ms: number | null } | null }[];
  openNotices: number | null;
  goldenRuns: { run_at: string; model: string; agreement: number; passed: boolean; agreed: number; comparable: number }[];
  goldenProfileLoaded: boolean;
}

export async function rfpAdminStatus(): Promise<RfpAdminStatus> {
  // tenant-safe: rfp_source, rfp_ingest_run, rfp_notice and rfp_golden_* are shared, not tenant data.
  const { data: src, error } = await db.from("rfp_source").select("id, key, name, enabled").order("key");
  if (error) return { available: false, sources: [], openNotices: null, goldenRuns: [], goldenProfileLoaded: false };
  const sources = await Promise.all(((src ?? []) as { id: string; key: string; name: string; enabled: boolean }[]).map(async s => {
    // tenant-safe: shared ingestion record.
    const { data } = await db.from("rfp_ingest_run").select("started_at, status, seen, new_count, updated_count, closed_count, duration_ms")
      .eq("source_id", s.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    return { key: s.key, name: s.name, enabled: s.enabled, lastRun: (data as RfpAdminStatus["sources"][number]["lastRun"]) ?? null };
  }));
  // tenant-safe: shared index.
  const { count } = await db.from("rfp_notice").select("id", { count: "exact", head: true }).eq("status", "active").gt("due_at", new Date().toISOString());
  // tenant-safe: shared regression record.
  const { data: runs } = await db.from("rfp_golden_run").select("run_at, model, agreement, passed, agreed, comparable").order("run_at", { ascending: false }).limit(10);
  // tenant-safe: For Granted's own single row.
  const { data: prof } = await db.from("rfp_golden_profile").select("id").eq("id", "golden").maybeSingle();
  return {
    available: true, sources, openNotices: count ?? null,
    goldenRuns: ((runs ?? []) as RfpAdminStatus["goldenRuns"]).map(r => ({ ...r, agreement: Number(r.agreement) })),
    goldenProfileLoaded: !!prof,
  };
}
