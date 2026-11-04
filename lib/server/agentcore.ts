import "server-only";
// Web Search on Amazon Bedrock AgentCore (the Bedrock-only build, 3 November
// 2026). The search is an MCP tool on an AgentCore Gateway created with IAM
// (SigV4) inbound authorization, so the portal signs each request with the same
// IAM access keys it uses for Bedrock. No search API key exists.
//
//   AGENTCORE_GATEWAY_URL      https://<id>.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp
//   AGENTCORE_WEB_SEARCH_TOOL  optional: the tool's exact name (else found by tools/list)
//
// The IAM user behind PORTAL_AWS_ACCESS_KEY_ID needs bedrock-agentcore:InvokeGateway
// on that gateway. Pricing: $7 per 1,000 queries (AgentCore pricing page).
import { createHash, createHmac } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";
import { BEDROCK_REGION } from "./bedrock";
import { decodeSearchResults, gatewayRegion, parseRpcBody, pickSearchTool, searchArguments, type WebResult } from "@/lib/web-search-results";

const GATEWAY_URL = process.env.AGENTCORE_GATEWAY_URL ?? "";

/** SHA-256 in the shape SigV4 asks for, from node:crypto. */
class Sha256 {
  private h: ReturnType<typeof createHash> | ReturnType<typeof createHmac>;
  constructor(secret?: string | Uint8Array) {
    this.h = secret ? createHmac("sha256", typeof secret === "string" ? Buffer.from(secret) : Buffer.from(secret)) : createHash("sha256");
  }
  update(data: string | Uint8Array) { this.h.update(typeof data === "string" ? Buffer.from(data) : Buffer.from(data)); }
  async digest(): Promise<Uint8Array> { return new Uint8Array(this.h.digest()); }
  reset() { /* one use per instance */ }
}

export function agentcoreConfigured(): boolean {
  return Boolean(GATEWAY_URL && process.env.PORTAL_AWS_ACCESS_KEY_ID && process.env.PORTAL_AWS_SECRET_ACCESS_KEY);
}

async function rpc(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<{ result?: unknown; error?: { message?: string } } | null> {
  const url = new URL(GATEWAY_URL);
  const body = JSON.stringify({ jsonrpc: "2.0", id: `${method}-${Date.now()}`, method, params });
  const signer = new SignatureV4({
    service: "bedrock-agentcore",
    region: gatewayRegion(GATEWAY_URL) ?? BEDROCK_REGION,
    credentials: {
      accessKeyId: process.env.PORTAL_AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.PORTAL_AWS_SECRET_ACCESS_KEY ?? "",
    },
    sha256: Sha256 as never,
  });
  const signed = await signer.sign({
    method: "POST", protocol: url.protocol, hostname: url.hostname, path: url.pathname, query: {},
    headers: { host: url.hostname, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body,
  });
  const res = await fetch(url, {
    method: "POST", headers: signed.headers as Record<string, string>, body,
    signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) { console.error("[agentcore] HTTP", res.status, text.slice(0, 300)); return null; }
  return parseRpcBody(text, res.headers.get("content-type")) as { result?: unknown; error?: { message?: string } } | null;
}

// Found once per warm instance: the gateway's tool list rarely changes.
let toolCache: { name: string; schema: unknown } | null = null;

async function searchTool(): Promise<{ name: string; schema: unknown } | null> {
  if (toolCache) return toolCache;
  const r = await rpc("tools/list", {}, 10_000);
  const tools = ((r?.result as { tools?: { name?: string; inputSchema?: unknown }[] } | undefined)?.tools) ?? [];
  const name = pickSearchTool(tools, process.env.AGENTCORE_WEB_SEARCH_TOOL || null);
  if (!name) { console.error("[agentcore] no web search tool on the gateway", tools.map(t => t.name)); return null; }
  toolCache = { name, schema: tools.find(t => t.name === name)?.inputSchema ?? null };
  return toolCache;
}

/** One web search. Never throws: a failure is { ok: false } and the caller says so. */
export async function agentcoreSearch(query: string, timeoutMs = 15_000): Promise<{ ok: boolean; results: WebResult[] }> {
  if (!agentcoreConfigured()) return { ok: false, results: [] };
  try {
    const tool = await searchTool();
    if (!tool) return { ok: false, results: [] };
    const r = await rpc("tools/call", { name: tool.name, arguments: searchArguments(tool.schema, query.slice(0, 400)) }, timeoutMs);
    if (!r || r.error) { if (r?.error) console.error("[agentcore] search refused", r.error.message); return { ok: false, results: [] }; }
    const result = r.result as { isError?: boolean } | undefined;
    if (result?.isError) return { ok: false, results: [] };
    return { ok: true, results: decodeSearchResults(result) };
  } catch (e) {
    console.error("[agentcore] search failed", e instanceof Error ? e.message : e);
    return { ok: false, results: [] };
  }
}
