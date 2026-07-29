import "server-only";
// Per-request Supabase clients.
// - userClient: carries the signed-in user's session cookie, so ALL reads run
//   under RLS as that user. This is what replaces the Phase 3 service-role
//   scaffold for user-facing data.
// - db (service role, in db.ts) is now reserved for: the ingestion worker and
//   admin cross-tenant aggregates only.
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function userClient() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (list) => { try { list.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* called from a Server Component; middleware refreshes */ } },
      },
    }
  );
}
