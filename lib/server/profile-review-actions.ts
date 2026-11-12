"use server";
// Fact review on the matching-profile page (patch 34). Two verbs, chosen over
// an edit box on purpose: CONFIRM stamps the fact as the client's own
// agreement (a signal, later a weighting input), FLAG tells For Granted the
// fact reads wrong, with the client's words attached. Corrections then happen
// at the source (a document, or For Granted's profile tools), never by typing
// over the profile, so it can never assert what no document supports.
import { revalidatePath } from "next/cache";
import { getSession } from "./session";
import { db } from "./db";
import { getTenant } from "./data";
import { notifyClientRequest } from "./notify";

export async function reviewFactAction(input: {
  factId: string;
  /** removed (patch 35): one click takes the fact out of the client's
      searches, no reason required, undoable with "clear". Removal never
      breaks provenance: nothing new is asserted. */
  state: "confirmed" | "flagged" | "removed" | "clear";
  /** For a flag: what looks wrong, in the client's words. */
  note?: string;
  /** For the notification only; never stored beyond the note. */
  factText?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "Not signed in." };
  const factId = String(input.factId ?? "").slice(0, 40);
  if (!factId || !/^[a-z0-9]+$/.test(factId)) return { ok: false, error: "That fact could not be identified." };

  if (input.state === "clear") {
    const { error } = await db.from("profile_fact_review")
      .delete().eq("tenant_id", s.tenantId).eq("fact_id", factId);
    if (error) { console.error("[profile-review] clear failed", error); return { ok: false, error: "That did not save. Try again." }; }
  } else {
    const note = input.state === "flagged" ? (input.note ?? "").trim().slice(0, 600) || null : null;
    const { error } = await db.from("profile_fact_review").upsert({
      tenant_id: s.tenantId, fact_id: factId, state: input.state, note,
      by_user: s.user.id, at: new Date().toISOString(),
    }, { onConflict: "tenant_id,fact_id" });
    if (error) { console.error("[profile-review] write failed", error); return { ok: false, error: "That did not save. Try again." }; }

    // A flag asks for For Granted's eyes; a removal just informs them (it is
    // already done, and undoable). Admin self-actions notify nobody.
    if ((input.state === "flagged" || input.state === "removed") && s.role === "client") {
      const tenant = await getTenant(s.tenantId).catch(() => null);
      const fact = (input.factText ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      await notifyClientRequest({
        org: tenant?.name ?? "A client", requester: s.user.full_name ?? s.user.email ?? "A teammate",
        what: input.state === "flagged"
          ? `flagged a matching-profile fact${fact ? ` ("${fact}")` : ""}${note ? `: ${note}` : ""}`
          : `removed a matching-profile fact from their searches${fact ? ` ("${fact}")` : ""}. No action needed; it is undoable on their profile page.`,
        tenantId: s.tenantId,
      }).catch(e => console.error("[profile-review] notify failed", e));
    }
  }
  revalidatePath("/matching-profile");
  return { ok: true };
}
