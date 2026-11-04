import "server-only";
// Company setup, the reads (patch 14, onboarding build, 3 November 2026).
// The rules are in lib/setup.ts; the writes in lib/server/setup-actions.ts.
import crypto from "crypto";
import { cache } from "react";
import { db } from "./db";
import { processDocument } from "./ingest";
import { readUrl, Plain } from "./read-url";
import type { SetupState, SetupAnswers, SetupStepKey, StepState } from "@/lib/setup";
import { isStepKey } from "@/lib/setup";

interface Row {
  tenant_id: string; owner_user_id: string | null; status: "in_progress" | "complete";
  steps: Record<string, unknown> | null; answers: SetupAnswers | null;
  layer3_read_at: string | null; legacy: boolean; completed_at: string | null;
}

function fromRow(tenantId: string, r: Row | null): SetupState {
  const steps: Partial<Record<SetupStepKey, StepState>> = {};
  for (const [k, v] of Object.entries(r?.steps ?? {})) if (isStepKey(k) && (v === "done" || v === "skipped")) steps[k] = v;
  return {
    tenantId,
    ownerUserId: r?.owner_user_id ?? null,
    status: r?.status ?? "in_progress",
    steps,
    answers: r?.answers ?? {},
    layer3ReadAt: r?.layer3_read_at ?? null,
    legacy: !!r?.legacy,
    completedAt: r?.completed_at ?? null,
  };
}

/**
 * The client's setup. No row is a client made after 0077 that has not started.
 * Null when the table cannot be read (0077 not yet run): the portal then
 * behaves as it did before this build, and nobody is sent into setup.
 */
export const getSetupState = cache(async (tenantId: string): Promise<SetupState | null> => {
  const { data, error } = await db.from("tenant_setup").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) { console.error("[setup] read failed", error.message); return null; }
  return fromRow(tenantId, data as Row | null);
});

/**
 * The first client user to arrive claims the setup. Atomic: the row is made
 * if missing, then the owner is set only where none is set yet, so two people
 * signing in at once cannot both be taken through it.
 */
export async function claimSetup(tenantId: string, userId: string): Promise<SetupState | null> {
  await db.from("tenant_setup").upsert({ tenant_id: tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
  await db.from("tenant_setup").update({ owner_user_id: userId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).is("owner_user_id", null);
  const { data, error } = await db.from("tenant_setup").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) return null;
  return fromRow(tenantId, data as Row | null);
}

/** The name of the person doing the setup, for the teammates' note. */
export async function ownerName(tenantId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await db.from("app_user").select("full_name, email").eq("tenant_id", tenantId).eq("id", userId).maybeSingle();
  const u = data as { full_name?: string | null; email?: string | null } | null;
  return u?.full_name?.trim() || u?.email || null;
}

/** Documents per layer, for the step screens. */
export async function setupDocs(tenantId: string): Promise<{ id: string; title: string; layer: string; status: string }[]> {
  const { data } = await db.from("document").select("id, title, layer, status")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
  return (data ?? []) as { id: string; title: string; layer: string; status: string }[];
}

/**
 * Read a public web page into the Inven(s)tory as a 'web' document. Used for
 * the website on step 1 and for links added on the Layer steps. Failures are
 * written for the person (read-url's Plain) and returned, never thrown.
 */
export async function addWebDocument(a: {
  tenantId: string; userId: string; role: "admin" | "client"; url: string; layer: "I" | "II"; tag?: string;
}): Promise<{ ok: true; id: string; title: string } | { ok: false; error: string }> {
  let read: { text: string; url: string };
  try { read = await readUrl(a.url, "Upload the page as a file instead."); }
  catch (e) { return { ok: false, error: e instanceof Plain ? e.message : "That page could not be read. Upload it as a file instead." }; }
  const host = (() => { try { return new URL(read.url).hostname.replace(/^www\./, ""); } catch { return "web page"; } })();
  const docId = crypto.randomUUID();
  const storageKey = `${a.tenantId}/${docId}/1`;
  const title = a.tag === "website" ? `Website: ${host}` : `Web page: ${host}`;
  const content = `${title}\nRead from ${read.url}\n\n${read.text}`;
  const up = await db.storage.from("documents").upload(storageKey, Buffer.from(content, "utf8"), { contentType: "text/plain" });
  if (up.error) return { ok: false, error: "That page was read but could not be stored. Please try again." };
  const { error } = await db.from("document").insert({
    id: docId, tenant_id: a.tenantId, title, layer: a.layer,
    storage_key: storageKey, mime_type: "text/plain", doc_kind: "web", status: "pending",
    uploaded_by: a.userId, source: a.role === "admin" ? "for_granted" : "client",
  });
  if (error) return { ok: false, error: "That page was read but could not be filed. Please try again." };
  await db.from("document_version").insert({ document_id: docId, tenant_id: a.tenantId, version: 1, storage_key: storageKey, uploaded_by: a.userId });
  await db.from("document_tag").insert([
    { document_id: docId, tenant_id: a.tenantId, tag: a.tag ?? "web-page" },
  ]);
  try { await processDocument(docId, { actor: a.role }); } catch { /* status recorded on the document */ }
  return { ok: true, id: docId, title };
}

/** Is a website document already filed? So step 1 does not read it twice. */
export async function hasWebsiteDoc(tenantId: string): Promise<boolean> {
  const { data } = await db.from("document_tag").select("document_id").eq("tenant_id", tenantId).eq("tag", "website").limit(1);
  return (data ?? []).length > 0;
}
