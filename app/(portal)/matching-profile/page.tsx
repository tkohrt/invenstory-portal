// Your matching profile (patch 34; design decided 10 Nov): the one profile
// behind both Funding searches, shown fact by fact with the quote behind each,
// which search each facet feeds, and two verbs: confirm, or flag for For
// Granted. Facet CLAUSES and quotes from the client's own documents are shown;
// the exact query text built from them stays server-side, as everywhere.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getTenant, getWorkspaceVisibility } from "@/lib/server/data";
import { getSearchProfile } from "@/lib/server/search-profile-read";
import { getFactReviews } from "@/lib/server/profile-review";
import { closedInBrain } from "@/lib/server/brain";
import { factId, FACETS, FACET_LABEL, GRANT_FACETS, FUNDER_FACETS } from "@/lib/search-profile";
import MatchingProfileView, { type ProfileFactRow } from "@/components/MatchingProfileView";

export default async function MatchingProfilePage() {
  const session = await getSession();
  if (!session) redirect("/");
  await closedInBrain(session.tenantId);
  const [tenant, profile, reviews, vis] = await Promise.all([
    getTenant(session.tenantId),
    getSearchProfile(session.tenantId).catch(() => null),
    getFactReviews(session.tenantId),
    getWorkspaceVisibility(session.tenantId).catch(() => ({} as Record<string, boolean>)),
  ]);
  if (!tenant) redirect("/");
  const admin = session.role === "admin";
  // The page exists wherever either Funding mode does.
  if (!admin && vis.funder_matches !== true && vis.funder_compass !== true) redirect("/invenstory");

  // Only facts about the organization itself: competitor and third-party
  // lines are quarantined by design and would read as errors here.
  const rows: ProfileFactRow[] = (profile?.facts ?? [])
    .filter(f => f.subject === "organization")
    .map(f => {
      const id = f.documentId ? factId(f) : null; // an added line has no stable id
      const r = id ? reviews.get(id) : undefined;
      return {
        id, facet: f.facet, facetLabel: FACET_LABEL[f.facet],
        text: f.text, quote: f.quote || null,
        documentTitle: f.documentTitle || null, layer: f.layer,
        feeds: {
          grants: (GRANT_FACETS as readonly string[]).includes(f.facet),
          funders: (FUNDER_FACETS as readonly string[]).includes(f.facet),
        },
        review: r ? { state: r.state, note: r.note, at: r.at } : null,
      };
    });

  return (
    <MatchingProfileView
      orgName={tenant.name}
      isAdmin={admin}
      rows={rows}
      facetOrder={[...FACETS]}
      generatedAt={profile?.generatedAt ?? null}
      documentCount={profile?.documentCount ?? 0}
      stale={profile?.stale ?? false}
    />
  );
}
