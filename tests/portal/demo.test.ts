/** The Demo Client (7 November 2026): rules in lib/demo.ts. */
import { describe, expect, test } from "vitest";
import { demoTenantIds, isDemoTenant, DEMO_WIPE_TABLES, isFirstRunPrefKey, stripFirstRunPrefs } from "@/lib/demo";

const A = "11111111-2222-3333-4444-555555555555";
const B = "99999999-8888-7777-6666-555555555555";

describe("demo tenant ids", () => {
  test("unset or empty means no demos", () => {
    expect(demoTenantIds(undefined)).toEqual([]);
    expect(demoTenantIds("")).toEqual([]);
    expect(isDemoTenant(A, "")).toBe(false);
    expect(isDemoTenant(null, A)).toBe(false);
    expect(isDemoTenant(undefined, A)).toBe(false);
  });
  test("comma-separated UUIDs, trimmed, case-insensitive; junk dropped", () => {
    expect(demoTenantIds(` ${A.toUpperCase()} , ${B}`)).toEqual([A, B]);
    expect(demoTenantIds("not-a-uuid, drop table tenant")).toEqual([]);
    expect(isDemoTenant(A.toUpperCase(), A)).toBe(true);
    expect(isDemoTenant(B, A)).toBe(false);
  });
});

describe("the wipe list", () => {
  test("never touches logins, settings, spend or the audit log", () => {
    for (const kept of ["app_user", "audit_log", "feature_visibility", "ai_allowance", "ai_usage", "usage_grant", "match_source_setting", "tenant"]) {
      expect(DEMO_WIPE_TABLES).not.toContain(kept);
    }
  });
  test("clears the setup row and content, each table once", () => {
    expect(DEMO_WIPE_TABLES).toContain("tenant_setup");
    expect(DEMO_WIPE_TABLES).toContain("document");
    expect(DEMO_WIPE_TABLES).toContain("chat_session");
    expect(new Set(DEMO_WIPE_TABLES).size).toBe(DEMO_WIPE_TABLES.length);
  });
  test("references go before what they reference", () => {
    const at = (t: string) => DEMO_WIPE_TABLES.indexOf(t);
    expect(at("client_ask")).toBeLessThan(at("document"));       // no cascade on filed_document_id
    expect(at("chunk_embedding")).toBeLessThan(at("document_chunk"));
    expect(at("document_chunk")).toBeLessThan(at("document"));
    expect(at("section_block")).toBeLessThan(at("draft_section"));
    expect(at("draft_section")).toBeLessThan(at("grant_draft"));
    expect(at("story_card_version")).toBeLessThan(at("story_card"));
    expect(at("chat_message")).toBeLessThan(at("chat_session"));
    expect(at("answer")).toBeLessThan(at("draft_section"));
  });
});

describe("first-run prefs", () => {
  test("tours and don't-ask-again boxes clear; everything else stays", () => {
    expect(isFirstRunPrefKey("tour_invenstory")).toBe(true);
    expect(isFirstRunPrefKey("confirm_card_remove")).toBe(true);
    expect(isFirstRunPrefKey("confirm_weave")).toBe(true);
    expect(isFirstRunPrefKey("something_else")).toBe(false);
    expect(stripFirstRunPrefs({ tour_chat: true, confirm_weave: false, keepme: 1 })).toEqual({ keepme: 1 });
    expect(stripFirstRunPrefs({ tour_chat: true })).toBeNull();
    expect(stripFirstRunPrefs(null)).toBeNull();
  });
});
