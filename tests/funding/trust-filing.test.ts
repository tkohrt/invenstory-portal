/**
 * Trust tiers (patch 67): what fileLeads writes. A first-party source's
 * opportunity is published as it is filed; everything else waits; a decision
 * a person already made is never undone by a re-read; and a database without
 * migration 0100 files as it always did.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/llm", () => ({ chatComplete: vi.fn() }));
vi.mock("@/lib/server/eligibility", () => ({ getEligibilityProfile: vi.fn() }));

type Row = Record<string, unknown>;
const state: { rows: Row[]; has0100: boolean; failRead: boolean } = { rows: [], has0100: true, failRead: false };
const NEW_COLS = ["published_at", "signal_source_id"];
const missing = (text: string) => !state.has0100 && NEW_COLS.some(c => text.includes(c));

vi.mock("@/lib/server/db", () => ({
  db: {
    from(table: string) {
      if (table !== "ledger_overlay") throw new Error(`unexpected table ${table}`);
      return {
        select(cols: string) {
          let url: unknown;
          const q = {
            eq(_c: string, v: unknown) { url = v; return q; },
            limit() { return q; },
            async maybeSingle() {
              if (state.failRead) return { data: null, error: { message: "connection reset" } };
              if (missing(cols)) return { data: null, error: { message: "column ledger_overlay.published_at does not exist" } };
              const r = state.rows.find(x => x.source_url === url) ?? null;
              return { data: r ? { ...r } : null, error: null };
            },
          };
          return q;
        },
        async insert(row: Row) {
          if (missing(Object.keys(row).join(","))) return { error: { message: "Could not find the 'published_at' column of 'ledger_overlay'" } };
          state.rows.push({ id: `id${state.rows.length + 1}`, ...row });
          return { error: null };
        },
        update(patch: Row) {
          return { async eq(_c: string, id: unknown) { const r = state.rows.find(x => x.id === id); if (r) Object.assign(r, patch); return { error: null }; } };
        },
      };
    },
  },
}));

import { fileLeads } from "@/lib/server/curated";
import { curatedLeads } from "@/lib/curated";

const leads = (items: { title: string; url: string; kind?: string }[]) =>
  curatedLeads(items.map(i => ({ kind: i.kind ?? "opportunity", money_kind: "grants", title: i.title, url: i.url, funder: "NEH" })), "2026-11-19");
const own = { id: "src-own", kind: "page", trust: "first_party" as const };
const news = { id: "src-news", kind: "bluesky", trust: "review" as const };

beforeEach(() => { state.rows = []; state.has0100 = true; state.failRead = false; });

describe("fileLeads and the trust tier", () => {
  it("publishes a first-party source's opportunity as it files it, still waiting for review", async () => {
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(1);
    const r = state.rows[0];
    expect(r.status).toBe("proposed");
    expect(r.signal_source_id).toBe("src-own");
    expect(typeof r.published_at).toBe("string");
  });
  it("files a review source's opportunity unpublished, under its source", async () => {
    await fileLeads("list1", leads([{ title: "A roundup item", url: "https://news.example/a" }]), null, news);
    expect(state.rows[0].published_at).toBeNull();
    expect(state.rows[0].signal_source_id).toBe("src-news");
  });
  it("files a pasted list exactly as before: no source, nothing published", async () => {
    await fileLeads("list1", leads([{ title: "Pasted", url: "https://funder.example/a" }]), "user1");
    expect(state.rows[0].published_at).toBeNull();
    expect(state.rows[0].signal_source_id).toBeNull();
    expect(state.rows[0].proposed_by).toBe("user1");
  });
  it("never publishes a funder record, even from a first-party source", async () => {
    await fileLeads("list1", leads([{ title: "Cleveland Foundation", url: "https://www.clevelandfoundation.org/grants", kind: "funder" }]), null, own);
    expect(state.rows[0].kind).toBe("funder");
    expect(state.rows[0].published_at).toBeNull();
  });
  it("publishes a waiting entry when a first-party source later states it too, keeping its first source", async () => {
    await fileLeads("list1", leads([{ title: "Fellowship", url: "https://kresge.org/f" }]), null, news);
    expect(await fileLeads("list1", leads([{ title: "Fellowship", url: "https://kresge.org/f" }]), null, own)).toBe(0);
    expect(state.rows).toHaveLength(1);
    expect(typeof state.rows[0].published_at).toBe("string");
    expect(state.rows[0].signal_source_id).toBe("src-news");
  });
  it("does not publish a waiting entry because a review source repeats it", async () => {
    await fileLeads("list1", leads([{ title: "Fellowship", url: "https://kresge.org/f" }]), null, news);
    await fileLeads("list1", leads([{ title: "Fellowship", url: "https://kresge.org/f" }]), null, news);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].published_at).toBeNull();
  });
  it.each(["rejected", "approved", "superseded"])("never touches an entry a person already decided (%s)", async status => {
    state.rows.push({ id: "old", kind: "grant", status, curated_list_id: "list0", published_at: null, signal_source_id: null, source_url: "https://www.neh.gov/a" });
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(0);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].published_at).toBeNull();
    expect(state.rows[0].status).toBe(status);
  });
  it("does not re-stamp an entry that is already published", async () => {
    state.rows.push({ id: "old", kind: "grant", status: "proposed", curated_list_id: "list0", published_at: "2026-11-01T00:00:00Z", signal_source_id: "src-own", source_url: "https://www.neh.gov/a" });
    await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own);
    expect(state.rows[0].published_at).toBe("2026-11-01T00:00:00Z");
  });
  it("files nothing twice when the lookup fails: a failed read is not 'not known'", async () => {
    state.failRead = true;
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(0);
    expect(state.rows).toHaveLength(0);
  });
  it("before migration 0100, files as it always did and publishes nothing", async () => {
    state.has0100 = false;
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(1);
    expect(state.rows).toHaveLength(1);
    expect("published_at" in state.rows[0]).toBe(false);
    // And a second read does not duplicate it.
    expect(await fileLeads("list1", leads([{ title: "Collections Stewardship", url: "https://www.neh.gov/a" }]), null, own)).toBe(0);
    expect(state.rows).toHaveLength(1);
  });
});
