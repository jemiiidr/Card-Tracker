import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiSession, unauthorized } from "@/lib/api-session";

const settingsSchema = z.object({
  displayName: z.string().trim().min(2).max(60),
  email: z.string().trim().email().max(254),
  password: z.union([z.string().min(8).max(128), z.literal("")]),
}).strict();

export async function PATCH(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();

  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid settings request." }, { status: 400 }); }

  const parsed = settingsSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check your account details." }, { status: 400 });
  }

  const { displayName, email, password } = parsed.data;
  const authChanges: { email?: string; password?: string; data?: Record<string, string> } = {
    data: { display_name: displayName },
  };
  if (email.toLowerCase() !== (session.user.email || "").toLowerCase()) authChanges.email = email;
  if (password) authChanges.password = password;

  if (Object.keys(authChanges).length > 1 || authChanges.data) {
    const { error } = await session.supabase.auth.updateUser(authChanges);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { error: profileError } = await session.supabase.from("profiles")
    .update({ display_name: displayName }).eq("id", session.user.id);
  if (profileError) return NextResponse.json({ error: "Could not save your profile. Please try again." }, { status: 500 });

  return NextResponse.json({
    displayName,
    email: email.toLowerCase() === (session.user.email || "").toLowerCase() ? session.user.email : email,
    emailChangePending: Boolean(authChanges.email),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } });
}
