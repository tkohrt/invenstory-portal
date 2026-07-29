// Handles BOTH ?code= (PKCE, same-browser) and ?token_hash= (cross-browser
// magic links / recovery) — playbook error #11.
import { NextRequest, NextResponse } from "next/server";
import { userClient } from "@/lib/server/supabase";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/library";
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
