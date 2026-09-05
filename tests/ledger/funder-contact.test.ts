/**
 * Contacts go stale silently, which is the whole risk.
 *
 * A program officer who left eighteen months ago still looks like a lead unless
 * the interface says how old the fact is. These tests pin the parts that keep
 * that honest, plus the vocabulary the database constrains.
 */
import { describe, expect, test } from "vitest";
import {
  buildContact, freshness, sortContacts, primaryContact,
  ROLE_LABEL, CONTACT_ROLES, SOURCE_LABEL, SOURCE_TYPES, STALE_AFTER_DAYS,
  type ContactRecord,
} from "@/lib/funder-contact";
import { normalizeEin } from "@/lib/ein";

const NOW = new Date("2026-09-05T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const c = (o: Partial<ContactRecord>): ContactRecord => ({
  id: "1", ein: "346519769", name: "Alex Rivera", title: "Program Officer",
  role: "program_officer", portfolio: null, email: null, phone: null,
  source_type: "funder_site", source_url: null, note: null,
  status: "active", last_verified_at: ago(10), ...o,
});

describe("freshness", () => {
  test("a recent check is not stale", () => {
    const f = freshness(ago(20), NOW);
    expect(f.stale).toBe(false);
    expect(f.label).toBe("checked 20d ago");
  });

  test("months, once days stop being useful", () => {
    expect(freshness(ago(95), NOW).label).toBe("checked 3 months ago");
  });

  test("past a year it is stale and says so in years", () => {
    const f = freshness(ago(400), NOW);
    expect(f.stale).toBe(true);
    expect(f.label).toContain("years ago");
  });

  test("the boundary is a year, not a round number of months", () => {
    expect(freshness(ago(STALE_AFTER_DAYS), NOW).stale).toBe(false);
    expect(freshness(ago(STALE_AFTER_DAYS + 1), NOW).stale).toBe(true);
  });

  test("an unparseable date reads as stale rather than fresh", () => {
    // Failing open here would present an unknown-age contact as just-checked.
    const f = freshness("not a date", NOW);
    expect(f.stale).toBe(true);
  });
});

describe("sortContacts", () => {
  test("a program officer outranks a trustee", () => {
    // Trustees are governance. Useful for board mapping, never a cold letter.
    const out = sortContacts([
      c({ id: "t", name: "A Trustee", role: "trustee" }),
      c({ id: "p", name: "Zed Officer", role: "program_officer" }),
    ]);
    expect(out[0].id).toBe("p");
  });

  test("departed people sink but are not dropped", () => {
    // Knowing the person you were told to contact has left is itself useful.
    const out = sortContacts([
      c({ id: "gone", role: "program_officer", status: "departed" }),
      c({ id: "here", role: "grants_manager" }),
    ]);
    expect(out.map(x => x.id)).toEqual(["here", "gone"]);
    expect(out).toHaveLength(2);
  });

  test("within a role, the more recently confirmed comes first", () => {
    const out = sortContacts([
      c({ id: "old", name: "A", last_verified_at: ago(300) }),
      c({ id: "new", name: "B", last_verified_at: ago(5) }),
    ]);
    expect(out[0].id).toBe("new");
  });

  test("the input array is not mutated", () => {
    const input = [c({ id: "1", role: "trustee" }), c({ id: "2", role: "program_officer" })];
    sortContacts(input);
    expect(input.map(x => x.id)).toEqual(["1", "2"]);
  });
});

describe("primaryContact", () => {
  test("picks the best live contact", () => {
    expect(primaryContact([
      c({ id: "t", role: "trustee" }),
      c({ id: "p", name: "Other", role: "program_officer" }),
    ])?.id).toBe("p");
  });

  test("never returns somebody who has left", () => {
    expect(primaryContact([c({ status: "departed" })])).toBeNull();
  });

  test("no contacts is null, not a throw", () => {
    expect(primaryContact([])).toBeNull();
  });
});

describe("buildContact", () => {
  const ok = { ein: "34-6519769", name: "Alex Rivera" };

  test("the EIN is normalized so a contact joins its funder however it was spelled", () => {
    expect(buildContact(ok, normalizeEin).ein).toBe("346519769");
  });

  test("a contact with no funder is refused", () => {
    expect(() => buildContact({ ein: "", name: "X" }, normalizeEin)).toThrow(/funder/i);
  });

  test("a nameless contact is refused", () => {
    expect(() => buildContact({ ein: "1", name: "  " }, normalizeEin)).toThrow(/name/i);
  });

  test("a name and nothing else is enough", () => {
    // Demanding an email would mean the call notes never get entered at all.
    const r = buildContact(ok, normalizeEin);
    expect(r.name).toBe("Alex Rivera");
    expect(r.email).toBeNull();
    expect(r.role).toBe("unknown");
    expect(r.status).toBe("active");
  });

  test("a role outside the vocabulary is refused, because the database constrains it", () => {
    expect(() => buildContact({ ...ok, role: "chief_vibes" }, normalizeEin)).toThrow(/role/i);
  });

  test("a source outside the vocabulary is refused too", () => {
    expect(() => buildContact({ ...ok, source_type: "a hunch" }, normalizeEin)).toThrow(/came from/i);
  });

  test("a phone number pasted into the email box is caught", () => {
    expect(() => buildContact({ ...ok, email: "216.241.3114" }, normalizeEin)).toThrow(/email/i);
  });

  test("a real email passes", () => {
    expect(buildContact({ ...ok, email: "info@gundfdn.org" }, normalizeEin).email).toBe("info@gundfdn.org");
  });

  test("blank optional fields become null rather than empty strings", () => {
    const r = buildContact({ ...ok, title: "  ", portfolio: "" }, normalizeEin);
    expect(r.title).toBeNull();
    expect(r.portfolio).toBeNull();
  });
});

describe("vocabulary", () => {
  test("every role and source has a label", () => {
    for (const r of CONTACT_ROLES) expect(ROLE_LABEL[r]).toBeTruthy();
    for (const s of SOURCE_TYPES) expect(SOURCE_LABEL[s]).toBeTruthy();
  });
});
