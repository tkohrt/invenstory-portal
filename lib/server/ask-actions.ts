"use server";
// For Granted asks the client (0058, 9 October 2026).
//
// From the gap panel under a question, For Granted asks the client for
// something the question needs and no Story Card holds. The client sees it on
// their Inven(s)tory page and answers in their own words. The answer becomes a
// user-generated Story Card written (and so verified) by the client, filed as a
// Writer's note like any other (lib/server/user-card.ts), and the Storyboard
// offers it to the question that asked. For Granted is told by email and Slack.
//
// EVERY export of a "use server" module is a public endpoint: none takes a
// tenant id. The tenant and the person come from the session.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { getTenant } from "./data";
import { orgTypeOf } from "./application-parse";
import { createUserCard } from "./user-card";
import { notifyAskAnswered } from "./notify";
import { CARD_KIND_MAP, kindsFor } from "@/lib/story-card";
import { askProblem } from "@/lib/draft-gaps";
import { userCardProblem } from "@/lib/user-card";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MISSING = "Asking the client needs migration 0058. Run it in the Supabase SQL editor, then try again.";

/** For Granted asks the client for a kind of card one question needs. */
export async function askClientAction(input: { sectionId: string; kind: string; question: string }): Promise<Result<{ id: string }>> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "For Granted only." };
  const question = String(input.question ?? "").replace(/\s+/g, " ").trim();
  const problem = askProblem(question);
  if (problem) return { ok: false, error: problem };
  if (!kindsFor(await orgTypeOf(s.tenantId)).some(k => k.key === input.kind)) return { ok: false, error: "That kind of card does not apply to this client." };
  const { data: sec } = await db.from("draft_section").select("id, draft_id")
    .eq("tenant_id", s.tenantId).eq("id", input.sectionId).maybeSingle();
  if (!sec) return { ok: false, error: "That question is not in one of this client's drafts." };
  const { data: open } = await db.from("client_ask").select("id")
    .eq("tenant_id", s.tenantId).eq("section_id", sec.id).eq("kind", input.kind).eq("status", "open").maybeSingle();
  if (open) return { ok: false, error: "The client already has this question waiting." };
  const { data, error } = await db.from("client_ask").insert({
    tenant_id: s.tenantId, draft_id: sec.draft_id, section_id: sec.id, kind: input.kind, question, asked_by: s.user.id,
  }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message?.includes("client_ask") ? MISSING : `Could not send the question: ${error?.message ?? "no row"}` };
  await db.from("audit_log").insert({ actor_user_id: s.user.id, tenant_id: s.tenantId, action: "client_ask", detail: `${input.kind}: ${question.slice(0, 200)}` });
  revalidatePath("/invenstory");
  return { ok: true, id: data.id as string };
}

/** For Granted takes a question back before it is answered. */
export async function withdrawAskAction(askId: string): Promise<Result> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, error: "For Granted only." };
  const { error } = await db.from("client_ask").update({ status: "withdrawn" })
    .eq("tenant_id", s.tenantId).eq("id", askId).eq("status", "open");
  if (error) return { ok: false, error: `Could not withdraw it: ${error.message}` };
  revalidatePath("/invenstory");
  return { ok: true };
}

/**
 * The client answers. Their words become a user-generated Story Card of the
 * kind asked for, in their own voice (Living voice), written and verified by
 * them, and the question is marked answered with the card it made.
 */
export async function answerAskAction(askId: string, answer: string): Promise<Result<{ cardId: string }>> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  // The point is the client's own words: For Granted withdraws, it does not answer.
  if (s.role === "admin") return { ok: false, error: "Only the client answers these." };
  const text = String(answer ?? "").trim();
  const problem = userCardProblem(text);
  if (problem) return { ok: false, error: problem };
  const { data: ask } = await db.from("client_ask").select("id, kind, status, draft_id, section_id")
    .eq("tenant_id", s.tenantId).eq("id", askId).maybeSingle();
  if (!ask) return { ok: false, error: "That question could not be found." };
  if (ask.status !== "open") return { ok: false, error: ask.status === "answered" ? "That question has already been answered." : "For Granted withdrew that question." };

  const made = await createUserCard(s, {
    text, kind: ask.kind as string, layer: "III", asOf: null,
    sectionId: (ask.section_id as string | null) ?? null,
  });
  let cardId: string;
  if (made.ok) cardId = made.cardId;
  else if (made.existingId) cardId = made.existingId;
  else return { ok: false, error: made.error };

  const { error } = await db.from("client_ask").update({
    status: "answered", answer: text, answered_by: s.user.id, answered_at: new Date().toISOString(), card_id: cardId,
  }).eq("tenant_id", s.tenantId).eq("id", askId);
  if (error) return { ok: false, error: `Your answer was saved as a Story Card, but the question could not be closed: ${error.message}` };

  const tenant = await getTenant(s.tenantId);
  await notifyAskAnswered({
    org: tenant?.name ?? "A client", answerer: s.user.full_name || s.user.email,
    kind: CARD_KIND_MAP[ask.kind as string]?.label.toLowerCase() ?? (ask.kind as string),
    draftId: (ask.draft_id as string | null) ?? null,
  }).catch(() => null);
  revalidatePath("/invenstory");
  return { ok: true, cardId };
}
