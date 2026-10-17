// The Document Reader (Phase 1): one document's full text, with search, its
// Story Card highlights and the card panel. Open to every client for its own
// documents; what each client sees beyond the text and search is set per
// client (lib/reader-features.ts) and enforced in getReaderData, on the server.
//
// Deep links: ?card=<card id> opens at that card's passage, ?item=<checklist
// key> at the passage a readiness item used from this document.
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { getReaderData } from "@/lib/server/reader";
import DocumentReader from "@/components/DocumentReader";
import SwitchToClient from "@/components/SwitchToClient";

export default async function DocumentReaderPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ card?: string; item?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  const [{ id }, { card, item }] = await Promise.all([params, searchParams]);
  const r = await getReaderData(session, id, { card: card ?? null, item: item ?? null });
  if (r.kind === "missing") return <div className="empty">This document doesn&rsquo;t exist, or it isn&rsquo;t one of yours.</div>;
  if (r.kind === "not_ready") {
    return <div className="empty">&ldquo;{r.title}&rdquo; {r.status === "failed" ? "could not be read, so there is no text to show. Open it from the Inven(s)tory to see why." : "is still being read. Its text will be here in a minute or two."}</div>;
  }
  if (r.kind === "other_client") return <SwitchToClient tenantId={r.tenantId} tenantName={r.tenantName} />;
  return <DocumentReader data={r.data} key={`${id}|${card ?? ""}|${item ?? ""}`} />;
}
