// The Portal Guide (patch 16, onboarding build, 3 November 2026): how to use
// the portal, from lib/portal-guide.ts and the account's status. Never reads
// documents. Never counted against the client's AI allowance or chat limits:
// its model cost is recorded as For Granted's own (actor "system", feature
// "portal_guide"). A per-person limit stops it being used as free AI.
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { db } from "@/lib/server/db";
import { chatComplete } from "@/lib/server/llm";
import { withAiUsage } from "@/lib/server/ai-usage";
import { guideStatus, guideCounts } from "@/lib/server/portal-guide";
import {
  GUIDE_LIMITS, GUIDE_SYSTEM, guideUserPrompt, guideButtons, fallbackAnswer, looksLikeOrgQuestion, HANDOVER_TO_INVENSTORY,
} from "@/lib/portal-guide";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = session.role === "admin";
  const body = await req.json().catch(() => ({})) as { question?: unknown; sessionId?: unknown };
  const q = String(body.question ?? "").trim();
  if (!q) return NextResponse.json({ error: "empty question" }, { status: 400 });
  if (q.length > GUIDE_LIMITS.questionChars) {
    return NextResponse.json({ error: `Please keep a Portal Guide question under ${GUIDE_LIMITS.questionChars} characters.` }, { status: 400 });
  }
  const sid = typeof body.sessionId === "string" && /^[0-9a-f-]{36}$/i.test(body.sessionId) ? body.sessionId : crypto.randomUUID();

  const counts = await guideCounts(session.tenantId, session.user.id);
  if (!counts) return NextResponse.json({ error: "The Portal Guide is not available yet. Email info@forgranted.com with your question." }, { status: 503 });
  if (!admin && (counts.hour >= GUIDE_LIMITS.perHour || counts.day >= GUIDE_LIMITS.perDay)) {
    return NextResponse.json({ error: "That is a lot of Portal Guide questions for now. Try again later, or email info@forgranted.com." }, { status: 429 });
  }

  const status = await guideStatus(session);
  let answer: string;
  let generated = false;
  let handover: "invenstory" | null = null;
  if (looksLikeOrgQuestion(q)) {
    // Free and immediate: no model is asked to answer what it cannot see.
    answer = HANDOVER_TO_INVENSTORY;
    handover = "invenstory";
  } else {
    const r = await withAiUsage(
      { tenantId: session.tenantId, userId: session.user.id, actor: "system", feature: "portal_guide" },
      () => chatComplete({ system: GUIDE_SYSTEM, user: guideUserPrompt(q, status), maxTokens: 400, temperature: 0.2 }),
    ).catch(() => null);
    answer = r?.text?.replace(/\s*[—–]\s*/g, ", ").trim() || fallbackAnswer(q);
    generated = !!r?.text;
  }
  const buttons = handover ? [] : guideButtons(q, status);

  await db.from("guide_question").insert({
    tenant_id: session.tenantId, user_id: session.user.id, session_id: sid,
    question: q.slice(0, 2000), answer, buttons, generated,
  });
  return NextResponse.json({ sessionId: sid, answer, buttons, handover, generated });
}
