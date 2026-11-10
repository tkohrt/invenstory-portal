// Handles BOTH ?code= (PKCE, same-browser) and ?token_hash= (cross-browser
// magic links / recovery) — playbook error #11.
import { NextRequest, NextResponse } from "next/server";
import { userClient } from "@/lib/server/supabase";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Only a same-origin path may follow the sign-in (red-team M2, 9 Nov 2026).
 * An absolute or protocol-relative `next` ("https://evil.example", "//evil")
 * would win over the base in `new URL(next, origin)`, turning a recovery
 * link into an open redirect onto an attacker's password form.
 */
function safeNext(raw: string | null): string {
  const n = raw ?? "";
  return n.startsWith("/") && !n.startsWith("//") && !n.includes(":") && !n.includes("\\") ? n : "/invenstory";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await userClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL("/?error=" + encodeURIComponent("That link is invalid or expired."), url.origin));
}
