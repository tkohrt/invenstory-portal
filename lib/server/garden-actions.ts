"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";

const POTS = ["terracotta", "glazed", "mosaic", "talavera", "porcelain", "jade", "raku"];
const TRINKETS = ["fg_flag", "gnome", "mushroom", "crane", "funded_flag"];
const VARIEGATIONS = ["variegated", "golden"];

export async function setPlantAction(input: {
  species?: "pothos" | "monstera" | "spider";
  pot?: string; trinket?: string | null; variegation?: string | null; hidden?: boolean;
}) {
  const s = await getSession();
  if (!s) throw new Error("unauthorized");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.species) patch.species = input.species;
  if (input.pot && POTS.includes(input.pot)) patch.pot = input.pot;
  if (input.trinket !== undefined) patch.trinket = input.trinket && TRINKETS.includes(input.trinket) ? input.trinket : null;
  if (input.variegation !== undefined) patch.variegation = input.variegation && VARIEGATIONS.includes(input.variegation) ? input.variegation : null;
  if (input.hidden !== undefined) patch.hidden = input.hidden;
  await db.from("plant_state").upsert({ tenant_id: s.tenantId, ...patch }, { onConflict: "tenant_id" });
  revalidatePath("/invenstory");
}
