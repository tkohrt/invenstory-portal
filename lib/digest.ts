// The Monday digest (client activity, patch 3; decided 6 October 2026).
//
// Every Monday morning For Granted gets last week across all clients, by email
// (info@forgranted.com) and in Slack: drafts stalled near a deadline, deadlines
// coming up, requests waiting, last week's activity and AI spend per client, and
// the getting-started milestones reached. The other red flags and the health
// score are on hold (decision 27), so nothing here grades a client.
//
// Pure: the server gathers the numbers, this turns them into the email and the
// Slack message, so both always say the same thing. Counts only, never chat text.

export interface DigestClient {
  tenantId: string; name: string;
  people: number; activePeople: number; visits: number; questions: number;
  docsClient: number; docsFG: number;
  spendClient: number; spendTotal: number;
  /** Milestones reached during the week. */
  milestones: string[];
}
export interface DigestDraft {
  tenantId: string; client: string; draftId: string; title: string; funder: string | null;
  deadline: string; daysToDeadline: number; idleDays?: number; pastDue?: boolean; status: string;
}
export interface DigestRequest { tenantId: string; client: string; what: string; by: string; at: string }
export interface DigestData {
  weekStart: string; weekEnd: string;
  clients: DigestClient[];
  stalled: DigestDraft[];
  dueSoon: DigestDraft[];
  requests: DigestRequest[];
  spend: { client: number; admin: number; system: number; total: number };
}

export const DUE_SOON_DAYS = 30;

const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slackEsc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "5 Oct to 11 Oct 2026": the week's Monday to its Sunday, Eastern. */
export function weekLabel(startIso: string, endIso: string): string {
  const f = (d: Date, year: boolean) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
  const lastDay = new Date(new Date(endIso).getTime() - 3600_000);
  return `${f(new Date(startIso), false)} to ${f(lastDay, true)}`;
}

function deadlineText(d: DigestDraft): string {
  if (d.pastDue) return `${-d.daysToDeadline} days past due`;
  return d.daysToDeadline <= 0 ? "due today" : d.daysToDeadline === 1 ? "due tomorrow" : `due in ${d.daysToDeadline} days`;
}

function activityLine(c: DigestClient): string {
  const parts = [
    `${c.activePeople} of ${c.people} people active`,
    plural(c.visits, "visit"),
    plural(c.questions, "question"),
    `${c.docsClient + c.docsFG} documents added (${c.docsClient} by the client)`,
    `${usd(c.spendClient)} AI by the client, ${usd(c.spendTotal)} in all`,
  ];
  return parts.join(", ");
}

export function renderDigest(d: DigestData, appUrl: string): { subject: string; html: string; slack: string } {
  const week = weekLabel(d.weekStart, d.weekEnd);
  const clientUrl = (id: string) => `${appUrl}/admin/clients/${id}`;
  const subject = `Portal digest, week of ${week}`
    + (d.stalled.length ? `: ${plural(d.stalled.length, "stalled draft")}` : "");
  // Clients with something to show first, then the quiet ones, by name.
  const clients = [...d.clients].sort((a, b) => {
    const busy = (c: DigestClient) => c.visits + c.questions + c.docsClient + c.docsFG;
    return (busy(b) > 0 ? 1 : 0) - (busy(a) > 0 ? 1 : 0) || a.name.localeCompare(b.name);
  });
  const quiet = clients.filter(c => c.visits + c.questions + c.docsClient + c.docsFG === 0);
  const busy = clients.filter(c => !quiet.includes(c));
  const milestones = clients.flatMap(c => c.milestones.map(m => ({ client: c, m })));

  // ---- Email ----
  const h2 = (t: string) => `<h2 style="font:600 16px Georgia,serif;color:#1f4d2e;margin:22px 0 8px">${esc(t)}</h2>`;
  const p = (t: string) => `<p style="margin:4px 0;font:14px/1.5 Arial,sans-serif;color:#222">${t}</p>`;
  const li = (items: string[]) => `<ul style="margin:4px 0 0 18px;padding:0;font:14px/1.5 Arial,sans-serif;color:#222">${items.map(i => `<li style="margin:3px 0">${i}</li>`).join("")}</ul>`;
  const a = (href: string, t: string) => `<a href="${esc(href)}" style="color:#1f4d2e">${esc(t)}</a>`;
  const draftItem = (x: DigestDraft, stalled: boolean) =>
    `<b>${esc(x.title)}</b>${x.funder ? `, ${esc(x.funder)}` : ""} (${a(clientUrl(x.tenantId), x.client)}): ${deadlineText(x)}`
    + (stalled && x.idleDays != null ? `, no change for ${x.idleDays} days` : "");

  let html = `<div style="max-width:640px">`
    + `<h1 style="font:600 20px Georgia,serif;color:#1f4d2e;margin:0 0 4px">Portal digest</h1>`
    + p(`<span style="color:#666">Week of ${esc(week)}, Eastern time. Counts only.</span>`);

  html += h2("Stalled drafts near a deadline");
  html += d.stalled.length ? li(d.stalled.map(x => draftItem(x, true))) : p("None.");

  html += h2(`Deadlines in the next ${DUE_SOON_DAYS} days`);
  html += d.dueSoon.length ? li(d.dueSoon.map(x => draftItem(x, false))) : p("None.");

  html += h2("Waiting on For Granted");
  html += d.requests.length
    ? li(d.requests.map(r => `${esc(r.by)} (${a(clientUrl(r.tenantId), r.client)}) asked for ${esc(r.what)}`))
    : p("No requests waiting.");

  html += h2("Milestones reached");
  html += milestones.length ? li(milestones.map(({ client, m }) => `${a(clientUrl(client.tenantId), client.name)}: ${esc(m)}`)) : p("None this week.");

  html += h2("Last week, by client");
  html += busy.length ? li(busy.map(c => `${a(clientUrl(c.tenantId), c.name)}: ${esc(activityLine(c))}`)) : p("No client activity.");
  if (quiet.length) html += p(`<span style="color:#666">No activity: ${quiet.map(c => esc(c.name)).join(", ")}.</span>`);

  html += h2("AI spend last week");
  html += p(`${usd(d.spend.total)} in all: ${usd(d.spend.client)} caused by clients, ${usd(d.spend.admin)} by For Granted, ${usd(d.spend.system)} background.`);

  html += `<p style="margin:22px 0 0;font:13px Arial,sans-serif">${a(`${appUrl}/admin/clients`, "Open All Clients in the portal")}</p></div>`;

  // ---- Slack ----
  const link = (href: string, t: string) => `<${href}|${slackEsc(t)}>`;
  const sDraft = (x: DigestDraft, stalled: boolean) =>
    `• *${slackEsc(x.title)}*${x.funder ? `, ${slackEsc(x.funder)}` : ""} (${link(clientUrl(x.tenantId), x.client)}): ${deadlineText(x)}`
    + (stalled && x.idleDays != null ? `, no change for ${x.idleDays} days` : "");
  const lines: string[] = [`:calendar: *Portal digest*, week of ${week} (Eastern)`];
  lines.push("", `*Stalled drafts near a deadline*`, ...(d.stalled.length ? d.stalled.map(x => sDraft(x, true)) : ["None."]));
  lines.push("", `*Deadlines in the next ${DUE_SOON_DAYS} days*`, ...(d.dueSoon.length ? d.dueSoon.map(x => sDraft(x, false)) : ["None."]));
  lines.push("", `*Waiting on For Granted*`, ...(d.requests.length
    ? d.requests.map(r => `• ${slackEsc(r.by)} (${link(clientUrl(r.tenantId), r.client)}) asked for ${slackEsc(r.what)}`) : ["No requests waiting."]));
  lines.push("", `*Milestones reached*`, ...(milestones.length
    ? milestones.map(({ client, m }) => `• ${link(clientUrl(client.tenantId), client.name)}: ${slackEsc(m)}`) : ["None this week."]));
  lines.push("", `*Last week, by client*`, ...(busy.length
    ? busy.map(c => `• ${link(clientUrl(c.tenantId), c.name)}: ${slackEsc(activityLine(c))}`) : ["No client activity."]));
  if (quiet.length) lines.push(`_No activity: ${quiet.map(c => slackEsc(c.name)).join(", ")}._`);
  lines.push("", `*AI spend last week:* ${usd(d.spend.total)} (${usd(d.spend.client)} clients, ${usd(d.spend.admin)} For Granted, ${usd(d.spend.system)} background)`);
  lines.push(link(`${appUrl}/admin/clients`, "Open All Clients"));

  return { subject, html, slack: lines.join("\n") };
}
