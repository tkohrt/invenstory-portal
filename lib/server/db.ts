import "server-only";
// Service-role client, lazily initialized. Reserved for the ingestion worker and
// admin cross-tenant aggregates (user-facing reads use userClient() under RLS).
// Lazy init so importing this module during build never requires env at build time.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") throw new Error("db.ts imported client-side");

let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return _client;
}

// Transparent proxy: the client is created on first property access (runtime),
// so module import (e.g. during build page-data collection) never throws.
export const db = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const c = client() as unknown as Record<string | symbol, unknown>;
    const v = c[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(client()) : v;
  },
});
