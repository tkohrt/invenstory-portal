// Data access layer. In Phase 3 these functions become live Supabase queries
// (RLS-scoped). Their signatures and return shapes are the contract — pages
// must not need edits when the implementation swaps.
import {
  tenants, users, documents, documentTags, artifactTypes, artifactSets, artifactCards,
} from "./mock-data";
import type { ArtifactCard, ArtifactSet, ArtifactType, Document, Layer, Tenant, AppUser } from "./types";

export function getTenants(): Tenant[] { return tenants; }
export function getTenant(id: string): Tenant | undefined { return tenants.find(t => t.id === id); }
export function getUserByEmail(email: string): AppUser | undefined { return users.find(u => u.email === email); }
export function getUser(id: string): AppUser | undefined { return users.find(u => u.id === id); }

export function getDocuments(tenantId: string): Document[] {
  return documents.filter(d => d.tenant_id === tenantId);
}
export function getDocument(tenantId: string, id: string): Document | undefined {
  return documents.find(d => d.tenant_id === tenantId && d.id === id);
}
export function getDocumentByTitle(tenantId: string, title: string): Document | undefined {
  return documents.find(d => d.tenant_id === tenantId && d.title === title);
}
export function getTags(tenantId: string, documentId: string): string[] {
  return documentTags.filter(t => t.tenant_id === tenantId && t.document_id === documentId).map(t => t.tag);
}
export function getAllTags(tenantId: string): string[] {
  return [...new Set(documentTags.filter(t => t.tenant_id === tenantId).map(t => t.tag))];
}

export interface SearchHit { document: Document; tags: string[]; snippet: string }
export function searchDocuments(tenantId: string, q: string, tag: string | null): SearchHit[] {
  const query = q.toLowerCase().trim();
  return getDocuments(tenantId)
    .map(d => ({ document: d, tags: getTags(tenantId, d.id), snippet: d.snippet }))
    .filter(({ document: d, tags }) => {
      const text = `${d.title} ${d.snippet} ${tags.join(" ")}`.toLowerCase();
      return (!query || text.includes(query)) && (!tag || tags.includes(tag));
    });
}

export function getArtifactTypes(): ArtifactType[] { return artifactTypes; }
export function getArtifactSet(tenantId: string, slug: string): ArtifactSet | undefined {
  return artifactSets.find(s => s.tenant_id === tenantId && s.type_slug === slug);
}
export function getArtifactCards(setId: string): ArtifactCard[] {
  return artifactCards.filter(c => c.set_id === setId).sort((a, b) => a.sort_order - b.sort_order);
}
export function getPendingReviews(): { set: ArtifactSet; tenant: Tenant; type: ArtifactType; cards: ArtifactCard[] }[] {
  return artifactSets.filter(s => s.status === "pending").map(s => ({
    set: s,
    tenant: getTenant(s.tenant_id)!,
    type: artifactTypes.find(t => t.slug === s.type_slug)!,
    cards: getArtifactCards(s.id),
  }));
}
export function countDocsByLayer(tenantId: string): Record<Layer, number> {
  const n: Record<Layer, number> = { I: 0, II: 0, III: 0 };
  getDocuments(tenantId).forEach(d => { n[d.layer] += 1; });
  return n;
}

// Mock chat. Phase 6 replaces this with tenant-scoped RAG via Bedrock.
export interface ChatAnswer { content: string; citations: string[] }
const CANNED: { q: RegExp; tenant: string; a: string; titles: string[] }[] = [
  { q: /transport|uplift|ride/i, tenant: "Fund The Climb Foundation", a: "Transportation is a core program. Uplift Transportation provides rides to treatment for people in recovery, addressing the barrier of missed appointments. The 2025–2027 strategic plan targets a 40% increase in rides, and there is a dedicated line-item budget for drivers, vehicles, and dispatch.", titles: ["Strategic Plan 2025–2027", "Program budget — Uplift Transportation", "Interview — Lili Reitz, Executive Director"] },
  { q: /found|story|why|start/i, tenant: "Fund The Climb Foundation", a: "The founding story comes through clearly in the leadership interview: Lili Reitz started the organization after watching clients miss treatment appointments solely because they lacked a way to get there. That insight became the Uplift Transportation program.", titles: ["Interview — Lili Reitz, Executive Director", "Website — About & Programs (captured)"] },
  { q: /fund|money|grant|revenue|990|budget/i, tenant: "Fund The Climb Foundation", a: "On funding: the Form 990 (2024) documents revenue and program expenses, and the strategic plan calls out a goal to diversify beyond opioid settlement dollars. A prior ODH SUD application is on file and can be reused as a starting narrative.", titles: ["IRS Form 990 (2024)", "Prior grant application — ODH SUD", "Strategic Plan 2025–2027"] },
  { q: /screen|perinatal|maternal|nurtur/i, tenant: "KHAI Ventures", a: "KHAI's core product is nurtur, a perinatal and maternal mental health screening tool. The seed deck describes the screening workflow, clinical partnerships, and the market context; the founder interview explains why universal screening is the mission.", titles: ["Company website & product pages", "Pitch deck (Seed)", "Interview — Howie Greenman, Founder"] },
];
export function mockChatAnswer(tenantId: string, q: string): ChatAnswer {
  const tenant = getTenant(tenantId);
  const hit = CANNED.find(c => c.tenant === tenant?.name && c.q.test(q));
  if (!hit) {
    return { content: "Your documents don't contain a passage that answers that directly, so I won't guess. Try rephrasing, or browse the Library — and if this is something your Inven(s)tory should cover, that's worth telling the For Granted team.", citations: [] };
  }
  const citations = hit.titles
    .map(t => getDocumentByTitle(tenantId, t)?.id)
    .filter((x): x is string => Boolean(x));
  return { content: hit.a, citations };
}
