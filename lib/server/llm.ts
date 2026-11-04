import "server-only";
// Text generation: Claude on Amazon Bedrock (Converse). One entry point
// (chatComplete) that the chat, Story Intelligence, Card Library and
// Storyboarding Tool paths all call. Bedrock is the only provider since the
// Bedrock-only build (3 November 2026): Google Vertex was removed, and
// LLM_PROVIDER is no longer read. Without Bedrock configured the provider is
// "none" and callers degrade to extractive text.
// On ANY failure chatComplete returns null so callers degrade to extractive text.
import { ConverseCommand, type ContentBlock, type Message, type Tool } from "@aws-sdk/client-bedrock-runtime";
import { bedrockRuntime, bedrockConfigured, CHAT_MODEL_ID } from "./bedrock";
import { recordAiUsage } from "./ai-usage";
import { agentcoreConfigured, agentcoreSearch } from "./agentcore";
import { WEB_SEARCH_MICROS } from "@/lib/ai-pricing";
import { resultsForModel, toSources, type WebResult } from "@/lib/web-search-results";
import type { WebSource } from "@/lib/web-discovery";
import { withRule, untrusted } from "@/lib/untrusted";

/** What a provider answered, with the tokens it reports (for the usage meter). */
interface Completion { text: string | null; inputTokens: number; outputTokens: number }

export type GenProvider = "bedrock" | "none";

export function generationProvider(): GenProvider {
  return bedrockConfigured() ? "bedrock" : "none";
}
export function generationConfigured(): boolean { return generationProvider() !== "none"; }

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
  if (generationProvider() !== "bedrock") return null;
  // Every call carries the untrusted-material rule (lib/untrusted.ts), whatever
  // the caller wrote, so no prompt can forget it.
  const opts = { ...input, system: withRule(input.system) };
  try {
    // Every answered call is metered, whatever the caller does with the text:
    // the tokens are spent either way (lib/server/ai-usage.ts).
    const r = await bedrockComplete(opts.system, opts.user, opts.maxTokens, opts.temperature);
    await recordAiUsage(`bedrock:${CHAT_MODEL_ID}`, r.inputTokens, r.outputTokens);
    return r.text ? { text: r.text, provider: `bedrock:${CHAT_MODEL_ID}` } : null;
  } catch { /* fall through to extractive */ }
  return null;
}


// ---------------------------------------------------------------------------
// Web search (patch 5 of the 1 November 2026 build; Bedrock and AgentCore
// since the Bedrock-only build, 3 November 2026)
// ---------------------------------------------------------------------------
//
// Claude on Bedrock has no built-in web search, so the portal gives it one: a
// `web_search` tool the model calls, which the portal answers by searching
// Web Search on Amazon Bedrock AgentCore (lib/server/agentcore.ts). Results go
// back to the model fenced as untrusted web material. Every page any search
// returned is a source a lead may point at (groundLeads), exactly as before.

/** A page the search actually returned (lib/web-discovery.ts). */
export type { WebSource };

export interface WebSearchResult {
  text: string;
  /** Every result page the searches returned. */
  sources: WebSource[];
  searches: number;
}

export interface WebSearchOpts extends ChatOpts {
  /** Most searches the model may run in this call. Each is billed. */
  maxUses: number;
  /** Stop asking for more after this long, so a route stays inside its limit. */
  budgetMs?: number;
}

/** Can this deployment search the web? Bedrock for the model, AgentCore for the search. */
export function webSearchAvailable(): boolean {
  return generationProvider() === "bedrock" && agentcoreConfigured() && process.env.WEB_SEARCH_DISABLED !== "1";
}

const SEARCH_TOOL: Tool = {
  toolSpec: {
    name: "web_search",
    description: "Search the web. Returns numbered results with a title, URL, date and snippet. Use short, specific queries.",
    inputSchema: { json: { type: "object", properties: { query: { type: "string", description: "The search query" } }, required: ["query"] } as never },
  },
};

/**
 * One model call allowed to search the web. Returns null when search is not
 * available here or the call fails; the caller says so rather than guessing.
 * Metered like chatComplete, plus each search (WEB_SEARCH_MICROS).
 */
export async function webSearchComplete(input: WebSearchOpts): Promise<WebSearchResult | null> {
  if (!webSearchAvailable()) return null;
  const system = withRule(input.system);
  const started = Date.now();
  const messages: Message[] = [{ role: "user", content: [{ text: input.user }] }];
  const found: WebResult[] = [];
  let searches = 0, inTok = 0, outTok = 0;
  let text = "";
  try {
    // At most one turn per allowed search, plus one to answer.
    for (let turn = 0; turn <= input.maxUses + 1; turn++) {
      const res = await bedrockRuntime().send(new ConverseCommand({
        modelId: CHAT_MODEL_ID,
        system: [{ text: system }],
        messages,
        toolConfig: { tools: [SEARCH_TOOL] },
        inferenceConfig: { maxTokens: input.maxTokens, temperature: input.temperature },
      }));
      inTok += res.usage?.inputTokens ?? 0;
      outTok += res.usage?.outputTokens ?? 0;
      const content = (res.output?.message?.content ?? []) as ContentBlock[];
      text = content.map(c => c.text ?? "").join("") || text;
      const calls = content.filter(c => c.toolUse).map(c => c.toolUse!);
      if (res.stopReason !== "tool_use" || !calls.length) break;
      messages.push({ role: "assistant", content });
      const outOfTime = !!input.budgetMs && Date.now() - started > input.budgetMs * 0.6;
      const replies: ContentBlock[] = [];
      for (const call of calls) {
        const query = String((call.input as { query?: unknown } | undefined)?.query ?? "").trim();
        if (!query || searches >= input.maxUses || outOfTime) {
          replies.push({ toolResult: { toolUseId: call.toolUseId, status: "error", content: [{ text: "No more searches are allowed. Answer now from the results you have." }] } });
          continue;
        }
        searches++;
        const r = await agentcoreSearch(query);
        found.push(...r.results);
        replies.push({ toolResult: {
          toolUseId: call.toolUseId,
          status: r.ok ? "success" : "error",
          content: [{ text: r.ok ? untrusted("WEB_RESULTS", resultsForModel(query, r.results)) : "The search did not answer. Try another query or answer from what you have." }],
        } });
      }
      messages.push({ role: "user", content: replies });
    }
    await recordAiUsage(`bedrock:${CHAT_MODEL_ID}`, inTok, outTok, searches * WEB_SEARCH_MICROS);
    return { text, sources: toSources(found), searches };
  } catch (e) {
    console.error("[web-search] failed", e instanceof Error ? e.message : e);
    if (inTok || outTok) await recordAiUsage(`bedrock:${CHAT_MODEL_ID}`, inTok, outTok, searches * WEB_SEARCH_MICROS).catch(() => {});
    return null;
  }
}
