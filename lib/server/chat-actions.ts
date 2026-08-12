"use server";
import { getSession } from "./session";
import { db } from "./db";
import { getChatMessages } from "./data";
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
