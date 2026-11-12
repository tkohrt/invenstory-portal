// Text embeddings via Supabase's built-in gte-small model (384-dim), running
// inside the Edge runtime — no external AI provider, no AWS/Bedrock dependency.
// Protected by a shared secret so only the For Granted portal can call it.
// Accepts either { text } (single -> { embedding }) or { texts: string[] }
// (batch -> { embeddings }). Batch powers sentence-level extractive refinement.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SECRET = Deno.env.get("EMBED_FN_SECRET");
// @ts-expect-error Supabase global is provided by the Edge runtime
const model = new Supabase.ai.Session("gte-small");
const run = (t: string) => model.run(t.slice(0, 8000), { mean_pool: true, normalize: true });
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

// Constant-time comparison (red-team L2): equality that does not leak where
// the first wrong byte sits. Lengths may differ; that alone is not a secret.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a); const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  // Fail closed (red-team L2): without the secret configured, this function
  // refuses to serve rather than serving everyone. Set EMBED_FN_SECRET as an
  // edge-function secret before deploying this version.
  if (!SECRET) return json({ error: "EMBED_FN_SECRET is not configured; refusing to serve." }, 503);
  if (!safeEqual(req.headers.get("x-embed-secret") ?? "", SECRET)) return json({ error: "unauthorized" }, 401);
  let body: { text?: unknown; texts?: unknown } = {};
  try { body = await req.json(); } catch { /* bad body */ }

  if (Array.isArray(body.texts)) {
    const texts = body.texts.map((t) => String(t ?? ""));
    const embeddings: (number[] | null)[] = [];
    for (const t of texts) embeddings.push(t.trim() ? await run(t) : null);
    return json({ embeddings });
  }

  const text = String(body.text ?? "");
  if (!text.trim()) return json({ error: "text required" }, 400);
  return json({ embedding: await run(text) });
});
