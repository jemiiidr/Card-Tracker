import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Browser-safe Supabase client. RLS protects every user-owned row. */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
