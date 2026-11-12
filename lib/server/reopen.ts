import "server-only";
import { db } from "./db";

/** One open candidate as the reopen check sees it, whatever found it. */
export interface OpenCandidate {
  grant_id: string;
  title: string | null;
  close_date: string | null;
  website: string | null;
  award_ceiling: number | null;
}

/**
 * The reopen recheck (patch 28, 0083; shared with the weekly cron in patch
 * 30). The saved bucket's promise was "surfaced when those applications are
 * open again"; this is where it is kept. A saved grant counts as reopened only
 * when its saved snapshot's close date has passed (it was a closed call when
 * bucketed, or has since closed) AND something now shows it open, by id or by
 * exact title.
 *
 * unstampMissing decides what absence means, and the two callers mean
 * different things by it. A full match run surveys everything, so a stamped
 * grant it no longer finds open has closed again: unstamp, the news expired.
 * The weekly cron only asks a few targeted questions per saved grant, so not
 * finding one proves nothing: it never unstamps.
 */
export async function applyReopenCheck(
  tenantId: string, openRows: OpenCandidate[], ranAt: string,
  opts: { unstampMissing: boolean },
): Promise<{ stamped: number; unstamped: number }> {
  const norm = (t: string) => t.trim().toLowerCase();
  const openById = new Map(openRows.map(s => [s.grant_id, s]));
  const openByTitle = new Map(openRows.filter(s => s.title).map(s => [norm(s.title!), s]));
  const { data: savedRows } = await db.from("saved_item")
    .select("target_id, title, detail, reopened_at")
    .eq("tenant_id", tenantId).eq("kind", "grant");
  let stamped = 0; let unstamped = 0;
  for (const sv of savedRows ?? []) {
    const d = (sv.detail ?? {}) as { close_date?: string | null };
    const hit = openById.get(sv.target_id) ?? (sv.title ? openByTitle.get(norm(sv.title)) : undefined);
    const savedClosed = !!d.close_date && new Date(d.close_date).getTime() < Date.now();
    if (hit && savedClosed && !sv.reopened_at) {
      const { error } = await db.from("saved_item").update({
        reopened_at: ranAt,
        reopened_detail: {
          grant_id: hit.grant_id, title: hit.title ?? null,
          close_date: hit.close_date ?? null, url: hit.website ?? null,
          award_ceiling: hit.award_ceiling ?? null,
        },
      }).eq("tenant_id", tenantId).eq("kind", "grant").eq("target_id", sv.target_id);
      if (error) console.error("[saved] reopen stamp failed", error); else stamped++;
    } else if (!hit && sv.reopened_at && opts.unstampMissing) {
      const { error } = await db.from("saved_item").update({ reopened_at: null, reopened_detail: {} })
        .eq("tenant_id", tenantId).eq("kind", "grant").eq("target_id", sv.target_id);
      if (error) console.error("[saved] reopen unstamp failed", error); else unstamped++;
    }
  }
  return { stamped, unstamped };
}
