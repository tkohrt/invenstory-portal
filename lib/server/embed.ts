import "server-only";
// Embeddings via Supabase's built-in gte-small model (Edge Function) — 384-dim,
// no external AI provider, no Bedrock/AWS dependency. Returns null on failure so
// callers degrade gracefully (ingestion stays text-searchable; retrieval falls
// back to lexical).
const EMBED_URL = process.env.SUPABASE_EMBED_URL
  ?? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/embed`;
const EMBED_SECRET = process.env.EMBED_FN_SECRET;

export async function embedText(text: string): Promise<number[] | null> {
  if (!text?.trim()) return null;
  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(EMBED_SECRET ? { "x-embed-secret": EMBED_SECRET } : {}) },
      body: JSON.stringify({ text: text.slice(0, 8000) }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body.embedding) ? body.embedding as number[] : null;
  } catch { return null; }
}

// Batch embeddings, aligned to input order (null per empty/failed item). The
// gte-small edge function hits a per-invocation compute limit past ~10 inputs,
// so we split into small sub-batches — each a separate invocation with its own
// budget — and concatenate. Returns null only if a whole sub-batch fails.
const EMBED_BATCH = 8;
async function embedBatchOnce(texts: string[]): Promise<(number[] | null)[] | null> {
  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(EMBED_SECRET ? { "x-embed-secret": EMBED_SECRET } : {}) },
      body: JSON.stringify({ texts: texts.map(t => (t ?? "").slice(0, 8000)) }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body.embeddings) ? body.embeddings as (number[] | null)[] : null;
  } catch { return null; }
}
export async function embedTexts(texts: string[]): Promise<(number[] | null)[] | null> {
  if (!texts.length) return null;
  const out: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const part = await embedBatchOnce(texts.slice(i, i + EMBED_BATCH));
    if (!part) return null;
    out.push(...part);
  }
  return out.length === texts.length ? out : null;
}
