import "server-only";
// The artifact engine: one generic pipeline for EVERY Story Intelligence type.
// generate -> validate(zod) -> resolve citations -> write pending set -> Slack.
// Synthesis is Bedrock-armed; while Bedrock is blocked it uses the type's
// grounded fallback (real corpus evidence, marked model_used='scaffold') so
// the whole review lifecycle is exercisable today and upgrades on unblock.
import { ConverseCommand, BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { db } from "./db";
import { SI_TYPES, validateCards, type CorpusDoc } from "./si-registry";

const CHAT_MODEL = process.env.BEDROCK_CHAT_MODEL_ID ?? "";

async function loadCorpus(tenantId: string): Promise<CorpusDoc[]> {
  // System operation (like ingestion): service client, explicit tenant scope.
  const { data: docs } = await db.from("document")
    .select("id, title, layer, snippet, status, document_tag(tag), document_chunk(text)")
    .eq("tenant_id", tenantId).eq("status", "ready");
  return (docs ?? []).map((d: Record<string, unknown>) => ({
    id: d.id as string, title: d.title as string, layer: d.layer as string,
    snippet: (d.snippet as string) ?? "",
    tags: ((d.document_tag as { tag: string }[]) ?? []).map(t => t.tag),
    chunks: ((d.document_chunk as { text: string }[]) ?? []).slice(0, 4).map(c => c.text),
  }));
}

async function synthesize(slug: string, docs: CorpusDoc[]): Promise<{ cards: ReturnType<typeof validateCards>; model: string }> {
  const type = SI_TYPES[slug];
  if (CHAT_MODEL) {
    try {
      const bedrock = new BedrockRuntimeClient({ region: process.env.PORTAL_AWS_REGION ?? "us-east-1",
        credentials: { accessKeyId: process.env.PORTAL_AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.PORTAL_AWS_SECRET_ACCESS_KEY! } });
      const res = await bedrock.send(new ConverseCommand({
        modelId: CHAT_MODEL,
        system: [{ text: type.system + " Respond with ONLY the JSON array, no prose." }],
        messages: [{ role: "user", content: [{ text: type.buildPrompt(docs) }] }],
        inferenceConfig: { maxTokens: 1500, temperature: 0.3 },
      }));
      const text = res.output?.message?.content?.map(c => c.text).join("") ?? "";
      const json = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
      // normalize {title, ...fields, citation_titles} -> {title, payload, citation_titles}
      const shaped = json.map((c: Record<string, unknown>) => {
        const { title, citation_titles, ...payload } = c;
        return { title, payload, citation_titles };
      });
      return { cards: validateCards(slug, shaped), model: CHAT_MODEL };
    } catch { /* fall through to grounded fallback */ }
  }
  return { cards: validateCards(slug, type.fallback(docs)), model: "scaffold" };
}

export async function generateArtifact(tenantId: string, slug: string): Promise<{ setId: string; cardCount: number; model: string }> {
  const type = SI_TYPES[slug];
  if (!type) throw new Error(`unknown type ${slug}`);
  const docs = await loadCorpus(tenantId);
  const { cards, model } = await synthesize(slug, docs);

  // Resolve citation titles -> document ids (tenant-scoped).
  const { data: tdocs } = await db.from("document").select("id, title").eq("tenant_id", tenantId);
  const titleToId = new Map((tdocs ?? []).map(d => [d.title, d.id]));

  const { data: set } = await db.from("artifact_set")
    .upsert({ tenant_id: tenantId, type_slug: slug, status: "pending", generated_at: new Date().toISOString(),
      reviewed_by: null, model_used: model, gap_note: type.gapNote(docs) }, { onConflict: "tenant_id,type_slug" })
    .select("id, version").single();
  if (!set) throw new Error("set upsert failed");
  await db.from("artifact_set").update({ version: (set.version ?? 0) + 1 }).eq("id", set.id);
  await db.from("artifact_card").delete().eq("set_id", set.id);

  const rows = cards.map((c, i) => ({
    set_id: set.id, tenant_id: tenantId, title: c.title, payload: c.payload,
    citations: c.citation_titles.map(t => titleToId.get(t)).filter(Boolean) as string[],
    sort_order: i + 1,
  }));
  await db.from("artifact_card").insert(rows);
  await db.from("audit_log").insert({ tenant_id: tenantId, action: "si_generate", detail: `${slug} model=${model} cards=${rows.length}` });
  await postToSlack(tenantId, slug, rows.length, model);
  return { setId: set.id, cardCount: rows.length, model };
}

async function postToSlack(tenantId: string, slug: string, cardCount: number, model: string) {
  const { data: t } = await db.from("tenant").select("name, slack_channel_id, slack_webhook_url").eq("id", tenantId).single();
  if (!t?.slack_webhook_url) return; // no webhook configured -> skip quietly (review queue still shows it)
  const label = SI_TYPES[slug]?.slug ?? slug;
  const text = `:sparkles: *Story Intelligence draft ready for review* — ${t.name}\n*${label}* · ${cardCount} cards${model === "scaffold" ? " (scaffold draft, pending AI synthesis)" : ` · ${model}`}\nReview in the portal → Story Intelligence reviews.`;
  try {
    await fetch(t.slack_webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    await db.from("audit_log").insert({ tenant_id: tenantId, action: "si_slack_post", detail: `${slug} -> ${t.slack_channel_id ?? "webhook"}` });
  } catch { /* Slack failure never blocks generation */ }
}

export async function markStaleOnUpload(tenantId: string) {
  // Any approved SI set for this tenant becomes stale when documents change.
  await db.from("artifact_set").update({ status: "stale" }).eq("tenant_id", tenantId).eq("status", "approved");
}
