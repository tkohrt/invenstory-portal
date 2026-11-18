import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import RfpResultsView, { type RfpResultRow } from "@/components/RfpResultsView";

// One client's RFP Engine results, For Granted's view (patch 58). The client
// tab follows once these have been checked against the concierge scan.
export default async function RfpResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role !== "admin") redirect("/invenstory");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // tenant-safe: one tenant row by id, admin page.
  const { data: t } = await db.from("tenant").select("name").eq("id", id).maybeSingle();
  if (!t) notFound();
  const { data, error } = await db.from("rfp_eligible")
    .select("notice_id, action, bucket, fit, rationale, evidence, gate_result, gate_blockers, gate_checks, lift_class, lift_hours, deal_breaker, strategic_note, admin_triage, first_seen_at, verified_at, rfp_notice(title, agency, notice_type_raw, set_aside, naics, due_at, due_date_only, description_url, solicitation_number)")
    .eq("tenant_id", id).order("verified_at", { ascending: false }).limit(400);
  const { data: run } = await db.from("rfp_run").select("started_at, status, trigger, candidates, scored, new_ids")
    .eq("tenant_id", id).order("started_at", { ascending: false }).limit(1).maybeSingle();
  // Patch 66: which results are already on the client's Following list. Survives a missing 0099 (no rfp rows yet).
  const { data: fol } = await db.from("saved_item").select("target_id").eq("tenant_id", id).eq("kind", "rfp");
  return (
    <RfpResultsView tenantId={id} following={((fol ?? []) as { target_id: string }[]).map(f => f.target_id)} orgName={(t as { name: string }).name}
      rows={error ? [] : ((data ?? []) as unknown as RfpResultRow[])}
      missing={!!error}
      lastRun={(run as { started_at: string; status: string; trigger: string; candidates: number; scored: number; new_ids: string[] } | null) ?? null} />
  );
}
