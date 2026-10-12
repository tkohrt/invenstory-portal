"use server";
// Recording how the grant a document holds turned out (Auto-Draft spec,
// section 8; 12 October 2026): Won, Not funded, Pending or Unknown, or none.
// "Winning grant" is outcome = won.
//
// A client records outcomes on its own documents; For Granted on any document
// of the client it is viewing, and a client cannot overwrite For Granted's
// (pure rule: outcomeChangeRefusal in lib/doc-outcome.ts). A "use server"
// export is a public endpoint, so the document is checked against the caller's
// own tenant through RLS before anything is written.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { userClient } from "./supabase";
import { db } from "./db";
import { OUTCOME_LABEL, outcomeChangeRefusal, parseOutcome } from "@/lib/doc-outcome";

/** Set (or clear, with null) one document's outcome. Returns a reason rather than throwing it, so the page can show it. */
export async function setDocOutcomeAction(documentId: string, outcome: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  const value = parseOutcome(outcome);
  if (outcome !== null && !value) return { ok: false, error: "Choose an outcome from the list." };
  const supabase = await userClient();
  // Every column (not a list), so the read works before 0060 is run and the write reports it.
  const { data: doc } = await supabase.from("document").select("*").eq("id", documentId).maybeSingle();
  const row = doc as { tenant_id: string; outcome?: string | null; outcome_set_by?: string | null } | null;
  // An admin's RLS sees every client: keep to the client being viewed.
  if (!row || row.tenant_id !== s.tenantId) return { ok: false, error: "That document could not be found." };
  if ((row.outcome ?? null) === value) return { ok: true };

  const setBy = row.outcome ? row.outcome_set_by ?? null : null;
  let setByRole: "admin" | "client" | null = null;
  if (setBy && s.role !== "admin" && setBy !== s.user.id) {
    const { data: who } = await db.from("app_user").select("role").eq("id", setBy).maybeSingle();  // tenant-safe: one user's role by id
    setByRole = ((who as { role: string } | null)?.role === "admin") ? "admin" : "client";
  }
  const refusal = outcomeChangeRefusal({ role: s.role === "admin" ? "admin" : "client", userId: s.user.id, setBy, setByRole });
  if (refusal) return { ok: false, error: refusal };

  const { error } = await db.from("document").update({
    outcome: value, outcome_set_by: value ? s.user.id : null, outcome_set_at: value ? new Date().toISOString() : null,
  }).eq("tenant_id", s.tenantId).eq("id", documentId);
  if (error) return { ok: false, error: "The outcome could not be saved. Has migration 0060 been run?" };
  await db.from("audit_log").insert({
    actor_user_id: s.user.id, tenant_id: s.tenantId, action: "doc_outcome",
    detail: `${documentId} -> ${value ? OUTCOME_LABEL[value] : "none"}`,
  });
  for (const p of ["/invenstory", "/search", "/chat"]) revalidatePath(p);
  return { ok: true };
}
