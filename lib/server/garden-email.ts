import "server-only";
// Garden email system — BUILT BUT DISABLED. All real sending is gated behind
// GROWTH_EMAILS_ENABLED=true (currently unset). Until then, only the admin test
// route may send, and only to info@forgranted.com.
import { db } from "./db";
import { getGardenState } from "./garden";
import type { GardenState } from "@/lib/types";

const RESEND_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.forgranted.com";
export const GROWTH_EMAILS_ENABLED = process.env.GROWTH_EMAILS_ENABLED === "true";

const SPECIES_NAME: Record<string, string> = { pothos: "Golden Pothos", monstera: "Monstera", spider: "Spider Plant" };
const HEALTH_LINE: Record<string, string> = {
  thriving: "is thriving — leaves up, story fresh.",
  okay: "is doing okay, but could use a drink soon.",
  thirsty: "is looking thirsty — a quick upload perks it right up.",
};

// Simple inline-styled HTML (email-safe). The plant is rendered as a friendly
// emoji header rather than SVG (broadest client support).
export function buildGrowthReportHtml(orgName: string, g: GardenState): { subject: string; html: string } {
  const sp = SPECIES_NAME[g.species ?? "pothos"];
  const subject = g.health === "thirsty"
    ? `Your ${sp} misses you, ${orgName} 🌱`
    : `${orgName}'s Inven(s)tory Growth Report 🌿`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A">
    <div style="text-align:center;font-size:44px;margin:18px 0 4px">${g.health === "thirsty" ? "🥀" : g.size === 3 ? "🪴" : "🌱"}</div>
    <h2 style="text-align:center;margin:0 0 4px;font-weight:600">${orgName}'s Inven(s)tory Garden</h2>
    <p style="text-align:center;color:#666;margin:0 0 18px">Your ${sp} ${HEALTH_LINE[g.health]}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr>
        <td style="text-align:center;padding:10px;border:1px solid #eee;border-radius:8px"><b style="font-size:20px">${g.stats.docs}</b><br/><span style="color:#888;font-size:12px">documents</span></td>
        <td style="text-align:center;padding:10px;border:1px solid #eee"><b style="font-size:20px">${g.stats.words.toLocaleString()}</b><br/><span style="color:#888;font-size:12px">words captured</span></td>
        <td style="text-align:center;padding:10px;border:1px solid #eee"><b style="font-size:20px">${g.stats.layersCovered}/3</b><br/><span style="color:#888;font-size:12px">layers covered</span></td>
        <td style="text-align:center;padding:10px;border:1px solid #eee"><b style="font-size:20px">${g.size}</b><br/><span style="color:#888;font-size:12px">plant size</span></td>
      </tr>
    </table>
    <div style="background:#f2f8f2;border:1px solid #d9e6d9;border-radius:10px;padding:14px 16px;margin-bottom:18px">
      <b style="color:#2f5d38">🌱 ${g.prompt.text}</b>
    </div>
    <div style="text-align:center;margin-bottom:22px">
      <a href="${APP_URL}/invenstory" style="background:#1A1A1A;color:#fff;text-decoration:none;padding:11px 26px;border-radius:8px;font-size:14px">Water your Inven(s)tory</a>
    </div>
    <p style="color:#999;font-size:11.5px;text-align:center">For Granted — find your story, fund your mission.<br/>You receive this because your organization has an Inven(s)tory on the For Granted portal.</p>
  </div>`;
  return { subject, html };
}

export function buildMilestoneHtml(orgName: string, achKey: string, unlocked: string | null): { subject: string; html: string } {
  const NAMES: Record<string, string> = {
    docs_5: "5 documents", docs_10: "10 documents", docs_20: "20 documents", docs_50: "50 documents",
    all_layers: "all three layers covered", size_2: "your plant grew to size 2", size_3: "your plant is flourishing at size 3",
    age_6mo: "6 months of growing together", age_1yr: "one full year of growing together",
    grant_submitted: "a grant application submitted", grant_won: "a grant WON 🎉",
  };
  const what = NAMES[achKey] ?? achKey;
  const subject = `Milestone reached: ${what} 🏆`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A;text-align:center">
    <div style="font-size:44px;margin:18px 0 4px">🏆</div>
    <h2 style="margin:0 0 6px;font-weight:600">${orgName} just hit a milestone</h2>
    <p style="color:#555;margin:0 0 14px">${what.charAt(0).toUpperCase() + what.slice(1)} — your Inven(s)tory keeps compounding.</p>
    ${unlocked ? `<p style="background:#fdf6e3;border:1px solid #eadfc0;border-radius:10px;padding:12px;display:inline-block">🪴 You unlocked: <b>${unlocked}</b> — try it on your plant.</p>` : ""}
    <div style="margin:18px 0 22px"><a href="${APP_URL}/invenstory" style="background:#1A1A1A;color:#fff;text-decoration:none;padding:11px 26px;border-radius:8px;font-size:14px">See your garden</a></div>
    <p style="color:#999;font-size:11.5px">For Granted — find your story, fund your mission.</p>
  </div>`;
  return { subject, html };
}

async function send(to: string[], subject: string, html: string): Promise<boolean> {
  if (!RESEND_KEY) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "For Granted Portal <noreply@forgranted.com>", to, subject, html }),
  });
  return r.ok;
}

// Real client sending (monthly digest): HARD-GATED. Not scheduled anywhere yet.
export async function sendGrowthReports(): Promise<{ sent: number; skipped: string }> {
  if (!GROWTH_EMAILS_ENABLED) return { sent: 0, skipped: "GROWTH_EMAILS_ENABLED is not true — no client emails sent" };
  const { data: tenants } = await db.from("tenant").select("id, name");
  let sent = 0;
  for (const t of tenants ?? []) {
    const { data: contact } = await db.from("app_user").select("email").eq("tenant_id", t.id).eq("role", "client").order("created_at").limit(1).maybeSingle();
    if (!contact?.email) continue;
    const g = await getGardenState(t.id);
    if (g.hidden) continue;
    const { subject, html } = buildGrowthReportHtml(t.name, g);
    if (await send([contact.email], subject, html)) sent++;
  }
  return { sent, skipped: "" };
}

// Test sending — ALWAYS to info@forgranted.com only, regardless of flag.
export async function sendTestGrowthEmails(tenantId: string): Promise<{ ok: boolean }> {
  const { data: t } = await db.from("tenant").select("name").eq("id", tenantId).single();
  const g = await getGardenState(tenantId);
  const report = buildGrowthReportHtml(t?.name ?? "Client", g);
  const milestone = buildMilestoneHtml(t?.name ?? "Client", "docs_5", "the Glazed pot");
  const a = await send(["info@forgranted.com"], `[TEST] ${report.subject}`, report.html);
  const b = await send(["info@forgranted.com"], `[TEST] ${milestone.subject}`, milestone.html);
  return { ok: a && b };
}
