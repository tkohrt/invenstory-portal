// The link reader's pinned connection, over a REAL socket (patch 55, 17 Nov 2026).
//
// Patch 23 pinned every request to the address the safety check approved, but
// answered Node's lookup in the wrong shape for Node 20 and later, so every
// link read failed before a request left the server, and it read as a slow
// page. Nothing caught it for eight days because no test opened a connection.
// These do: a local server, a made-up hostname, and the pin as the only way
// the name can resolve.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("server-only", () => ({}));
import { pinnedGet, pinnedLookup } from "@/lib/server/read-url";

let server: Server;
let port = 0;
let seenHost = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    seenHost = req.headers.host ?? "";
    if (req.url === "/moved") { res.writeHead(302, { location: "/there" }); res.end(); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<html><body><p>Hello from the pinned address.</p></body></html>");
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise(r => server.close(r)); });

const hop = (path: string) => ({ url: new URL(`http://pinned.example.test:${port}${path}`), address: "127.0.0.1", family: 4 });

describe("pinnedGet", () => {
  it("connects to the approved address for a name that resolves nowhere", async () => {
    const r = await pinnedGet(hop("/"), AbortSignal.timeout(5000));
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("text/html");
    expect(new TextDecoder().decode(r.body)).toContain("Hello from the pinned address.");
    // The request still names the site, so virtual hosts and TLS see the hostname.
    expect(seenHost).toBe(`pinned.example.test:${port}`);
  });

  it("hands a redirect back rather than following it", async () => {
    const r = await pinnedGet(hop("/moved"), AbortSignal.timeout(5000));
    expect(r.status).toBe(302);
    expect(r.location).toBe("/there");
  });
});

describe("pinnedLookup", () => {
  it("answers with a list when Node asks for all addresses", () => {
    const cb = vi.fn();
    pinnedLookup("203.0.113.7", 4)("example.org", { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: "203.0.113.7", family: 4 }]);
  });
  it("answers with one address when Node asks for one", () => {
    const cb = vi.fn();
    pinnedLookup("203.0.113.7", 4)("example.org", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "203.0.113.7", 4);
  });
  it("answers the two-argument form", () => {
    const cb = vi.fn();
    pinnedLookup("203.0.113.7", 4)("example.org", cb, undefined as never);
    expect(cb).toHaveBeenCalledWith(null, "203.0.113.7", 4);
  });
});
