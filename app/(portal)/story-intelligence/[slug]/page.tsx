import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getArtifactBundles, getDocumentsWithTags, getTenant } from "@/lib/server/data";
import SIView from "@/components/SIView";

export default async function StoryIntelligencePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) redirect("/");
  const [tenant, bundles, docs] = await Promise.all([
    getTenant(session.tenantId),
    getArtifactBundles(session.tenantId),
    getDocumentsWithTags(session.tenantId),
  ]);
  const bundle = bundles.find(b => b.type.slug === slug);
  if (!tenant || !bundle) return <div className="empty">This Story Intelligence page doesn&rsquo;t exist.</div>;
  if (session.role !== "admin" && !bundle.set.client_visible) return <div className="empty">This Story Intelligence view isn&rsquo;t available.</div>;
  return <SIView tenantName={tenant.name} bundle={bundle} docs={docs} isAdmin={session.role === "admin"} />;
}
