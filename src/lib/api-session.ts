import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function getApiSession() {
  try {
    const supabase = createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return { supabase, user };
  } catch { return null; }
}

export const unauthorized = () => NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });
