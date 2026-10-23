import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseUrl } from "@/lib/supabase-url";

export async function middleware(request: NextRequest) {
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const url = getSupabaseUrl();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    const response = NextResponse.next();
    if (isApi) response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    return response;
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  const isLogin = request.nextUrl.pathname === "/login";
  if (!user && !isLogin) {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    if (isApi) redirect.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    return redirect;
  }
  if (user && isLogin) return NextResponse.redirect(new URL("/", request.url));
  if (isApi) response.headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/callback).*)"] };
