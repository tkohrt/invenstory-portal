// Web search results from Web Search on Amazon Bedrock AgentCore (the Bedrock-only
// build, 3 November 2026). Pure and free of `server-only`, so the decoding is
// tested (tests/ledger/web-search-results.test.ts).
//
// The search runs as an MCP tool on an AgentCore Gateway. A tools/call answer is
// MCP content: usually one text block holding JSON, sometimes structuredContent.
// The exact field names are AgentCore's, so the decoder is deliberately
// tolerant: it walks the answer for objects that carry a URL and reads the
// usual names for title, snippet and date. Anything it cannot read is skipped;
// a result without a URL is never kept, because a lead must point at a page
// the search actually returned (groundLeads in lib/web-discovery.ts).
import type { WebSource } from "@/lib/web-discovery";

export interface WebResult { url: string; title: string | null; snippet: string | null; published: string | null }

const URL_KEYS = ["url", "link", "uri", "source_url", "sourceUrl", "page_url"];
const TITLE_KEYS = ["title", "name", "page_title", "pageTitle", "headline"];
const SNIPPET_KEYS = ["snippet", "text", "content", "description", "summary", "extract", "excerpt"];
const DATE_KEYS = ["published_date", "publishedDate", "published", "date", "datePublished", "last_updated", "lastUpdated"];

function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function isHttp(u: string): boolean {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; }
}

/** Every object in the tree that names a web page, in order, de-duplicated by URL. */
export function decodeSearchResults(raw: unknown, max = 20): WebResult[] {
  const out = new Map<string, WebResult>();
  const seen = new Set<unknown>();
  const visit = (v: unknown, depth: number) => {
    if (out.size >= max || depth > 8 || v == null || seen.has(v)) return;
    if (typeof v === "string") {
      // A text block that is itself JSON.
      const t = v.trim();
      if ((t.startsWith("{") || t.startsWith("[")) && t.length < 2_000_000) {
        try { visit(JSON.parse(t), depth + 1); } catch { /* plain text: nothing to read */ }
      }
      return;
    }
    if (typeof v !== "object") return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    const o = v as Record<string, unknown>;
    const url = pick(o, URL_KEYS);
    if (url && isHttp(url) && !out.has(url)) {
      const snippet = pick(o, SNIPPET_KEYS);
      out.set(url, {
        url,
        title: pick(o, TITLE_KEYS)?.slice(0, 300) ?? null,
        snippet: snippet ? snippet.replace(/\s+/g, " ").slice(0, 1200) : null,
        published: pick(o, DATE_KEYS)?.slice(0, 40) ?? null,
      });
    }
    for (const k of Object.keys(o)) visit(o[k], depth + 1);
  };
  visit(raw, 0);
  return [...out.values()];
}

/** What the model reads for one search: numbered results, plain text. */
export function resultsForModel(query: string, results: WebResult[]): string {
  if (!results.length) return `No results for "${query}".`;
  return results.map((r, i) => [
    `[${i + 1}] ${r.title ?? "(no title)"}`,
    `URL: ${r.url}`,
    r.published ? `Published: ${r.published}` : null,
    r.snippet ? `Snippet: ${r.snippet}` : null,
  ].filter(Boolean).join("\n")).join("\n\n");
}

/** The pages a lead may point at. */
export function toSources(results: WebResult[]): WebSource[] {
  const out = new Map<string, WebSource>();
  for (const r of results) if (!out.has(r.url)) out.set(r.url, { url: r.url, title: r.title, pageAge: r.published });
  return [...out.values()];
}

/**
 * Which of the gateway's tools is the web search. An explicit name wins; else a
 * tool whose name says web search; else one that says search, but never the
 * gateway's own tool-finder (x_amz_bedrock_agentcore_search).
 */
export function pickSearchTool(tools: { name?: unknown }[], explicit?: string | null): string | null {
  const names = tools.map(t => (typeof t?.name === "string" ? t.name : "")).filter(Boolean);
  if (explicit) return names.includes(explicit) ? explicit : null;
  const usable = names.filter(n => !/x_amz_bedrock_agentcore_search/i.test(n));
  return usable.find(n => /web[_-]?search/i.test(n)) ?? usable.find(n => /search/i.test(n)) ?? null;
}

/** The arguments for the tool: its schema's query field, so a renamed field still works. */
export function searchArguments(schema: unknown, query: string): Record<string, unknown> {
  const props = (schema as { properties?: Record<string, unknown> } | null)?.properties ?? {};
  const key = ["query", "q", "search_query", "searchQuery", "text"].find(k => k in props) ?? "query";
  return { [key]: query };
}

/** The region in an AgentCore Gateway URL: https://<id>.gateway.bedrock-agentcore.<region>.amazonaws.com/mcp */
export function gatewayRegion(url: string): string | null {
  try { return new URL(url).hostname.match(/\.bedrock-agentcore\.([a-z0-9-]+)\.amazonaws\.com$/)?.[1] ?? null; } catch { return null; }
}

/** An MCP answer sent as server-sent events: the JSON in its last data line. */
export function parseRpcBody(body: string, contentType: string | null): unknown {
  if (contentType?.includes("text/event-stream")) {
    const datas = body.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).filter(Boolean);
    for (let i = datas.length - 1; i >= 0; i--) { try { return JSON.parse(datas[i]); } catch { /* keep looking */ } }
    return null;
  }
  try { return JSON.parse(body); } catch { return null; }
}
