/** Web Search on Amazon Bedrock AgentCore: reading its answers (Bedrock-only build, 3 Nov 2026). */
import { describe, expect, test } from "vitest";
import { decodeSearchResults, resultsForModel, toSources, pickSearchTool, searchArguments, gatewayRegion, parseRpcBody } from "@/lib/web-search-results";

describe("decodeSearchResults", () => {
  test("reads a text block holding JSON, the usual MCP shape", () => {
    const mcp = { content: [{ type: "text", text: JSON.stringify({ results: [
      { title: "SME support call 2026", url: "https://fund.example.org/calls/sme-2026", snippet: "Applications close 28 November", published_date: "2026-10-01" },
      { title: "Other", link: "https://www.other.org/", text: "About us" },
    ] }) }] };
    const r = decodeSearchResults(mcp);
    expect(r.map(x => x.url)).toEqual(["https://fund.example.org/calls/sme-2026", "https://www.other.org/"]);
    expect(r[0]).toMatchObject({ title: "SME support call 2026", published: "2026-10-01" });
    expect(r[1].snippet).toBe("About us");
  });
  test("reads structuredContent and nested lists, once per URL", () => {
    const r = decodeSearchResults({ structuredContent: { webResults: { items: [{ uri: "https://a.org/x", name: "A" }, { url: "https://a.org/x" }] } } });
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("A");
  });
  test("keeps nothing without a web address, and never throws", () => {
    expect(decodeSearchResults({ content: [{ type: "text", text: "plain words" }] })).toEqual([]);
    expect(decodeSearchResults({ url: "javascript:alert(1)" })).toEqual([]);
    expect(decodeSearchResults(null)).toEqual([]);
  });
  test("turns results into sources and model text", () => {
    const r = [{ url: "https://a.org/x", title: "A", snippet: "s", published: "2026" }];
    expect(toSources(r)).toEqual([{ url: "https://a.org/x", title: "A", pageAge: "2026" }]);
    expect(resultsForModel("q", r)).toContain("URL: https://a.org/x");
    expect(resultsForModel("q", [])).toBe('No results for "q".');
  });
});

describe("the gateway", () => {
  test("finds the web search tool, never the gateway's own tool-finder", () => {
    expect(pickSearchTool([{ name: "x_amz_bedrock_agentcore_search" }, { name: "web-search-target___web_search" }])).toBe("web-search-target___web_search");
    expect(pickSearchTool([{ name: "x_amz_bedrock_agentcore_search" }])).toBeNull();
    expect(pickSearchTool([{ name: "a" }, { name: "b" }], "b")).toBe("b");
    expect(pickSearchTool([{ name: "a" }], "missing")).toBeNull();
  });
  test("uses the schema's own query field", () => {
    expect(searchArguments({ properties: { q: {} } }, "x")).toEqual({ q: "x" });
    expect(searchArguments(null, "x")).toEqual({ query: "x" });
  });
  test("reads the region from the gateway address", () => {
    expect(gatewayRegion("https://fg-abc123.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp")).toBe("us-east-1");
    expect(gatewayRegion("not a url")).toBeNull();
  });
  test("reads JSON or server-sent events", () => {
    expect(parseRpcBody('{"result":1}', "application/json")).toEqual({ result: 1 });
    expect(parseRpcBody('event: message\ndata: {"result":2}\n\n', "text/event-stream")).toEqual({ result: 2 });
  });
});
