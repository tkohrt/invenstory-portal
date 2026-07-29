import "server-only";
// Service-role client. NEVER importable client-side ('server-only' enforces).
// PHASE 3 NOTE (temporary, replaced in Phase 4): queries in data.ts filter by
// tenant explicitly because mock sessions carry no auth.uid() for RLS to use.
// Phase 4 switches user-facing reads to cookie-authenticated clients so RLS
// itself enforces tenancy; the service client remains only for worker/admin
// aggregate paths, per the FundStuff pattern.
import { createClient } from "@supabase/supabase-js";

if (typeof window !== "undefined") throw new Error("db.ts imported client-side");

export const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
