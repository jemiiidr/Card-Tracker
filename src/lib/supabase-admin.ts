import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "@/lib/supabase-url";

/** Server-only elevated client. Call only after validating the signed-in user. */
export function createSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY for server-side writes.");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
