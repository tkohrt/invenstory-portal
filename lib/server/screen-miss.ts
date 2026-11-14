import "server-only";
// The eligibility feedback loop (patch 44): what happens after a client gives
// a "Not for us" reason. Called from setClientViewAction, always best-effort:
// the dismissal itself must land whatever happens here.
//
//   wrong_place / not_eligible / too_small / too_big
//       -> a screen_miss row: the grant's text, the client's profile at that
//          moment, the claimed reason. The regression corpus the screen's
//          rules are tuned against.
//   wrong_place / not_eligible additionally
//       -> a Requests-inbox row (patch 37), because the screen should have
//          caught these and For Granted must see every one.
//   already_known (funders)
//       -> joins the client's known-funder relationships, so the funder is
//          never presented as a discovery again.
import { db } from "./db";
import { getEligibilityProfile } from "./eligibility";
import { notifyClientRequest } from "./notify";
import type { ClientViewKind } from "@/lib/client-view";

const MISS_REASONS = new Set(["wrong_place", "not_eligible", "too_small", "too_big"]);
const INBOX_REASONS = new Set(["wrong_place", "not_eligible"]);

/** What the dismissed row said, for the corpus. Best-effort per kind. */
async function targetText(tenantId: string, kind: ClientViewKind, targetId: string): Promise<{ title: string | null; eligibility: string | null }> {
  try {
    if (kind === "grant") {
      const { data } = await db.from("eligible_grant").select("reason").eq("tenant_id", tenantId).eq("grant_id", targetId).maybeSingle();
      // The cache keeps the verdict reason, not the raw text; the id usually carries the title.
      return { title: targetId.slice(0, 300), eligibility: (data as { reason: string | null } | null)?.reason ?? null };
    }
    if (kind === "funder") {
      const { data } = await db.from("matched_funder").select("name, match_reason").eq("tenant_id", tenantId).eq("funder_id", targetId).maybeSingle();
      const r = data as { name: string; match_reason: string | null } | null;
      return { title: r?.name ?? null, eligibility: r?.match_reason ?? null };
    }
    // tenant-safe: discovered_lead row fetched by its own id, then checked against the tenant below.
    const { data } = await db.from("discovered_lead").select("tenant_id, title, eligibility").eq("id", targetId).maybeSingle();
    const r = data as { tenant_id: string; title: string | null; eligibility: string | null } | null;
    if (!r || r.tenant_id !== tenantId) return { title: null, eligibility: null };
    return { title: r.title, eligibility: r.eligibility };
  } catch { return { title: null, eligibility: null }; }
}

export async function learnFromNotForUs(a: {
  tenantId: string; userId: string; userName: string | null;
  kind: ClientViewKind; targetId: string; reason: string | null; note: string | null;
}): Promise<void> {
  try {
    if (!a.reason) return;
    const text = await targetText(a.tenantId, a.kind, a.targetId);

    if (MISS_REASONS.has(a.reason)) {
      const profile = await getEligibilityProfile(a.tenantId).catch(() => null);
      await db.from("screen_miss").insert({
        tenant_id: a.tenantId, kind: a.kind, target_id: a.targetId.slice(0, 400),
        title: text.title, reason: a.reason, note: a.note,
        eligibility_text: text.eligibility, profile: profile ?? null,
      });
    }

    if (INBOX_REASONS.has(a.reason)) {
      const { data: t } = await db.from("tenant").select("name").eq("id", a.tenantId).maybeSingle();
      const what = a.reason === "wrong_place"
        ? `reported a location miss: "${text.title ?? a.targetId}" is not where they work.${a.note ? ` They added: "${a.note}"` : ""} The screen should have caught this; the miss is logged for rule tuning.`
        : `reported an eligibility miss: not eligible for "${text.title ?? a.targetId}".${a.note ? ` They added: "${a.note}"` : ""} Logged for rule tuning.`;
      await notifyClientRequest({
        org: (t as { name: string } | null)?.name ?? "A client",
        requester: a.userName ?? "A portal user", what, tenantId: a.tenantId,
        inbox: { kind: "eligibility_miss", sourceKey: `miss:${a.kind}:${a.targetId.slice(0, 200)}` },
      });
    }

    if (a.reason === "already_known" && a.kind === "funder" && text.title) {
      // Join the known-funder list the setup collected, so discovery stops
      // re-presenting a relationship as a find. "known" is the honest default.
      const { data: setup } = await db.from("tenant_setup").select("answers").eq("tenant_id", a.tenantId).maybeSingle();
      const answers = ((setup as { answers: Record<string, unknown> } | null)?.answers ?? {}) as { known_funders?: { name: string; relationship: string }[] };
      const list = Array.isArray(answers.known_funders) ? answers.known_funders : [];
      if (!list.some(k => k.name.toLowerCase() === text.title!.toLowerCase())) {
        await db.from("tenant_setup").update({
          answers: { ...answers, known_funders: [...list, { name: text.title, relationship: "known" }] },
        }).eq("tenant_id", a.tenantId);
      }
    }
  } catch (e) {
    console.error("[screen-miss] learning skipped", e instanceof Error ? e.message : e);
  }
}
