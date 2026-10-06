// The Monday digest (client activity, patch 3, 6 October 2026).
import { describe, expect, test } from "vitest";
import { renderDigest, weekLabel, type DigestData } from "@/lib/digest";

const base: DigestData = {
  weekStart: "2026-10-05T04:00:00.000Z", weekEnd: "2026-10-12T04:00:00.000Z",
  clients: [
    { tenantId: "t1", name: "RE-Assist", people: 2, activePeople: 1, visits: 9, questions: 41, docsClient: 1, docsFG: 2, spendClient: 0.4, spendTotal: 1.4, milestones: ["Inven(s)tory analysed"] },
    { tenantId: "t2", name: "Quiet <Org>", people: 1, activePeople: 0, visits: 0, questions: 0, docsClient: 0, docsFG: 0, spendClient: 0, spendTotal: 0, milestones: [] },
  ],
  stalled: [{ tenantId: "t1", client: "RE-Assist", draftId: "d1", title: "Forest Park & Co", funder: "City", deadline: "2026-10-20", daysToDeadline: 8, idleDays: 9, pastDue: false, status: "drafting" }],
  dueSoon: [],
  requests: [{ tenantId: "t1", client: "RE-Assist", what: "more chat questions this month", by: "Ashley Barrow", at: "2026-10-09T15:00:00Z" }],
  spend: { client: 0.4, admin: 1, system: 0, total: 1.4 },
};

describe("the Monday digest", () => {
  test("the week reads Monday to Sunday", () => {
    expect(weekLabel(base.weekStart, base.weekEnd)).toBe("Oct 5 to Oct 11, 2026");
  });
  test("stalled drafts lead the subject; everything is in both email and Slack", () => {
    const r = renderDigest(base, "https://portal.forgranted.com");
    expect(r.subject).toBe("Portal digest, week of Oct 5 to Oct 11, 2026: 1 stalled draft");
    for (const t of [r.html, r.slack]) {
      expect(t).toContain("due in 8 days, no change for 9 days");
      expect(t).toContain("asked for more chat questions this month");
      expect(t).toContain("Inven(s)tory analysed");
      expect(t).toContain("9 visits, 41 questions");
      expect(t).toContain("https://portal.forgranted.com/admin/clients/t1");
    }
  });
  test("names are escaped, and quiet clients are listed apart", () => {
    const r = renderDigest(base, "https://portal.forgranted.com");
    expect(r.html).toContain("Forest Park &amp; Co");
    expect(r.html).toContain("No activity: Quiet &lt;Org&gt;.");
    expect(r.slack).toContain("_No activity: Quiet &lt;Org&gt;._");
    expect(r.html).not.toContain("<Org>");
  });
  test("an empty week still says so, and never uses em dashes", () => {
    const r = renderDigest({ ...base, clients: [], stalled: [], requests: [], spend: { client: 0, admin: 0, system: 0, total: 0 } }, "https://x");
    expect(r.subject).toBe("Portal digest, week of Oct 5 to Oct 11, 2026");
    expect(r.html).toContain("No requests waiting.");
    expect(r.slack).toContain("No client activity.");
    expect(r.html + r.slack).not.toContain("—");
  });
});
