import "server-only";
// Notify the For Granted team when a CLIENT uploads a document: email
// info@forgranted.com (via Resend) and ping the team Slack channel (webhook).
// Both are best-effort — a notification failure never blocks the upload.
const RESEND_KEY = process.env.RESEND_API_KEY;
const SLACK_WEBHOOK = process.env.SLACK_ADMIN_WEBHOOK_URL;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.forgranted.com";

export async function notifyClientUpload(d: { org: string; uploader: string; title: string; layer: string }) {
  const line = `${d.uploader} (${d.org}) uploaded "${d.title}" to Layer ${d.layer}.`;

  if (RESEND_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "For Granted Portal <noreply@forgranted.com>",
          to: ["info@forgranted.com"],
          subject: `New client upload — ${d.org}`,
          html: `<p>${line}</p><p><a href="${APP_URL}/invenstory">Open the portal</a></p>`,
        }),
      });
    } catch { /* email best-effort */ }
  }

  if (SLACK_WEBHOOK) {
    try {
      await fetch(SLACK_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `:inbox_tray: *New client upload* — ${line}  <${APP_URL}/invenstory|Open portal>` }),
      });
    } catch { /* slack best-effort */ }
  }
}

export async function notifyAccountClosure(d: { org: string; requester: string; email: string; reason: string }) {
  const line = `${d.requester} (${d.org}, ${d.email}) requested to close their account.` + (d.reason ? ` Reason: ${d.reason}` : "");
  if (RESEND_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "For Granted Portal <noreply@forgranted.com>", to: ["info@forgranted.com"], subject: `Account closure request — ${d.org}`, html: `<p>${line}</p><p>Follow up with the client to handle offboarding, export, and any contractual wind-down.</p>` }),
      });
    } catch { /* best-effort */ }
  }
  if (SLACK_WEBHOOK) {
    try {
      await fetch(SLACK_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `:warning: *Account closure request* — ${line}` }) });
    } catch { /* best-effort */ }
  }
}

/** A client asked For Granted to run an analysis past the fair-use cap (Phase C). */
export async function notifyAnalysisRequest(d: { org: string; requester: string; note: string | null }) {
  const line = `${d.requester} (${d.org}) asked For Granted to run an Inven(s)tory analysis.` + (d.note ? ` Note: ${d.note}` : "");
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (RESEND_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "For Granted Portal <noreply@forgranted.com>", to: ["info@forgranted.com"],
          subject: `Analysis request: ${d.org}`,
          html: `<p>${esc(line)}</p><p>Switch to ${esc(d.org)} in the portal, then open Admin, Analysis (trial) to approve or decline it.</p><p><a href="${APP_URL}/admin/analysis">Open the portal</a></p>`,
        }),
      });
    } catch { /* best-effort */ }
  }
  if (SLACK_WEBHOOK) {
    try {
      await fetch(SLACK_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `:mag: *Analysis request* ${line}  <${APP_URL}/admin/analysis|Open portal>` }) });
    } catch { /* best-effort */ }
  }
}

/** A client reached an AI usage limit and asked for more (6 October 2026). */
export async function notifyUsageRequest(d: { org: string; requester: string; kind: string }) {
  const what = d.kind === "chat_month" ? "this month's chat questions" : "today's chat questions";
  const line = `${d.requester} (${d.org}) has used ${what} and asked For Granted for more.`;
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (RESEND_KEY) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "For Granted Portal <noreply@forgranted.com>", to: ["info@forgranted.com"],
          subject: `More questions requested: ${d.org}`,
          html: `<p>${esc(line)}</p><p>Grant more on Admin, All Clients, then the client's activity page.</p><p><a href="${APP_URL}/admin/clients">Open the portal</a></p>`,
        }),
      });
    } catch { /* best-effort */ }
  }
  if (SLACK_WEBHOOK) {
    try {
      await fetch(SLACK_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `:speech_balloon: *More questions requested* ${line}  <${APP_URL}/admin/clients|Open portal>` }) });
    } catch { /* best-effort */ }
  }
}
