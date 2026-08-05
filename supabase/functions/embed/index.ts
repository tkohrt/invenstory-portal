// Text embeddings via Supabase's built-in gte-small model (384-dim), running
// inside the Edge runtime — no external AI provider, no AWS/Bedrock dependency.
// Protected by a shared secret so only the For Granted portal can call it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SECRET = Deno.env.get("EMBED_FN_SECRET");
// @ts-expect-error Supabase global is provided by the Edge runtime
const model = new Supabase.ai.Session("gte-small");

Deno.serve(async (req) => {
  if (SECRET && req.headers.get("x-embed-secret") !== SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  let text = "";
  try { text = String((await req.json()).text ?? ""); } catch { /* bad body */ }
  if (!text.trim()) return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: { "content-type": "application/json" } });
  const embedding = await model.run(text.slice(0, 8000), { mean_pool: true, normalize: true });
  return new Response(JSON.stringify({ embedding }), { headers: { "content-type": "application/json" } });
});
