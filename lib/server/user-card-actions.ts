"use server";
// User-generated Story Cards (8 October 2026): a writer saves something they
// typed into a draft as a Story Card.
//
// The words are filed as a "Writer's note" in the client's Inven(s)tory (a
// text document, layer as chosen, tagged writer-note) and the card quotes it,
// so the card traces to its source like every other card: here, the person who
// wrote it, on that date. The card is created_from = 'manual' and shown as
// "User-generated". Saving it is the writer's own judgement of it, so it is
// verified by them (the same rule as editing a card). A card For Granted writes
// about a client also waits for the client to confirm it on their Story Cards
// page; that does not stop it being drafted with.
//
// EVERY export of a "use server" module is a public endpoint: none takes a
// tenant id. The tenant and the person come from the session.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { orgTypeOf } from "./application-parse";
import { getTenant } from "./data";
import { CARD_KIND_MAP, kindsFor } from "@/lib/story-card";
import { createUserCard, type SaveUserCardResult } from "./user-card";
import {
  defaultKind, isoDay, lookAlikes, mentionedFigures, sourceLine, userCardProblem, type ExistingCard,
} from "@/lib/user-card";

async function writer() {
  const s = await getSession();
  if (!s) throw new Error("Please sign in again.");
  // The Storyboarding Tool is For Granted's for now (Decision 1). Clients will
  // write their own cards here once they draft.
  if (s.role !== "admin") throw new Error("For Granted only, for now.");
  return s;
}

export interface UserCardDefaults {
  kind: string;
  kinds: { key: string; label: string }[];
  layer: "I" | "II" | "III";
  asOf: string;
  source: string;
  /** Numbers the text mentions: the one optional question is whether they come from a document. */
  figures: string[];
  /** Verified cards already in the library that look like this one. */
  lookAlikes: { id: string; statement: string; kindLabel: string; verified: boolean }[];
  problem: string | null;
}

/** Everything the save card needs, filled in, for the person to accept with one click. */
export async function prepareUserCardAction(text: string, sectionId: string | null): Promise<UserCardDefaults> {
  const s = await writer();
  const [orgType, tenant, sec, { data: cards }] = await Promise.all([
    orgTypeOf(s.tenantId),
    getTenant(s.tenantId),
    sectionId
      ? db.from("draft_section").select("wanted_kinds").eq("tenant_id", s.tenantId).eq("id", sectionId).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("story_card").select("id, kind, statement, status").eq("tenant_id", s.tenantId).neq("status", "retired"),
  ]);
  const allowed = kindsFor(orgType);
  const wanted = ((sec as { data: { wanted_kinds?: string[] } | null }).data?.wanted_kinds ?? []) as string[];
  const org = s.role === "admin" ? "For Granted" : (tenant?.name ?? "");
  const alike = lookAlikes(text, (cards ?? []) as ExistingCard[]);
  return {
    kind: defaultKind(wanted, allowed),
    kinds: allowed.map(k => ({ key: k.key, label: k.label })),
    layer: "III",
    asOf: isoDay(new Date()),
    source: sourceLine(s.user.full_name, org, new Date()),
    figures: mentionedFigures(text),
    lookAlikes: alike.map(c => ({ id: c.id, statement: c.statement, kindLabel: CARD_KIND_MAP[c.kind]?.label ?? c.kind, verified: c.status === "verified" })),
    problem: userCardProblem(text),
  };
}


/** Save a user-generated Story Card: the Writer's note first, then the card that quotes it. */
export async function saveUserCardAction(input: Parameters<typeof createUserCard>[1]): Promise<SaveUserCardResult> {
  const s = await writer();
  return createUserCard(s, input);
}

/** A client confirms a card For Granted wrote about them. */
export async function confirmUserCardAction(cardId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Please sign in again." };
  const { data: c } = await db.from("story_card").select("id, created_from, written_by_role").eq("tenant_id", s.tenantId).eq("id", cardId).maybeSingle();
  if (!c || c.created_from !== "manual") return { ok: false, error: "That card could not be found." };
  const { error } = await db.from("story_card").update({ client_confirmed_at: new Date().toISOString(), client_confirmed_by: s.user.id })
    .eq("tenant_id", s.tenantId).eq("id", cardId);
  if (error) return { ok: false, error: "Could not record that. Please try again." };
  revalidatePath("/story-cards");
  return { ok: true };
}
