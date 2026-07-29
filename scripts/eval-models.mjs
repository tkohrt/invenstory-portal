// Model eval harness — run once Bedrock is live to pick the chat model.
// Sends the same grounded Q&A to each candidate via Converse and prints the
// answer + token usage (cost proxy). Set the winner as BEDROCK_CHAT_MODEL_ID.
// Usage: PORTAL_AWS_ACCESS_KEY_ID=... PORTAL_AWS_SECRET_ACCESS_KEY=... node scripts/eval-models.mjs
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
const c = new BedrockRuntimeClient({ region: process.env.PORTAL_AWS_REGION ?? "us-east-1",
  credentials: { accessKeyId: process.env.PORTAL_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.PORTAL_AWS_SECRET_ACCESS_KEY } });

// Candidate model IDs — confirm exact IDs against `aws bedrock list-foundation-models` at run time.
const CANDIDATES = (process.env.EVAL_MODELS ?? "amazon.nova-lite-v1:0,amazon.nova-micro-v1:0,anthropic.claude-3-5-haiku-20241022-v1:0").split(",");
const CONTEXT = `[1] From "Strategic Plan 2025-2027": expand Uplift rides by 40%, open a second recovery residence, and diversify funding beyond opioid settlement dollars.
[2] From "Interview - Lili Reitz": she founded the organization after seeing clients miss treatment appointments because they had no way to get there.`;
const Q = "What is the founding story and the main strategic goal?";

for (const modelId of CANDIDATES) {
  try {
    const t0 = Date.now();
    const r = await c.send(new ConverseCommand({ modelId,
      system: [{ text: "Answer only from the passages. Be concise. Cite by title." }],
      messages: [{ role: "user", content: [{ text: `Question: ${Q}\n\nPassages:\n${CONTEXT}` }] }],
      inferenceConfig: { maxTokens: 300, temperature: 0.2 } }));
    const text = r.output?.message?.content?.map(x => x.text).join("") ?? "";
    console.log(`\n=== ${modelId}  (${Date.now()-t0}ms, in ${r.usage?.inputTokens} / out ${r.usage?.outputTokens} tokens)`);
    console.log(text);
  } catch (e) { console.log(`\n=== ${modelId}: ERROR ${e.name} ${e.message}`); }
}
