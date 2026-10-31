import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

/**
 * Keeps Supabase sessions fresh: refreshes expiring auth tokens and writes the
 * updated cookies to the response. A pass-through when Supabase isn't
 * configured. Authorization happens in the route handlers, not here.
 */
export async function proxy(request: NextRequest) {
  const config = getSupabasePublicConfig();
  if (!config) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, String(value));
      },
    },
  });
  try {
    await supabase.auth.getClaims();
  } catch {
    // Auth server unreachable: serve the page anyway; API routes re-check the session.
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
