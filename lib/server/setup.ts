import "server-only";
// Company setup, the reads (patch 14, onboarding build, 3 November 2026).
// The rules are in lib/setup.ts; the writes in lib/server/setup-actions.ts.
import crypto from "crypto";
import { cache } from "react";
import { db } from "./db";
import { processDocument } from "./ingest";
import { readUrl, Plain } from "./read-url";
import { suggestionFor } from "@/lib/setup-docs";
import { DOC_TYPE_MAP } from "@/lib/analysis";
import { markStaleOnUpload } from "./artifacts";
import type { SetupState, SetupAnswers, SetupStepKey, StepState } from "@/lib/setup";
import { isStepKey } from "@/lib/setup";
import { cleanPeerOrgs } from "@/lib/peers";

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
let warned = false;
export const getSetupState = cache(async (tenantId: string): Promise<SetupState | null> => {
  const { data, error } = await db.from("tenant_setup").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) {
    // Before 0077 runs this fails on every page; say so once per server, not per page.
    if (!warned) { warned = true; console.error("[setup] read failed (has 0077 been run?)", error.message); }
    return null;
  }
  return fromRow(tenantId, data as Row | null);
});

/** The peer organizations this client named (patch 48). Empty when none, or when setup cannot be read. */
export async function getPeerOrgs(tenantId: string): Promise<string[]> {
  const state = await getSetupState(tenantId).catch(() => null);
  return cleanPeerOrgs(state?.answers.peer_orgs);
}

/**
 * The first client user to arrive claims the setup. Atomic: the row is made
 * if missing, then the owner is set only where none is set yet, so two people
 * signing in at once cannot both be taken through it.
 */
export async function claimSetup(tenantId: string, userId: string): Promise<SetupState | null> {
  await db.from("tenant_setup").upsert({ tenant_id: tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
  await db.from("tenant_setup").update({ owner_user_id: userId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("status", "in_progress").is("owner_user_id", null);
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
export async function setupDocs(tenantId: string): Promise<{ id: string; title: string; layer: string; status: string; typeTag: string | null; mine: boolean; suggested: string | null }[]> {
  const [{ data }, { data: read }] = await Promise.all([
    db.from("document").select("id, title, layer, status, type_tag, source")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200),
    // What the analysis thinks each document is (patch 61). Quiet if the table
    // cannot be read: setup must never fail for want of a suggestion.
    db.from("analysis_doc").select("document_id, doc_type").eq("tenant_id", tenantId),
  ]);
  const looksLike = new Map(((read ?? []) as { document_id: string; doc_type: string | null }[]).map(r => [r.document_id, r.doc_type]));
  return (data ?? []).map(d => ({
    id: d.id as string, title: d.title as string, layer: d.layer as string, status: d.status as string,
    typeTag: (d as { type_tag?: string | null }).type_tag ?? null,
    // Offered on the row for one-click confirming; never applied by itself.
    suggested: suggestionFor((d as { type_tag?: string | null }).type_tag ?? null, looksLike.get(d.id as string) ?? null, k => !!DOC_TYPE_MAP[k]),
    // Added by the client's own people (not For Granted): the only documents
    // the setup list offers to remove (patch 60, lib/setup-docs.ts).
    mine: (d as { source?: string | null }).source === "client",
  }));
}

/**
 * Take one of a tenant's documents out entirely: every stored version, then
 * the row, which takes its text, chunks, tags, versions, Story Cards and
 * analysis rows with it (on delete cascade). The same steps as deleteDocAction;
 * here so the setup list can remove a document under its own, narrower rules.
 * The caller has already decided this person may do it.
 */
export async function removeTenantDocument(tenantId: string, doc: { id: string; storage_key: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const folder = doc.storage_key.split("/").slice(0, 2).join("/");
  // Never list outside this tenant's own folder, whatever a stored key says.
  if (folder.split("/")[0] === tenantId) {
    const { data: objs } = await db.storage.from("documents").list(folder);
    if (objs?.length) await db.storage.from("documents").remove(objs.map(o => `${folder}/${o.name}`));
  }
  const { error } = await db.from("document").delete().eq("tenant_id", tenantId).eq("id", doc.id);
  if (error) return { ok: false, error: "That document could not be removed. Please try again." };
  await markStaleOnUpload(tenantId).catch(() => { /* best-effort, as on upload */ });
  return { ok: true };
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
  // As for any upload (lib/server/upload.ts): new material marks Story Intelligence stale.
  await markStaleOnUpload(a.tenantId).catch(() => { /* best-effort */ });
  return { ok: true, id: docId, title };
}

/** Is a website document already filed? So step 1 does not read it twice. */
export async function hasWebsiteDoc(tenantId: string): Promise<boolean> {
  const { data } = await db.from("document_tag").select("document_id").eq("tenant_id", tenantId).eq("tag", "website").limit(1);
  return (data ?? []).length > 0;
}
