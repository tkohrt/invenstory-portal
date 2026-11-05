// What one model call cost, from the tokens it reports.
//
// List prices per million tokens (Anthropic, October 2026). From Sonnet 4.5 and
// Haiku 4.5 on, Bedrock's regional and multi-region endpoints (a "us."
// inference profile) carry a 10% premium over global
// ones. An unknown model is priced as Sonnet, the portal's default, so a cost is
// never silently zero. Pure, so the meter and its tests agree.

interface Rate { input: number; output: number }

const SONNET: Rate = { input: 3, output: 15 };
// Sonnet 5 and 5.5 (patch 20): $2 / $10 per million, $2.20 / $11 on a "us." profile.
const SONNET_5: Rate = { input: 2, output: 10 };
const HAIKU_45: Rate = { input: 1, output: 5 };
const HAIKU_3: Rate = { input: 0.8, output: 4 };
const OPUS_45: Rate = { input: 5, output: 25 };
const OPUS_4: Rate = { input: 15, output: 75 };

/** Version as a number from an id like "claude-sonnet-4-5-20250929" or "claude-sonnet-4@2025". */
function version(id: string): number {
  const m = id.match(/claude-(?:sonnet|haiku|opus|fable|mythos)-(\d+)(?:-(\d)(?!\d))?/i);
  if (!m) return 0;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 10 : 0);
}

export function rateFor(modelId: string): Rate & { premium: boolean } {
  const id = modelId.toLowerCase();
  const v = version(id);
  let rate = v >= 5 ? SONNET_5 : SONNET;
  if (id.includes("haiku")) rate = v >= 4.5 ? HAIKU_45 : HAIKU_3;
  else if (id.includes("opus")) rate = v >= 4.5 ? OPUS_45 : OPUS_4;
  // Global endpoints carry no premium; regional ones do from 4.5 on.
  const premium = v >= 4.5 && !/(^|[:.\s])global\./.test(id);
  return { ...rate, premium };
}

/** The cost in millionths of a dollar (so it stores as an integer). */
export function costMicros(modelId: string, inputTokens: number, outputTokens: number): number {
  const r = rateFor(modelId);
  const k = r.premium ? 1.1 : 1;
  // Per-million price times tokens is already in micro-dollars.
  return Math.round((Math.max(0, inputTokens) * r.input + Math.max(0, outputTokens) * r.output) * k);
}

export const dollars = (micros: number) => micros / 1_000_000;

/**
 * Web search is billed per search on top of tokens. Since the Bedrock-only
 * build (3 Nov 2026) it is Web Search on Amazon Bedrock AgentCore: $7 per
 * 1,000 queries, so 0.7 of a cent each. (Claude's own tool on Vertex was $10
 * per 1,000.)
 */
export const WEB_SEARCH_MICROS = 7_000;
