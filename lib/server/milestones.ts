import "server-only";
// Activation milestones for every client (client activity, patch 3). For
// Granted only; read-only. Each comes from something the portal already keeps:
//   first document, 5 documents   document.created_at
//   Inven(s)tory analysed         the first finished analysis job
//   eligibility confirmed         analysis_client_state.eligibility_confirmed_at
//   first look at Funder Matches  the first recorded visit (from 6 October 2026)
//   first draft, first submission grant_draft.created_at and submitted_at
import { db } from "./db";
import { milestoneTimeline, nthEarliest, type Milestone } from "@/lib/activity";

export async function getAllMilestones(): Promise<Map<string, Milestone[]>> {
  const [{ data: tenants }, { data: docs }, { data: jobs }, { data: states }, { data: visits }, { data: drafts }] = await Promise.all([
    db.from("tenant").select("id, created_at"),
    db.from("document").select("tenant_id, created_at").limit(50000),  // tenant-safe: admin milestones across every client
    db.from("job").select("tenant_id, finished_at").eq("kind", "analysis").eq("status", "done"),  // tenant-safe: admin milestones across every client
    db.from("analysis_client_state").select("tenant_id, eligibility_confirmed_at"),  // tenant-safe: admin milestones across every client
    db.from("activity_event").select("tenant_id, created_at").eq("feature", "funder_matches").order("created_at").limit(20000),  // tenant-safe: admin milestones across every client
    db.from("grant_draft").select("tenant_id, created_at, submitted_at, purpose"),  // tenant-safe: admin milestones across every client
  ]);
  type T = { tenant_id: string };
  const of = <R extends T>(rows: R[] | null, id: string) => (rows ?? []).filter(r => r.tenant_id === id);
  const out = new Map<string, Milestone[]>();
  for (const t of (tenants ?? []) as { id: string; created_at: string }[]) {
    const myDocs = of(docs as (T & { created_at: string })[] | null, t.id).map(d => d.created_at);
    const myDrafts = of(drafts as (T & { created_at: string; submitted_at: string | null; purpose: string | null })[] | null, t.id)
      .filter(d => d.purpose !== "standard_answers");
    out.set(t.id, milestoneTimeline(t.created_at, {
      first_document: nthEarliest(myDocs, 1),
      five_documents: nthEarliest(myDocs, 5),
      analysed: nthEarliest(of(jobs as (T & { finished_at: string | null })[] | null, t.id).map(j => j.finished_at), 1),
      eligibility: of(states as (T & { eligibility_confirmed_at: string | null })[] | null, t.id)[0]?.eligibility_confirmed_at ?? null,
      funder_matches: of(visits as (T & { created_at: string })[] | null, t.id)[0]?.created_at ?? null,
      first_draft: nthEarliest(myDrafts.map(d => d.created_at), 1),
      first_submission: nthEarliest(myDrafts.map(d => d.submitted_at), 1),
    }));
  }
  return out;
}
