import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { userClient } from "@/lib/server/supabase";
import { db } from "@/lib/server/db";
import { retrieve, retrieveCards, generate } from "@/lib/server/rag";
import { decideChat } from "@/lib/usage-limits";
import { chatCounts, withAiUsage } from "@/lib/server/ai-usage";

export const maxDuration = 60;

// The client limits (lib/usage-limits.ts, decided 6 October 2026): a question
// at most about a page long, 12 a minute and 50 a day per person, and 500 a
// month for each client across all of its logins. Counts are DB-backed so they
// hold across serverless instances. For Granted's admins are never limited.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = session.role === "admin";

  const { question, sessionId } = await req.json();
  const q = String(question ?? "").trim();
  if (!q) return NextResponse.json({ error: "empty question" }, { status: 400 });

  const counts = admin ? { minute: 0, day: 0, month: 0 } : await chatCounts(session.tenantId, session.user.id);
  const decision = decideChat(admin ? "admin" : "client", q.length, counts);
  if (!decision.ok) {
    return NextResponse.json({ error: decision.message, limit: decision.reason, canRequest: decision.canRequest }, { status: 429 });
  }

  const supabase = await userClient();

  // Ensure a chat session (RLS-scoped insert as the user).
  let sid = sessionId as string | undefined;
  if (sid) {
    // Verify a supplied session belongs to this caller (RLS-scoped) — red-team M2.
    const { data: owned } = await supabase.from("chat_session").select("id").eq("id", sid).maybeSingle();
    if (!owned) sid = undefined;
  }
  if (!sid) {
    const { data: s } = await supabase.from("chat_session")
      .insert({ tenant_id: session.tenantId, user_id: session.user.id, title: q.slice(0, 60) })
      .select("id").single();
    sid = s?.id;
  }

  // Retrieve (RLS-scoped) -> generate (Bedrock or extractive fallback).
  // Admins have RLS lifted, so re-scope retrieval to the tenant being viewed
  // (parity with the search route) — red-team L1.
  // Story Cards first (every document, quote-checked), then the closest passages.
  const [r, cardPassages] = await Promise.all([
    retrieve(q, 6, session.role === "admin" ? session.tenantId : undefined),
    retrieveCards(q, session.tenantId, 4).catch(() => []),
  ]);
  const passages = [...cardPassages, ...r.passages];
  const mode = r.mode;
  const answer = await withAiUsage(
    { tenantId: session.tenantId, userId: session.user.id, actor: admin ? "admin" : "client", feature: "chat" },
    () => generate(q, passages));

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
    // Near a limit, the page says how many questions are left.
    usageWarning: "warning" in decision ? decision.warning : null,
  });
}
