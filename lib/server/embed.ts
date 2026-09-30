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

/**
 * Batch embeddings, several sub-batches in flight at once.
 *
 * Aligned to input order; an item is null when its sub-batch failed, so one bad
 * batch costs eight chunks their vectors rather than the whole document. Built
 * for ingestion: a 127-chunk transcript embedded one chunk at a time took the
 * whole 60-second function budget on 30 September 2026 (Hope Town's onsite-week
 * transcript) and the upload died with a 504.
 */
export async function embedTextsParallel(texts: string[], width = 4): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = new Array(texts.length).fill(null);
  const starts: number[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) starts.push(i);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, starts.length) }, async () => {
    for (let k = next++; k < starts.length; k = next++) {
      const i = starts[k];
      const part = await embedBatchOnce(texts.slice(i, i + EMBED_BATCH));
      if (part) part.forEach((v, j) => { out[i + j] = Array.isArray(v) ? v : null; });
    }
  }));
  return out;
}
