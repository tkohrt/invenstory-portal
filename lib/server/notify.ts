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
          html: `<p>${line}</p><p><a href="${APP_URL}/library">Open the portal</a></p>`,
        }),
      });
    } catch { /* email best-effort */ }
  }

  if (SLACK_WEBHOOK) {
    try {
      await fetch(SLACK_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `:inbox_tray: *New client upload* — ${line}  <${APP_URL}/library|Open portal>` }),
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
