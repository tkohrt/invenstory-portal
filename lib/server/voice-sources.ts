import "server-only";
// A client's voice-profile sources as they stand now (rules in
// lib/voice-profile.ts). Shared by the Voice profile tab and by auto-draft's
// minimum-source check. A plain server module: callers decide who is asking.
import { db } from "./db";
import { voiceSources, type VoiceSource } from "@/lib/voice-profile";

export async function currentVoiceSources(tenantId: string): Promise<VoiceSource[]> {
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

/** The client's voice profile text, or "" when none is written (or before 0062). */
export async function voiceProfileText(tenantId: string): Promise<string> {
  const { data, error } = await db.from("voice_profile").select("profile_text").eq("tenant_id", tenantId).maybeSingle();
  return error ? "" : ((data as { profile_text: string } | null)?.profile_text ?? "");
}
