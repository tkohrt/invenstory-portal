"use server";
// The voice profile on the server (Auto-Draft patch 4; rules in
// lib/voice-profile.ts). For Granted only. Plumbing: nothing writes a profile
// automatically; For Granted writes and corrects it on the client's activity
// page. The house style guide and the profile guide are to be written together
// at the end of the Auto-Draft build (Shane, 12 October 2026).
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { tenantIsBrain } from "./brain";
import {
  MINIMUM_MESSAGE, PROFILE_MAX_CHARS, minimumMet, parseSources, sourcesChanged, voiceSources, type VoiceSource,
} from "@/lib/voice-profile";

export interface VoiceProfileView {
  tenantId: string;
  /** False before migration 0062 is run. */
  ready: boolean;
  text: string;
  editedAt: string | null;
  editedBy: string | null;
  builtAt: string | null;
  sources: VoiceSource[];
  minimum: { met: boolean; message: string };
  /** What changed in the sources since the profile was last saved (null if never saved). */
  changed: ReturnType<typeof sourcesChanged> | null;
}

/** The client's sources, as they stand now. Every read is scoped to the client. */
async function currentSources(tenantId: string): Promise<VoiceSource[]> {
  const [{ data: answers }, { data: docs }, { data: drafts }] = await Promise.all([
    db.from("answer").select("id, question:question_id(prompt_text)").eq("tenant_id", tenantId).eq("status", "published"),
    // Every column (not a list): type_tag (0056) and outcome (0060) are read if present.
    db.from("document").select("*").eq("tenant_id", tenantId).eq("status", "ready"),
    db.from("grant_draft").select("id, title, status, purpose").eq("tenant_id", tenantId).eq("status", "won"),
  ]);
  return voiceSources({
    answers: ((answers ?? []) as unknown as { id: string; question: { prompt_text: string } | null }[])
      .map(a => ({ id: a.id, question: a.question?.prompt_text ?? null })),
    documents: (docs ?? []) as { id: string; title: string; type_tag?: string | null; outcome?: string | null }[],
    drafts: (drafts ?? []) as { id: string; title: string; status: string; purpose?: string | null }[],
  });
}

/** For Granted reads a client's voice profile and its sources. Null for a client, or for the Brain. */
export async function getVoiceProfile(tenantId: string): Promise<VoiceProfileView | null> {
  const s = await getSession();
  if (!s || s.role !== "admin") return null;
  if (await tenantIsBrain(tenantId)) return null;
  const sources = await currentSources(tenantId);
  const { data, error } = await db.from("voice_profile").select("*").eq("tenant_id", tenantId).maybeSingle();
  const row = error ? null : (data as { profile_text: string; sources: unknown; built_at: string | null; edited_by: string | null; edited_at: string | null } | null);
  let editedBy: string | null = null;
  if (row?.edited_by) {
    const { data: who } = await db.from("app_user").select("full_name").eq("id", row.edited_by).maybeSingle();  // tenant-safe: one admin's name by id
    editedBy = (who as { full_name: string } | null)?.full_name ?? null;
  }
  return {
    tenantId, ready: !error, text: row?.profile_text ?? "",
    editedAt: row?.edited_at ?? null, editedBy, builtAt: row?.built_at ?? null,
    sources,
    minimum: { met: minimumMet(sources), message: MINIMUM_MESSAGE },
    changed: row ? sourcesChanged(parseSources(row.sources), sources) : null,
  };
}

/**
 * For Granted saves the profile it wrote or corrected, with the sources as they
 * stand now, so the page can later say what changed since. Returns a reason
 * rather than throwing it, so the page can show it.
 */
export async function saveVoiceProfileAction(tenantId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "Only For Granted can edit a voice profile." };
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return { ok: false, error: "That client could not be found." };
  if (await tenantIsBrain(tenantId)) return { ok: false, error: "The Brain has no voice profile of its own." };
  const body = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (body.length > PROFILE_MAX_CHARS) return { ok: false, error: `Keep the profile under ${PROFILE_MAX_CHARS.toLocaleString()} characters.` };
  const sources = await currentSources(tenantId);
  const { error } = await db.from("voice_profile").upsert({
    tenant_id: tenantId, profile_text: body, sources, edited_by: s.user.id, edited_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: "The profile could not be saved. Has migration 0062 been run?" };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: tenantId, action: "voice_profile_edit", detail: `${body.length} characters, ${sources.length} sources` });
  revalidatePath(`/admin/clients/${tenantId}`);
  return { ok: true };
}
