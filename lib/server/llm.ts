import "server-only";
// Provider-agnostic text generation. One entry point (chatComplete) that the
// chat, Story Intelligence, Card Library and Storyboarding Tool paths all call. The provider is
// a config flip:
//   LLM_PROVIDER=vertex   -> Claude on Google Vertex AI (AnthropicVertex)
//   LLM_PROVIDER=bedrock  -> Claude on AWS Bedrock (Converse)
//   (unset)               -> auto-detect: Vertex if its env is present, else
//                            Bedrock if configured, else none (extractive fallback).
// On ANY failure chatComplete returns null so callers degrade to extractive text.
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { bedrockRuntime, bedrockConfigured, CHAT_MODEL_ID } from "./bedrock";
import { recordAiUsage } from "./ai-usage";

/** What a provider answered, with the tokens it reports (for the usage meter). */
interface Completion { text: string | null; inputTokens: number; outputTokens: number }

export type GenProvider = "vertex" | "bedrock" | "none";

const VERTEX_PROJECT = process.env.VERTEX_PROJECT_ID ?? "";
const VERTEX_REGION = process.env.VERTEX_REGION ?? "us-east5";
const VERTEX_MODEL = process.env.VERTEX_CLAUDE_MODEL ?? "claude-sonnet-4@20250514";

function vertexConfigured(): boolean {
  return Boolean(VERTEX_PROJECT && (process.env.GOOGLE_VERTEX_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS));
}

export function generationProvider(): GenProvider {
  const forced = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  if (forced === "vertex") return "vertex";
  if (forced === "bedrock") return "bedrock";
  if (!forced) {
    if (vertexConfigured()) return "vertex";
    if (bedrockConfigured()) return "bedrock";
  }
  return "none";
}
export function generationConfigured(): boolean { return generationProvider() !== "none"; }

// Lazily build the Vertex client (SDK + google-auth imported only when used).
async function vertexComplete(system: string, user: string, maxTokens: number, temperature: number): Promise<Completion> {
  const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
  const { GoogleAuth } = await import("google-auth-library");
  const credentials = process.env.GOOGLE_VERTEX_CREDENTIALS ? JSON.parse(process.env.GOOGLE_VERTEX_CREDENTIALS) : undefined;
  const googleAuth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    ...(credentials ? { credentials } : {}),
  });
  const client = new AnthropicVertex({
    region: VERTEX_REGION, projectId: VERTEX_PROJECT,
    // The SDK bundles its own google-auth-library copy; the instance is
    // runtime-compatible, so cast past the duplicate nominal type.
    googleAuth: googleAuth as unknown as NonNullable<ConstructorParameters<typeof AnthropicVertex>[0]>["googleAuth"],
  });
  const msg = await client.messages.create({
    model: VERTEX_MODEL, max_tokens: maxTokens, temperature, system,
    messages: [{ role: "user", content: user }],
  });
  return {
    text: (msg.content ?? []).map(b => (b.type === "text" ? b.text : "")).join("") || null,
    inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0,
  };
}

async function bedrockComplete(system: string, user: string, maxTokens: number, temperature: number): Promise<Completion> {
  const res = await bedrockRuntime().send(new ConverseCommand({
    modelId: CHAT_MODEL_ID,
    system: [{ text: system }],
    messages: [{ role: "user", content: [{ text: user }] }],
    inferenceConfig: { maxTokens, temperature },
  }));
  return {
    text: res.output?.message?.content?.map(c => c.text).filter(Boolean).join("") || null,
    inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0,
  };
}

export interface ChatOpts { system: string; user: string; maxTokens: number; temperature: number }

// Returns { text, provider } or null (caller falls back to extractive text).
export async function chatComplete(opts: ChatOpts): Promise<{ text: string; provider: string } | null> {
  const provider = generationProvider();
  try {
    // Every answered call is metered, whatever the caller does with the text:
    // the tokens are spent either way (lib/server/ai-usage.ts).
    if (provider === "vertex") {
      const r = await vertexComplete(opts.system, opts.user, opts.maxTokens, opts.temperature);
      await recordAiUsage(`vertex:${VERTEX_MODEL}`, r.inputTokens, r.outputTokens);
      return r.text ? { text: r.text, provider: `vertex:${VERTEX_MODEL}` } : null;
    }
    if (provider === "bedrock") {
      const r = await bedrockComplete(opts.system, opts.user, opts.maxTokens, opts.temperature);
      await recordAiUsage(`bedrock:${CHAT_MODEL_ID}`, r.inputTokens, r.outputTokens);
      return r.text ? { text: r.text, provider: `bedrock:${CHAT_MODEL_ID}` } : null;
    }
  } catch { /* fall through to extractive */ }
  return null;
}
