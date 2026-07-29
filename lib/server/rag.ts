import "server-only";
// Retrieval-Augmented Generation, tenant-isolated by construction.
// Retrieval runs through userClient (RLS scopes to the caller's tenant), and
// generation runs on Bedrock in For Granted's own account.
//
// SCAFFOLD BEHAVIOUR (Bedrock account activation pending):
//  - retrieve(): tries semantic (query embedding + match_chunks). If embeddings
//    are unavailable (Bedrock blocked, or no embeddings yet), falls back to
//    lexical retrieval (search_inventory / Phase 5). So chat retrieval works
//    TODAY; it upgrades to hybrid the moment Bedrock is live.
//  - generate(): calls Bedrock Converse. On ANY Bedrock failure it returns an
//    honest extractive answer built from the retrieved passages. When Bedrock
//    is live, it returns a grounded, generated answer. Both carry citations.
import {
  BedrockRuntimeClient, InvokeModelCommand, ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { userClient } from "./supabase";

const REGION = process.env.PORTAL_AWS_REGION ?? "us-east-1";
const EMBED_MODEL = process.env.BEDROCK_EMBED_MODEL_ID ?? "amazon.titan-embed-text-v2:0";
const CHAT_MODEL = process.env.BEDROCK_CHAT_MODEL_ID ?? ""; // set after model eval; empty => extractive

function bedrock() {
  return new BedrockRuntimeClient({
    region: REGION,
    credentials: {
      accessKeyId: process.env.PORTAL_AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.PORTAL_AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export interface Passage {
  document_id: string; title: string; text: string; page_number: number | null; score: number;
}

async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const res = await bedrock().send(new InvokeModelCommand({
      modelId: EMBED_MODEL, contentType: "application/json",
      body: JSON.stringify({ inputText: text.slice(0, 8000) }),
    }));
    return JSON.parse(new TextDecoder().decode(res.body)).embedding as number[];
  } catch { return null; } // Bedrock blocked -> caller falls back to lexical
}

export async function retrieve(query: string, k = 6): Promise<{ passages: Passage[]; mode: "hybrid" | "lexical" }> {
  const supabase = await userClient();
  const vector = await embedQuery(query);

  if (vector) {
    const { data } = await supabase.rpc("match_chunks", { p_query_embedding: JSON.stringify(vector), p_match_count: k });
    const semantic: Passage[] = (data ?? []).map((r: { document_id: string; title: string; text: string; page_number: number | null; similarity: number }) =>
      ({ document_id: r.document_id, title: r.title, text: r.text, page_number: r.page_number, score: r.similarity }));
    // hybrid: fold in lexical hits the vector search may have missed
    const { data: lex } = await supabase.rpc("match_lexical", { p_query: query, p_count: 4 });
    const seen = new Set(semantic.map(p => p.document_id));
    const lexical: Passage[] = (lex ?? []).filter((r: { document_id: string }) => !seen.has(r.document_id))
      .slice(0, 3).map((r: { document_id: string; title: string; text: string; page_number: number | null; rank: number }) =>
        ({ document_id: r.document_id, title: r.title, text: r.text, page_number: r.page_number, score: r.rank }));
    return { passages: [...semantic, ...lexical].slice(0, k), mode: "hybrid" };
  }

  // Lexical-only fallback (today): recall-oriented match_lexical
  const { data: lex } = await supabase.rpc("match_lexical", { p_query: query, p_count: k });
  const passages: Passage[] = (lex ?? []).map((r: { document_id: string; title: string; text: string; page_number: number | null; rank: number }) =>
    ({ document_id: r.document_id, title: r.title, text: r.text, page_number: r.page_number, score: r.rank }));
  return { passages, mode: "lexical" };
}

const SYSTEM = `You are the Inven(s)tory assistant for a nonprofit/organization served by For Granted.
Answer ONLY from the provided document passages. If they do not contain the answer, say so plainly and do not invent anything.
Be concise and specific. Do not mention "passages" or "context"; speak naturally about the organization's own materials.`;

function buildContext(passages: Passage[]): string {
  return passages.map((p, i) => `[${i + 1}] From "${p.title}"${p.page_number ? ` (p.${p.page_number})` : ""}:\n${p.text}`).join("\n\n");
}

export interface Answer { content: string; citations: string[]; generated: boolean; mode: string }

export async function generate(question: string, passages: Passage[]): Promise<Answer> {
  const citations = [...new Set(passages.map(p => p.document_id))];
  if (passages.length === 0) {
    return { content: "I couldn't find anything in your documents that speaks to that. Try rephrasing, or it may be something worth adding to your Inven(s)tory.", citations: [], generated: false, mode: "none" };
  }
  if (CHAT_MODEL) {
    try {
      const res = await bedrock().send(new ConverseCommand({
        modelId: CHAT_MODEL,
        system: [{ text: SYSTEM }],
        messages: [{ role: "user", content: [{ text: `Question: ${question}\n\nDocument passages:\n${buildContext(passages)}` }] }],
        inferenceConfig: { maxTokens: 600, temperature: 0.2 },
      }));
      const text = res.output?.message?.content?.map(c => c.text).filter(Boolean).join("") ?? "";
      if (text) return { content: text, citations, generated: true, mode: "bedrock" };
    } catch { /* fall through to extractive */ }
  }
  // Honest extractive fallback while Bedrock generation is being provisioned.
  const top = passages.slice(0, 3);
  const body = top.map(p => `• ${p.text}${p.page_number ? ` (p.${p.page_number} of "${p.title}")` : ` — "${p.title}"`}`).join("\n\n");
  return {
    content: `Here are the most relevant passages from your own documents:\n\n${body}`,
    citations, generated: false, mode: "extractive",
  };
}
