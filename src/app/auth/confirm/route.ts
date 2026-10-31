import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Landing point for links in Supabase auth emails (sign-up confirmation and
 * password recovery). Supports both the token-hash template and the PKCE code
 * flow. Always redirects to the desktop root, never to a caller-supplied URL.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const target = new URL("/", url.origin);
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    target.searchParams.set("auth", "unavailable");
    return NextResponse.redirect(target);
  }

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const recovery = type === "recovery" || url.searchParams.get("flow") === "recovery";
  target.searchParams.set("auth", !ok ? "error" : recovery ? "recovery" : "confirmed");
  return NextResponse.redirect(target);
}
