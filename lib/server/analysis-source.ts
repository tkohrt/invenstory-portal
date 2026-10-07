import "server-only";
// Is this client on the analysis (Phase D switch-over)? The one question every
// old read asks before it runs. Kept apart from analysis-switch.ts, which does
// the switching, so the Card Library merge can ask without an import cycle.
// The rule itself is pure, in lib/analysis-switch.ts.
import { db } from "./db";
import { isOnAnalysis, PROVING_TENANT_ID, type SwitchRow } from "@/lib/analysis-switch";

export interface SwitchStatus {
  onAnalysis: boolean;
  switchedAt: string | null;
  switchedOffAt: string | null;
  /** When RE-Assist switched: the proof for every other client (decision 29). */
  proofAt: string | null;
}

/** When the proving client switched, or null. Before migration 0055, null. */
export async function proofAt(): Promise<string | null> {
  const { data, error } = await db.from("analysis_client_state").select("switched_at, gate_snapshot")
    .eq("tenant_id", PROVING_TENANT_ID).maybeSingle();
  if (error || !data) return null;
  const r = data as { switched_at: string | null; gate_snapshot: unknown };
  return r.gate_snapshot ? r.switched_at : null;
}

export async function switchStatus(tenantId: string): Promise<SwitchStatus> {
  const [{ data: row, error }, { data: tenant }, proof] = await Promise.all([
    db.from("analysis_client_state").select("switched_at, switched_off_at").eq("tenant_id", tenantId).maybeSingle(),
    db.from("tenant").select("created_at").eq("id", tenantId).maybeSingle(),
    proofAt(),
  ]);
  const r = error ? null : (row as SwitchRow | null);
  return {
    onAnalysis: isOnAnalysis(r, (tenant as { created_at: string } | null)?.created_at ?? null, proof),
    switchedAt: r?.switched_at ?? null,
    switchedOffAt: r?.switched_off_at ?? null,
    proofAt: proof,
  };
}

/** Never throws: if the state cannot be read the client stays on the old reads, as before Phase D. */
export async function onAnalysis(tenantId: string): Promise<boolean> {
  try { return (await switchStatus(tenantId)).onAnalysis; } catch { return false; }
}
