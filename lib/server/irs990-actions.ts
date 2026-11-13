"use server";
// The 990 importer (patch 42): the funder-side pull and the client-side
// import. Decided 13 Nov: funder numbers write DIRECT to the shared profile
// (mechanical figures from the funder's own sworn filing, stamped import_990
// with the filing source); the client side files an ordinary Layer I document
// and suggests a budget band the client must confirm, never silently saved.
import { getSession } from "./session";
import { db } from "./db";
import { fetch990 } from "./irs990";
import { cleanEin, funderProfileFrom, summaryDocText, budgetBandFrom } from "@/lib/irs990";
import { applyProfileFields } from "./funder-profile";
import { getEligibilityProfile } from "./eligibility";
import { saveEligibilityProfileAction } from "./eligibility-actions";
import { BUDGET_BANDS } from "@/lib/eligibility-fields";
import { processDocument } from "./ingest";
import { markStaleOnUpload } from "./artifacts";
import { revalidatePath } from "next/cache";

export type Pull990Result =
  | { ok: true; year: number; changed: string[] }
  | { ok: false; status: "none" | "error" | "denied"; error: string };

/** Funder side: fill the shared profile from the funder's latest filing. */
export async function pullFunder990Action(funderId: string, einRaw: string): Promise<Pull990Result> {
  const s = await getSession();
  if (!s || s.role !== "admin") return { ok: false, status: "denied", error: "For Granted only." };
  const ein = cleanEin(einRaw);
  if (!ein) return { ok: false, status: "error", error: "That EIN does not look right (nine digits)." };
  const r = await fetch990(ein);
  if (r.status === "none") return { ok: false, status: "none", error: "No IRS e-filings on record for that EIN." };
  if (r.status === "error") return { ok: false, status: "error", error: "The filings service could not be reached. Try again in a minute." };
  const latest = r.org.filings[0];
  if (!latest) return { ok: false, status: "none", error: r.org.postcard_only ? "This organization files the 990-N e-postcard; no public financials." : "No filings with figures on record." };
  const changed = await applyProfileFields({
    ein, funderId, incoming: funderProfileFrom(r.org),
    prov: { how: "import_990", source_url: latest.pdf_url ?? r.org.source_url, at: new Date().toISOString() },
  });
  return { ok: true, year: latest.year, changed };
}

export type Import990Result =
  | { ok: true; title: string; year: number | null; postcardOnly: boolean; suggestion: { band: string; label: string; revenue: number; year: number } | null }
  | { ok: false; status: "none" | "error" | "denied"; error: string };

/** Client side: file the filings summary into Layer I and suggest a budget band. */
export async function importClient990Action(einRaw: string): Promise<Import990Result> {
  const s = await getSession();
  if (!s) return { ok: false, status: "denied", error: "You are signed out. Sign in and try again." };
  const ein = cleanEin(einRaw);
  if (!ein) return { ok: false, status: "error", error: "An EIN is nine digits, like 34-1234567." };
  // Remember it either way: the readiness prompt and future pulls read it here.
  await db.from("tenant").update({ ein }).eq("id", s.tenantId);
  const r = await fetch990(ein);
  if (r.status === "none") return { ok: false, status: "none", error: "No IRS e-filings on record for that EIN." };
  if (r.status === "error") return { ok: false, status: "error", error: "The filings service could not be reached. Try again in a minute." };

  // One summary document per tenant: re-imports replace rather than pile up.
  const { data: prior } = await db.from("document_tag").select("document_id")
    .eq("tenant_id", s.tenantId).eq("tag", "irs-filings").limit(1).maybeSingle();
  const docId = (prior as { document_id: string } | null)?.document_id ?? crypto.randomUUID();
  const content = summaryDocText(r.org, ein);
  const storageKey = `${s.tenantId}/${docId}/1`;
  const title = `IRS filings summary: ${r.org.name}`;
  const up = await db.storage.from("documents").upload(storageKey, Buffer.from(content, "utf8"), { contentType: "text/plain", upsert: true });
  if (up.error) return { ok: false, status: "error", error: "The filings were found but could not be stored. Try again." };
  if (!prior) {
    const { error } = await db.from("document").insert({
      id: docId, tenant_id: s.tenantId, title, layer: "I",
      storage_key: storageKey, mime_type: "text/plain", doc_kind: "web", status: "pending",
      type_tag: "irs_990",
      uploaded_by: s.user.id, source: s.role === "admin" ? "for_granted" : "client",
    });
    if (error) return { ok: false, status: "error", error: "The filings were found but could not be filed. Try again." };
    await db.from("document_version").insert({ document_id: docId, tenant_id: s.tenantId, version: 1, storage_key: storageKey, uploaded_by: s.user.id });
    await db.from("document_tag").insert([{ document_id: docId, tenant_id: s.tenantId, tag: "irs-filings" }]);
  } else {
    await db.from("document").update({ title, status: "pending" }).eq("id", docId).eq("tenant_id", s.tenantId);
  }
  try { await processDocument(docId, { actor: s.role }); } catch { /* status recorded on the document */ }
  await markStaleOnUpload(s.tenantId).catch(() => { /* best-effort */ });
  revalidatePath("/invenstory"); revalidatePath("/readiness");

  // The confirm-first budget hint: suggested only when the band is unset and
  // the latest filing states revenue. Saving happens in applyBudgetBandAction,
  // only when the person says so.
  const latest = r.org.filings[0] ?? null;
  let sug: { band: string; label: string; revenue: number; year: number } | null = null;
  if (latest?.revenue) {
    const p = await getEligibilityProfile(s.tenantId).catch(() => null);
    if (p && !p.budget_band) {
      const b = budgetBandFrom(latest.revenue);
      if (b) sug = { ...b, revenue: latest.revenue, year: latest.year };
    }
  }
  return { ok: true, title, year: latest?.year ?? null, postcardOnly: r.org.postcard_only, suggestion: sug };
}

/** The confirm: set the budget band the person accepted. */
export async function applyBudgetBandAction(band: string): Promise<{ ok: boolean }> {
  const s = await getSession();
  if (!s) return { ok: false };
  if (!BUDGET_BANDS.some(b => b.v === band)) return { ok: false };
  await saveEligibilityProfileAction({ budget_band: band });
  return { ok: true };
}
