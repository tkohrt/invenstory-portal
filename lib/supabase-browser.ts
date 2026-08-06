import { createBrowserClient } from "@supabase/ssr";
// Browser Supabase client — used for MFA enrollment (session-based auth ops
// that must run client-side). Reads the session from cookies.
export function browserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
