"use client";
// Your matching profile (patch 34). Every searched fact, the verbatim quote
// behind it, which search it feeds, and two verbs: Confirm (this is right) or
// Not right (flag it for For Granted, with your words). Deliberately not an
// edit box: a correction is new evidence for the Inven(s)tory, and For Granted
// fixes the source, so the profile can never assert what no document supports.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewFactAction } from "@/lib/server/profile-review-actions";
import { LAYER_META } from "./DocBits";

export interface ProfileFactRow {
  /** Stable fact id; null for a line a person added by hand (no quote to hash). */
  id: string | null;
  /** Removed from the searches by the client (patch 35); undoable. */
  removed: boolean;
  facet: string; facetLabel: string;
  text: string; quote: string | null;
  documentTitle: string | null; layer: "I" | "II" | "III" | null;
  feeds: { grants: boolean; funders: boolean };
  review: { state: "confirmed" | "flagged" | "removed"; note: string | null; at: string } | null;
}

export default function MatchingProfileView({ orgName, isAdmin, rows, facetOrder, generatedAt, documentCount, stale }: {
  orgName: string; isAdmin: boolean; rows: ProfileFactRow[]; facetOrder: string[];
  generatedAt: string | null; documentCount: number; stale: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flagFor, setFlagFor] = useState<string | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  // Optimistic review states, keyed by fact id.
  const [local, setLocal] = useState<Record<string, ProfileFactRow["review"]>>({});
  const reviewOf = (r: ProfileFactRow) => (r.id && r.id in local ? local[r.id] : r.review);

  const act = async (r: ProfileFactRow, state: "confirmed" | "flagged" | "removed" | "clear", note?: string) => {
    if (!r.id) return;
    setBusyId(r.id); setErr(null);
    setLocal(l => ({ ...l, [r.id!]: state === "clear" ? null : { state, note: note ?? null, at: new Date().toISOString() } }));
    const res = await reviewFactAction({ factId: r.id, state, note, factText: r.text }).catch(() => ({ ok: false as const, error: "That did not save. Try again." }));
    if (!res.ok) { setLocal(l => ({ ...l, [r.id!]: r.review })); setErr(res.error); }
    setBusyId(null); setFlagFor(null); setFlagNote("");
    router.refresh();
  };

  const isRemoved = (r: ProfileFactRow) => (r.id && r.id in local ? local[r.id]?.state === "removed" : r.removed);
  const confirmed = rows.filter(r => reviewOf(r)?.state === "confirmed").length;
  const removedCount = rows.filter(r => isRemoved(r)).length;
  const byFacet = new Map<string, ProfileFactRow[]>();
  for (const r of rows) byFacet.set(r.facet, [...(byFacet.get(r.facet) ?? []), r]);

  return (
    <div className="mp-page">
      <div className="page-head">
        <div>
          <h2>Your matching profile</h2>
          <p>What the portal knows about {orgName} when it searches: every fact below comes from your own documents, with the line it came from. One profile feeds both searches; the tags on each section say which.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          No profile yet. It is built from your Inven(s)tory
          {isAdmin ? ": run Rebuild on the Funding page's profile panel." : "; your For Granted team builds it with your first search."}
        </div>
      ) : (
        <>
          <div className="mp-meta">
            <span>Built from {documentCount} document{documentCount === 1 ? "" : "s"}{generatedAt ? ` on ${new Date(generatedAt).toLocaleDateString()}` : ""}.</span>
            <span>{confirmed} of {rows.length} facts confirmed by your team.</span>
            {removedCount > 0 && <span>{removedCount} removed from your searches.</span>}
            {stale && <span className="mp-stale">Documents have changed since this was built; it refreshes with the next search.</span>}
          </div>
          {err && <div className="ov-note">{err}</div>}

          {facetOrder.filter(f => byFacet.has(f)).map(facet => {
            const list = byFacet.get(facet)!;
            const first = list[0];
            return (
              <section key={facet} className="mp-sec" aria-label={first.facetLabel}>
                <div className="mp-sec-head">
                  <h3>{first.facetLabel}</h3>
                  {first.feeds.grants && <span className="mp-feeds mp-feeds-g" title="This section shapes the grant search.">Grant Finder</span>}
                  {first.feeds.funders && <span className="mp-feeds mp-feeds-f" title="This section shapes the funder search.">Funder Compass</span>}
                  {facet === "constraints" && <span className="mp-feeds" title="Checked against each opportunity's rules; never searched on.">Eligibility screen</span>}
                  {facet === "beneficiaries" && <span className="mp-feeds" title="Captured for context; deliberately never used to search, so you are matched as an organization, not mistaken for who you serve.">Captured, not searched</span>}
                </div>
                {list.map((r, i) => {
                  const rv = reviewOf(r);
                  return (
                    <div key={r.id ?? `${facet}-${i}`} className="mp-fact">
                      <div className={`mp-fact-text${isRemoved(r) ? " mp-removed" : ""}`}>{r.text}</div>
                      {r.quote && (
                        <blockquote className="mp-quote">
                          &ldquo;{r.quote}&rdquo;
                          <cite>
                            {r.layer && <span className="layer-dot" style={{ background: LAYER_META[r.layer].color }} />}
                            {r.documentTitle ?? "Unknown document"}{r.layer ? ` · Layer ${r.layer}` : ""}
                          </cite>
                        </blockquote>
                      )}
                      {!r.quote && <div className="mp-byhand">Written in by For Granted rather than read from a document.</div>}
                      {r.id && isRemoved(r) && (
                        <div className="mp-verbs">
                          <span className="mp-removed-note">Removed from your searches. No search or draft will lean on it.</span>
                          <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busyId === r.id}
                            onClick={() => void act(r, "clear")}>Undo</button>
                        </div>
                      )}
                      {r.id && !isRemoved(r) && (
                        <div className="mp-verbs">
                          {rv?.state === "confirmed" ? (
                            <button type="button" className="sb-btn sb-sm mp-confirmed" disabled={busyId === r.id}
                              title="Confirmed. Press again to take the confirmation back."
                              onClick={() => void act(r, "clear")}>&#10003; Confirmed</button>
                          ) : (
                            <button type="button" className="sb-btn sb-secondary sb-sm" disabled={busyId === r.id}
                              title="Stamp this fact as right. Your confirmations tell the search what to lean on."
                              onClick={() => void act(r, "confirmed")}>Confirm</button>
                          )}
                          <button type="button" className="sb-btn sb-quiet sb-sm" disabled={busyId === r.id}
                            title="Take this fact out of your searches. One click, no reason needed, undoable here anytime. For Granted is notified so they can see what changed."
                            onClick={() => void act(r, "removed")}>Remove</button>
                          {rv?.state === "flagged" ? (
                            <span className="mp-flagged" title={rv.note ?? undefined}>
                              Flagged for For Granted{rv.note ? `: ${rv.note}` : ""}
                              <button type="button" className="sb-btn sb-quiet sb-sm" disabled={busyId === r.id}
                                onClick={() => void act(r, "clear")}>Unflag</button>
                            </span>
                          ) : flagFor === r.id ? (
                            <span className="mp-flagbox">
                              <input autoFocus value={flagNote} maxLength={600}
                                placeholder="What reads wrong here?"
                                onChange={e => setFlagNote(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") void act(r, "flagged", flagNote); if (e.key === "Escape") setFlagFor(null); }} />
                              <button type="button" className="sb-btn sb-primary sb-sm" disabled={busyId === r.id}
                                onClick={() => void act(r, "flagged", flagNote)}>Send to For Granted</button>
                              <button type="button" className="sb-btn sb-quiet sb-sm" onClick={() => setFlagFor(null)}>Cancel</button>
                            </span>
                          ) : (
                            <button type="button" className="sb-btn sb-quiet sb-sm"
                              title="Tell For Granted this reads wrong. They fix it at the source, usually a document or a note, so the profile stays backed by evidence."
                              onClick={() => { setFlagFor(r.id); setFlagNote(""); }}>Not right</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
          <p className="mp-foot ov-muted">
            Remove takes a fact out of your searches instantly, no reason needed, and Undo brings it back.
            Rewording goes through For Granted on purpose: every fact here must stay backed by something in your Inven(s)tory,
            so wording fixes happen at the source rather than by typing over the profile.
          </p>
        </>
      )}
    </div>
  );
}
