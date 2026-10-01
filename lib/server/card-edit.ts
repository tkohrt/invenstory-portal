import "server-only";
// Rewriting a card's statement: the rules, shared by For Granted's Card Library
// and a client's Story Cards page.
//
// A plain server module, not "use server": it takes a tenant and a user and must
// only be called from an action that has already decided who is asking.
//
// A new version, never an overwrite, and marked human so no rebuild replaces it.
// Refused if the new wording uses a figure none of the card's quotes contain:
// the same rule the extraction obeys. Someone may know the newer number; the
// place to put it is the Inven(s)tory, where it gains a source.
import { db } from "./db";
import { assessLibrarySensitivity } from "./card-extract";
import { MIN_STATEMENT_WORDS, MAX_STATEMENT_WORDS, untracedFigures } from "@/lib/story-card";

export async function writeCardEdit(tenantId: string, userId: string, id: string, statement: string): Promise<number | null> {
  const { data: card, error: rErr } = await db.from("story_card").select("id, statement, version, status")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (rErr) throw new Error(`card read failed: ${rErr.message}`);
  if (!card) throw new Error("That card is not in this library.");
  if (card.status === "retired") throw new Error("A retired card cannot be edited. Reinstate it first.");

  const text = statement.trim().replace(/\s+/g, " ");
  const n = text.split(" ").filter(Boolean).length;
  if (n < MIN_STATEMENT_WORDS) throw new Error(`A card needs at least ${MIN_STATEMENT_WORDS} words to stand on its own.`);
  if (n > MAX_STATEMENT_WORDS) throw new Error(`A card is one claim; keep it under ${MAX_STATEMENT_WORDS} words, or split it.`);
  if (text === card.statement) return null;

  const { data: ev } = await db.from("story_card_evidence").select("quote")
    .eq("tenant_id", tenantId).eq("card_id", id);
  const quotes = ((ev ?? []) as { quote: string }[]).map(e => e.quote).join("\n");
  const untraced = untracedFigures(text, quotes);
  if (untraced.length) {
    throw new Error(`${untraced.join(", ")} ${untraced.length === 1 ? "is" : "are"} not in any of this card's sources. `
      + "Add the source to the Inven(s)tory first, so the figure has evidence behind it.");
  }

  const version = (card.version as number) + 1;
  const { error: vErr } = await db.from("story_card_version").insert({
    card_id: id, tenant_id: tenantId, version, statement: text, origin: "human", created_by: userId,
  });
  if (vErr) throw new Error(`could not save the new version: ${vErr.message}`);
  const { error } = await db.from("story_card").update({
    statement: text, statement_origin: "human", version, updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", id);
  if (error) throw new Error(`could not update the card: ${error.message}`);
  // The new wording may have removed, or added, what made it sensitive.
  await assessLibrarySensitivity(tenantId);
  return version;
}
