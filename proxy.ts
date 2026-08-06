// Next 16 middleware (proxy.ts, playbook error #4). Refreshes the Supabase
// session cookie and guards routes before any page renders. Deep authz
// (admin role-table membership) is enforced in the pages/actions via RLS +
// getSession; this layer does the coarse gate + session refresh.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC = ["/", "/auth"];

export async function proxy(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC.some(p => path === p || path.startsWith("/auth"));
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/?error=" + encodeURIComponent("Please sign in."), req.url));
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\..*).*)"],
};
