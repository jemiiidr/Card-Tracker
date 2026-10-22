import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseUrl } from "@/lib/supabase-url";

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const url = getSupabaseUrl();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.");
  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value; },
      set(name: string, value: string, options: Record<string, unknown>) {
        try { cookieStore.set({ name, value, ...(options as any) }); } catch { /* Middleware refreshes cookies on server components. */ }
      },
      remove(name: string, options: Record<string, unknown>) {
        try { cookieStore.set({ name, value: "", ...(options as any) }); } catch { /* Middleware refreshes cookies on server components. */ }
      },
    },
  });
}
