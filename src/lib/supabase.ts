import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseUrl } from "@/lib/supabase-url";

const url = getSupabaseUrl();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Browser-safe Supabase client. RLS protects every user-owned row. */
export const supabase = url && anonKey ? createBrowserClient(url, anonKey) : null;
