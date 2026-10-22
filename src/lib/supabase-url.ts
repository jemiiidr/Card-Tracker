/** Supabase clients require the project root URL, not a REST/Auth endpoint URL. */
export function getSupabaseUrl() {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) return undefined;
  try {
    const url = new URL(configured.trim());
    // Be forgiving if a REST/Auth/Storage endpoint URL was pasted from the API docs.
    url.pathname = url.pathname
      .replace(/\/(?:rest|auth|storage)\/v1\/?$/i, "")
      .replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}
