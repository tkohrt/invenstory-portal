/**
 * The manual verification form is the human feed into the overlay. The rule
 * under test: a blank field leaves the base record alone. Getting that wrong
 * would let a half-filled form erase good data for every client at once.
 */
import { describe, expect, test } from "vitest";
import { buildOverlayEntry } from "@/lib/overlay-entry";
import type { OverlayManualEntry } from "@/lib/types";

const base: OverlayManualEntry = { kind: "funder", source_url: "https://x.org" };

describe("buildOverlayEntry", () => {
  test("blank fields are omitted entirely, not written as empty strings", () => {
    const b = buildOverlayEntry({ ...base, name: "Manna Fund", website: "", location: "   " });
    expect(b.fields).toEqual({ name: "Manna Fund" });
    expect("website" in b.fields).toBe(false);
    expect("location" in b.fields).toBe(false);
  });

  test("refuses an entry with nothing in it", () => {
    expect(() => buildOverlayEntry({ ...base, title: "Something" })).toThrow(/at least one field/i);
  });

  test("refuses an entry with no title to recognise it by", () => {
    expect(() => buildOverlayEntry({ ...base, website: "https://x.org" })).toThrow(/title/i);
  });

  test("falls back to the name, then the opportunity number, for a title", () => {
    expect(buildOverlayEntry({ ...base, name: "Manna Fund" }).title).toBe("Manna Fund");
    expect(buildOverlayEntry({ ...base, kind: "grant", opportunity_number: "SM-26-001", agency: "SAMHSA" }).title)
      .toBe("SM-26-001");
  });

  test("money is accepted the way a person types it", () => {
    const b = buildOverlayEntry({ ...base, kind: "grant", title: "G", max_award: "$50,000" });
    expect(b.fields.max_award).toBe(50000);
  });

  test("rejects money that isn't a number", () => {
    expect(() => buildOverlayEntry({ ...base, kind: "grant", title: "G", max_award: "lots" }))
      .toThrow(/must be a number/i);
  });

  test("rejects an impossible date", () => {
    expect(() => buildOverlayEntry({ ...base, kind: "grant", title: "G", close_date: "2026-13-45" }))
      .toThrow(/real date/i);
  });

  test("keeps a valid deadline verbatim so the screener can compare it", () => {
    const b = buildOverlayEntry({ ...base, kind: "grant", title: "G", close_date: "2027-03-01" });
    expect(b.fields.close_date).toBe("2027-03-01");
  });

  test("EIN is normalised to digits so it joins against the base", () => {
    expect(buildOverlayEntry({ ...base, name: "X", ein: "86-3418425" }).ein).toBe("863418425");
  });

  test("a blank Ledger record ID means a brand-new record", () => {
    expect(buildOverlayEntry({ ...base, name: "X", base_id: "  " }).base_id).toBeNull();
    expect(buildOverlayEntry({ ...base, name: "X", base_id: "G-77" }).base_id).toBe("G-77");
  });

  test("a caveat survives so it can be relayed verbatim", () => {
    const b = buildOverlayEntry({ ...base, name: "X", caveat: "Donor-advised fund, no open application." });
    expect(b.fields.caveat).toBe("Donor-advised fund, no open application.");
  });
});

describe("access mode on a verification", () => {
  const base = { kind: "funder" as const, source_url: "https://f.org/grants", base_id: "340714588" };

  test("a recorded access mode reaches fields", () => {
    const b = buildOverlayEntry({ ...base, title: "A Fund", access_mode: "invitation_only",
      access_note: '"We do not accept unsolicited proposals" — Grants page' });
    expect(b.fields.access_mode).toBe("invitation_only");
    expect(b.fields.access_note).toContain("unsolicited");
  });

  test("leaving it blank leaves the base record alone, like every other field", () => {
    const b = buildOverlayEntry({ ...base, title: "A Fund", name: "A Fund", access_mode: "" });
    expect("access_mode" in b.fields).toBe(false);
  });

  test("'unknown' records nothing rather than overwriting a known answer with a shrug", () => {
    const b = buildOverlayEntry({ ...base, title: "A Fund", name: "A Fund", access_mode: "unknown" });
    expect("access_mode" in b.fields).toBe(false);
  });

  test("a value not in the vocabulary is rejected, not stored", () => {
    expect(() => buildOverlayEntry({ ...base, title: "A", access_mode: "probably_fine" }))
      .toThrow(/access mode/i);
  });
});
