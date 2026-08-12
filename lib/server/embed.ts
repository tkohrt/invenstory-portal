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

// Batch embeddings: one edge call for many texts. Returns aligned vectors (null
// per empty input). Used for sentence-level ranking in extractive refinement.
export async function embedTexts(texts: string[]): Promise<(number[] | null)[] | null> {
  if (!texts.length) return null;
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
