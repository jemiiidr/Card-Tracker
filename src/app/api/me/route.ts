import { NextResponse } from "next/server";
import { getApiSession, unauthorized } from "@/lib/api-session";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  const { data, error } = await session.supabase.from("profiles").select("id,display_name,is_store_owner").eq("id", session.user.id).single();
  if (error) {
    const missingProfiles = error.code === "PGRST205" || error.message.includes("public.profiles");
    if (missingProfiles) return NextResponse.json({ error: "Supabase setup is incomplete: run supabase/schema.sql in your Supabase project's SQL Editor, then refresh the schema cache." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ user: { id: session.user.id, email: session.user.email }, profile: data });
}
