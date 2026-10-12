import { describe, expect, it } from "vitest";
import { brainAllows, clientTenants, isBrain } from "@/lib/brain";

const t = (name: string, is_brain?: boolean | null) => ({ id: name, name, is_brain });

describe("the Brain (Auto-Draft patch 3)", () => {
  it("is only the tenant marked is_brain; a row read before 0061 is a client", () => {
    expect(isBrain(t("Brain", true))).toBe(true);
    expect(isBrain(t("A", false))).toBe(false);
    expect(isBrain(t("A", null))).toBe(false);
    expect(isBrain(t("A"))).toBe(false);
    expect(isBrain(null)).toBe(false);
  });

  it("leaves the Brain out of client lists, keeping their order", () => {
    const rows = [t("Acme"), t("For Granted Brain", true), t("Zeta", false)];
    expect(clientTenants(rows).map(r => r.name)).toEqual(["Acme", "Zeta"]);
    expect(clientTenants(null)).toEqual([]);
  });

  it("opens its documents, chat, search, account and admin pages (the analysis runs on Admin, Analysis)", () => {
    for (const p of ["/invenstory", "/chat", "/search", "/account", "/admin/clients", "/admin/analysis", "/admin/card-library"]) {
      expect(brainAllows(p)).toBe(true);
    }
  });

  it("closes everything about a client's funding, and the Readiness Audit", () => {
    for (const p of ["/analysis", "/funder-matches", "/funding-eligibility", "/plant", "/story-intelligence/x", "/story-cards",
      "/drafts", "/drafts/new", "/draft", "/draft/new", "/admin/readiness-audit"]) {
      expect(brainAllows(p)).toBe(false);
    }
  });

  it("matches whole path segments, so a look-alike path is not let in", () => {
    expect(brainAllows("/invenstory-old")).toBe(false);
    expect(brainAllows("/chatter")).toBe(false);
  });
});
