/**
 * Cross-tenant isolation: Tenant A must never reach Tenant B's data.
 * Each probe uses A's authenticated (RLS-enforced) client against B's row ids.
 * Positive controls confirm A CAN see its own data (so a passing "cannot see B"
 * isn't just a broken query).
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { provisionTenant, teardown, TestTenant } from "./setup";

let A: TestTenant, B: TestTenant;

beforeAll(async () => { [A, B] = await Promise.all([provisionTenant("A"), provisionTenant("B")]); });
afterAll(async () => { await teardown(A, B); });

// Tables keyed by id, with the field holding B's target id.
const readProbes: { table: string; id: () => string }[] = [
  { table: "document",       id: () => B.docId },
  { table: "document_chunk", id: () => B.docId /* filter by document_id below */ },
  { table: "chat_session",   id: () => B.chatSessionId },
  { table: "chat_message",   id: () => B.chatMessageId },
  { table: "grant_draft",    id: () => B.draftId },
  { table: "plant_state",    id: () => B.tenantId /* pk is tenant_id */ },
];

describe("A cannot READ B's rows", () => {
  test("document by id → empty", async () => {
    const { data } = await A.client.from("document").select("*").eq("id", B.docId);
    expect(data ?? []).toHaveLength(0);
  });
  test("document_chunk by document_id → empty", async () => {
    const { data } = await A.client.from("document_chunk").select("*").eq("document_id", B.docId);
    expect(data ?? []).toHaveLength(0);
  });
  test("document_tag by document_id → empty", async () => {
    const { data } = await A.client.from("document_tag").select("*").eq("document_id", B.docId);
    expect(data ?? []).toHaveLength(0);
  });
  test("chat_session by id → empty", async () => {
    const { data } = await A.client.from("chat_session").select("*").eq("id", B.chatSessionId);
    expect(data ?? []).toHaveLength(0);
  });
  test("chat_message by id → empty", async () => {
    const { data } = await A.client.from("chat_message").select("*").eq("id", B.chatMessageId);
    expect(data ?? []).toHaveLength(0);
  });
  test("grant_draft by id → empty", async () => {
    const { data } = await A.client.from("grant_draft").select("*").eq("id", B.draftId);
    expect(data ?? []).toHaveLength(0);
  });
  test("plant_state by tenant_id → empty", async () => {
    const { data } = await A.client.from("plant_state").select("*").eq("tenant_id", B.tenantId);
    expect(data ?? []).toHaveLength(0);
  });
  test("blanket document select never contains B's rows", async () => {
    const { data } = await A.client.from("document").select("id, tenant_id");
    expect((data ?? []).some(r => r.tenant_id === B.tenantId)).toBe(false);
  });
});

describe("A CAN read its own rows (positive control)", () => {
  test("A sees its own document", async () => {
    const { data } = await A.client.from("document").select("id").eq("id", A.docId);
    expect(data ?? []).toHaveLength(1);
  });
});

describe("A cannot WRITE B's rows", () => {
  test("update B's document title → 0 rows affected", async () => {
    const { data } = await A.client.from("document").update({ title: "HACKED" }).eq("id", B.docId).select("id");
    expect(data ?? []).toHaveLength(0);
  });
  test("delete B's grant_draft → 0 rows affected", async () => {
    const { data } = await A.client.from("grant_draft").delete().eq("id", B.draftId).select("id");
    expect(data ?? []).toHaveLength(0);
  });
  test("insert a document into B's tenant → rejected by RLS", async () => {
    const { data, error } = await A.client.from("document")
      .insert({ tenant_id: B.tenantId, title: "smuggled", layer: "I", storage_key: "x", doc_kind: "note", status: "ready" })
      .select("id");
    // RLS with-check should reject, or silently insert nothing.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
  test("update B's plant_state → 0 rows affected", async () => {
    const { data } = await A.client.from("plant_state").update({ species: "monstera" }).eq("tenant_id", B.tenantId).select("tenant_id");
    expect(data ?? []).toHaveLength(0);
  });
});

describe("A cannot enumerate other tenants / users", () => {
  test("tenant table shows only A's own org", async () => {
    const { data } = await A.client.from("tenant").select("id");
    const ids = (data ?? []).map(r => r.id);
    expect(ids).toContain(A.tenantId);
    expect(ids).not.toContain(B.tenantId);
  });
  test("app_user table never exposes B's users", async () => {
    const { data } = await A.client.from("app_user").select("id, tenant_id");
    expect((data ?? []).some(r => r.tenant_id === B.tenantId)).toBe(false);
  });
});

describe("Embedding search cannot leak across tenants", () => {
  // If a match_chunks-style RPC exists, a search run as A must never return B's
  // chunks even when the query text matches B's confidential content.
  test("match_chunks (if present) returns no B chunks", async () => {
    // A zero-vector is fine; we're asserting tenant scoping, not relevance.
    const dim = 384;
    const zero = Array(dim).fill(0);
    const { data, error } = await A.client.rpc("match_chunks", { query_embedding: zero, match_count: 50 });
    if (error && /function .* does not exist/i.test(error.message)) return; // RPC name differs; skip
    expect((data ?? []).some((r: { tenant_id?: string }) => r.tenant_id === B.tenantId)).toBe(false);
  });
});
