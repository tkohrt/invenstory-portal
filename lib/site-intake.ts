// Shared rules for the forgranted.com intake routes (/api/site/event and
// /api/site/cart). The public website is a static page on another host, so
// these routes are the only way in: they accept a small, fixed vocabulary and
// throw everything else away.

/** The cards a visitor can put in the Interest Cart, as the site names them. */
export const SITE_CARDS: Record<string, string> = {
  inv: "Inven(s)tory Build",
  portal: "The Portal",
  full: "End-to-End Management",
  events: "Events & Convenings",
  gifts: "Individual & Major Gifts",
  film: "Story Capture & Film",
  impact: "Impact Reporting",
  programs: "Program & Curriculum Design",
  gaas: "Grants as a Service",
  unsure: "Not sure yet: help me choose",
};

/** Interactions the site may log. Anything else is dropped. */
export const SITE_EVENTS = new Set([
  "page_view",
  "card_pickup", "card_add", "card_remove",
  "cart_form_start", "cart_submit", "cart_submit_error",
  "founder_connect",
  "demo_card_placed", "demo_weave", "demo_bridge_accept", "demo_polish_gate", "demo_gate_click",
  "inv_card_drag",
]);

const ORIGINS = new Set([
  "https://forgranted.com",
  "https://www.forgranted.com",
]);

/** CORS headers for a site request: only forgranted.com may read the answer. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ORIGINS.has(origin) || /^https:\/\/[a-z0-9-]+--forgranted\.netlify\.app$/.test(origin);
  return allowed
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" }
    : { "Vary": "Origin" };
}

/** Keep event properties small and flat: short strings, numbers and booleans only. */
export function cleanProps(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 8)) {
    if (!/^[a-z_]{1,24}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 80);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
