"use server";
import { getSession } from "./session";
import { db } from "./db";
import { getChatMessages } from "./data";
import { guideTurns } from "./portal-guide";
import type { ChatHistoryMsg } from "@/lib/types";

export async function loadSessionAction(sessionId: string): Promise<ChatHistoryMsg[]> {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  return getChatMessages(sessionId, s.tenantId, s.user.id);
}

export async function deleteSessionAction(sessionId: string): Promise<void> {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  // Scope the delete to the caller's own session; messages cascade.
  await db.from("chat_session").delete()
    .eq("id", sessionId).eq("tenant_id", s.tenantId).eq("user_id", s.user.id);
}

// ---- Answer controls and the Portal Guide (patch 16, 3 November 2026) ----

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/**
 * "Save as a Story Card" on a chat answer. Story Cards trace to a source, so
 * an answer is not filed as one directly: it goes to For Granted, who make
 * the card from the documents it cites (shown on the client's admin page).
 */
export async function suggestCardFromAnswerAction(input: { question: string; answer: string; sources: string[] }): Promise<{ ok: boolean; message: string }> {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const answer = clip(input.answer, 1500);
  if (answer.length < 20) return { ok: false, message: "That answer is too short to make a card from." };
  const detail = JSON.stringify({ q: clip(input.question, 200), a: answer, src: (input.sources ?? []).slice(0, 8).map(x => clip(x, 200)) });
  const { error } = await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "chat_card_suggestion", detail });
  if (error) return { ok: false, message: "That did not save. Please try again." };
  return { ok: true, message: s.role === "admin" ? "Added to this client's suggested Story Cards." : "Sent to your For Granted team, who will make it a Story Card from the documents it cites." };
}

/** "Not right" on an answer: For Granted sees it, with the question. */
export async function answerNotRightAction(input: { lane: "invenstory" | "guide"; question: string; answer: string }): Promise<{ ok: boolean }> {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const detail = JSON.stringify({ lane: input.lane === "guide" ? "guide" : "invenstory", q: clip(input.question, 300), a: clip(input.answer, 600) });
  const { error } = await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "chat_not_right", detail });
  return { ok: !error };
}

export async function loadGuideSessionAction(sessionId: string) {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return [];
  return guideTurns(s.tenantId, s.user.id, sessionId);
}
