import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const loginUrl = new URL("/login", request.url);
  const returnUrl = new URL("/", request.url);
  const authError = searchParams.get("error_description") || searchParams.get("error");
  if (authError) {
    loginUrl.searchParams.set("authError", authError);
    return NextResponse.redirect(loginUrl);
  }

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  if (code) {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      loginUrl.searchParams.set("authError", error.message);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.redirect(returnUrl);
  }

  const otpTypes: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
  if (tokenHash && type && otpTypes.includes(type as EmailOtpType)) {
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (error) {
      loginUrl.searchParams.set("authError", error.message);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.redirect(returnUrl);
  }

  loginUrl.searchParams.set("authError", "The confirmation link is invalid or has expired. Please sign up or request a new email.");
  return NextResponse.redirect(loginUrl);
}
