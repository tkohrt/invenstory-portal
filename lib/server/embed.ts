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
 * Batch embeddings, a couple of sub-batches in flight, with retries.
 *
 * Aligned to input order; an item stays null when its batch never succeeded.
 * Built for ingestion: a 127-chunk transcript embedded one chunk at a time took
 * the whole 60-second function budget on 30 September 2026 and the upload died
 * with a 504. The first parallel version ran four batches at once and the
 * embedding function refused most of them (96 of 154 passages left without a
 * vector; its logs show status 546, its per-call resource limit), so this runs
 * two at a time and then retries what failed in smaller batches until
 * everything is embedded or the deadline passes. Whatever is left is finished
 * later by indexMissingEmbeddings.
 */
export async function embedTextsParallel(
  texts: string[], opts: { width?: number; deadline?: number } = {},
): Promise<(number[] | null)[]> {
  const width = opts.width ?? 2;
  const deadline = opts.deadline ?? Date.now() + 35_000;
  const out: (number[] | null)[] = new Array(texts.length).fill(null);
  // Four passages per call on the first pass, half the older batch size: the
  // 546s came on batches of eight.
  const FIRST = 4;
  const starts: number[] = [];
  for (let i = 0; i < texts.length; i += FIRST) starts.push(i);
  const run = async (i: number) => {
    const part = await embedBatchOnce(texts.slice(i, i + FIRST));
    if (part) part.forEach((v, j) => { out[i + j] = Array.isArray(v) ? v : null; });
  };

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, starts.length) }, async () => {
    for (let k = next++; k < starts.length && Date.now() < deadline; k = next++) await run(starts[k]);
  }));

  // Retry what did not come back, in smaller pieces each time. The failures on
  // 30 September were the embedding function's own resource limit (status 546,
  // "worker limit") on batches of eight long transcript passages, so the answer
  // is less work per call, not only fewer calls at once: 2 passages, then 1.
  for (const size of [2, 1, 1]) {
    const missing = texts.map((t, i) => (out[i] === null && (t ?? "").trim() ? i : -1)).filter(i => i >= 0);
    if (!missing.length) break;
    for (let k = 0; k < missing.length; k += size) {
      if (Date.now() >= deadline) return out;
      const idx = missing.slice(k, k + size);
      const part = await embedBatchOnce(idx.map(i => texts[i]));
      if (part) part.forEach((v, j) => { out[idx[j]] = Array.isArray(v) ? v : null; });
      else await new Promise(f => setTimeout(f, 300));
    }
  }
  return out;
}
