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
import { WEB_SEARCH_MICROS } from "@/lib/ai-pricing";
import { sourcesFrom, type SearchBlock as Block, type WebSource } from "@/lib/web-discovery";
import { withRule } from "@/lib/untrusted";

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
export async function chatComplete(input: ChatOpts): Promise<{ text: string; provider: string } | null> {
  const provider = generationProvider();
  // Every call carries the untrusted-material rule (lib/untrusted.ts), whatever
  // the caller wrote, so no prompt can forget it.
  const opts = { ...input, system: withRule(input.system) };
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


// ---------------------------------------------------------------------------
// Web search (patch 5 of the 1 November 2026 build)
// ---------------------------------------------------------------------------

/** A page the search actually returned (lib/web-discovery.ts). */
export type { WebSource };

export interface WebSearchResult {
  text: string;
  /** Every result page the searches returned, and every page a citation named. */
  sources: WebSource[];
  searches: number;
}

export interface WebSearchOpts extends ChatOpts {
  /** Most searches the model may run in this call. Each is billed. */
  maxUses: number;
  /** Stop asking for more after this long, so a route stays inside its limit. */
  budgetMs?: number;
}

/**
 * Can this deployment search the web? Claude's web search is a server tool on
 * Vertex (Claude 4 and later); Bedrock does not offer it. Nothing else is
 * attempted: a search the portal cannot ground is worse than no search.
 */
export function webSearchAvailable(): boolean {
  return generationProvider() === "vertex" && process.env.WEB_SEARCH_DISABLED !== "1";
}

/**
 * One model call allowed to search the web. Returns null when search is not
 * available here or the call fails; the caller says so rather than guessing.
 * Metered like chatComplete, plus one cent per search.
 */
export async function webSearchComplete(input: WebSearchOpts): Promise<WebSearchResult | null> {
  if (!webSearchAvailable()) return null;
  const system = withRule(input.system);
  const started = Date.now();
  try {
    const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
    const { GoogleAuth } = await import("google-auth-library");
    const credentials = process.env.GOOGLE_VERTEX_CREDENTIALS ? JSON.parse(process.env.GOOGLE_VERTEX_CREDENTIALS) : undefined;
    const googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"], ...(credentials ? { credentials } : {}) });
    const client = new AnthropicVertex({
      region: VERTEX_REGION, projectId: VERTEX_PROJECT,
      googleAuth: googleAuth as unknown as NonNullable<ConstructorParameters<typeof AnthropicVertex>[0]>["googleAuth"],
    });
    // Vertex has asked for this beta header for the web search tool. Set
    // WEB_SEARCH_BETA to an empty string to stop sending it if Vertex objects.
    const beta = process.env.WEB_SEARCH_BETA ?? "web-search-2025-03-05";
    const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: input.maxUses }];
    const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: input.user }];
    const blocks: Block[] = [];
    let searches = 0, inTok = 0, outTok = 0;
    // A long search can pause mid-turn; it is resumed while time allows.
    for (let turn = 0; turn < 3; turn++) {
      const msg = await client.messages.create(
        { model: VERTEX_MODEL, max_tokens: input.maxTokens, temperature: input.temperature, system, messages, tools } as never,
        beta ? { headers: { "anthropic-beta": beta } } : undefined,
      ) as unknown as {
        content?: Block[]; stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } };
      };
      blocks.push(...(msg.content ?? []));
      inTok += msg.usage?.input_tokens ?? 0;
      outTok += msg.usage?.output_tokens ?? 0;
      searches += msg.usage?.server_tool_use?.web_search_requests ?? 0;
      if (msg.stop_reason !== "pause_turn") break;
      if (input.budgetMs && Date.now() - started > input.budgetMs * 0.6) break;
      messages.push({ role: "assistant", content: msg.content ?? [] });
    }
    await recordAiUsage(`vertex:${VERTEX_MODEL}`, inTok, outTok, searches * WEB_SEARCH_MICROS);
    // The answer is the text after the last search: earlier text is the model
    // thinking aloud between searches.
    const lastTool = blocks.map(b => b.type).lastIndexOf("web_search_tool_result");
    const text = blocks.slice(lastTool + 1).filter(b => b.type === "text").map(b => b.text ?? "").join("")
      || blocks.filter(b => b.type === "text").map(b => b.text ?? "").join("");
    return { text, sources: sourcesFrom(blocks), searches };
  } catch (e) {
    console.error("[web-search] failed", e instanceof Error ? e.message : e);
    return null;
  }
}
