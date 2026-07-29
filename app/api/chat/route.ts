import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { userClient } from "@/lib/server/supabase";
import { db } from "@/lib/server/db";
import { retrieve, generate } from "@/lib/server/rag";

export const maxDuration = 60;

// AI cost is the only unbounded line item -> per-user rate limit (DB-backed so
// it holds across serverless instances): max messages per rolling minute.
const RATE_MAX = 12;
async function overRateLimit(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db.from("chat_message")
    .select("id", { count: "exact", head: true })
    .eq("author_user_id", userId).eq("role", "user").gte("created_at", since);
  return (count ?? 0) >= RATE_MAX;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (await overRateLimit(session.user.id))
    return NextResponse.json({ error: "You're sending messages very quickly — give it a moment." }, { status: 429 });

  const { question, sessionId } = await req.json();
  const q = String(question ?? "").trim();
  if (!q) return NextResponse.json({ error: "empty question" }, { status: 400 });

  const supabase = await userClient();

  // Ensure a chat session (RLS-scoped insert as the user).
  let sid = sessionId as string | undefined;
  if (!sid) {
    const { data: s } = await supabase.from("chat_session")
      .insert({ tenant_id: session.tenantId, user_id: session.user.id, title: q.slice(0, 60) })
      .select("id").single();
    sid = s?.id;
  }

  // Retrieve (RLS-scoped) -> generate (Bedrock or extractive fallback).
  const { passages, mode } = await retrieve(q);
  const answer = await generate(q, passages);

  // Persist both turns (service client: author_user_id set explicitly).
  if (sid) {
    await db.from("chat_message").insert([
      { session_id: sid, tenant_id: session.tenantId, author_user_id: session.user.id, role: "user", content: q, citations: [] },
      { session_id: sid, tenant_id: session.tenantId, author_user_id: session.user.id, role: "assistant", content: answer.content, citations: answer.citations },
    ]);
  }

  // Resolve citation titles (RLS-scoped).
  let cites: { id: string; title: string }[] = [];
  if (answer.citations.length) {
    const { data } = await supabase.from("document").select("id, title").in("id", answer.citations);
    cites = (data ?? []) as { id: string; title: string }[];
  }

  await db.from("audit_log").insert({
    actor_user_id: session.user.id, tenant_id: session.tenantId,
    action: "chat", detail: `q="${q.slice(0, 60)}" mode=${answer.mode} retrieval=${mode} cites=${cites.length}`,
  });

  return NextResponse.json({
    sessionId: sid, content: answer.content, citations: cites,
    generated: answer.generated, mode: answer.mode, retrieval: mode,
  });
}
