import { NextResponse } from "next/server";
import JSZip from "jszip";
import { getSession } from "@/lib/server/session";
import { userClient } from "@/lib/server/supabase";
import { db } from "@/lib/server/db";

export const maxDuration = 60;

// Export the signed-in client's entire Inven(s)tory as a .zip: original files
// grouped by layer, plus a manifest. Reinforces "you own your Inven(s)tory".
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supabase = await userClient();
  const { data: tenant } = await supabase.from("tenant").select("name").eq("id", session.tenantId).single();
  const { data: docs } = await supabase
    .from("document")
    .select("id, title, layer, doc_kind, storage_key, snippet, source, created_at, document_tag(tag)")
    .eq("tenant_id", session.tenantId)
    .order("layer");

  const zip = new JSZip();
  const layerName: Record<string, string> = { I: "Layer I - Public Story", II: "Layer II - Internal Strategy", III: "Layer III - Living Voice" };
  const manifest: string[] = [
    `INVEN(S)TORY EXPORT — ${tenant?.name ?? "Client"}`,
    `Exported: ${new Date().toISOString()}`,
    `Documents: ${(docs ?? []).length}`, "", "CONTENTS", "========",
  ];

  for (const d of (docs ?? [])) {
    const folder = layerName[d.layer] ?? "Other";
    const safe = String(d.title).replace(/[^\w.\- ]+/g, "_").slice(0, 90);
    const tags = ((d.document_tag as { tag: string }[]) ?? []).map(t => t.tag).join(", ");
    manifest.push(`- [${d.layer}] ${d.title}  (${d.doc_kind}, added ${new Date(d.created_at).toLocaleDateString()}${tags ? `, tags: ${tags}` : ""}, ${d.source === "for_granted" ? "added by For Granted" : "added by you"})`);
    const { data: blob } = await db.storage.from("documents").download(d.storage_key);
    if (blob) {
      const ext = (d.storage_key.split(".").pop() && d.doc_kind === "pdf") ? "pdf" : (d.doc_kind === "docx" ? "docx" : "txt");
      zip.folder(folder)!.file(`${safe}.${ext}`, Buffer.from(await blob.arrayBuffer()));
    } else {
      zip.folder(folder)!.file(`${safe} (preview).txt`, `${d.title}\n\n${d.snippet ?? ""}`);
    }
  }
  zip.file("MANIFEST.txt", manifest.join("\n"));
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  await db.from("audit_log").insert({ actor_user_id: session.user.id, tenant_id: session.tenantId, action: "export_inventory", detail: `${(docs ?? []).length} docs` });
  const fname = `Inventory-${(tenant?.name ?? "export").replace(/[^\w]+/g, "-")}.zip`;
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${fname}"` } });
}
