import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isCrossSiteWrite } from "@/lib/same-origin";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

/**
 * Rejects cross-site writes to the API, and keeps Supabase sessions fresh:
 * refreshes expiring auth tokens and writes the updated cookies to the
 * response. Authorization happens in the route handlers, not here.
 */
export async function proxy(request: NextRequest) {
  // State-changing API calls must come from this site (CSRF defense in depth).
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    isCrossSiteWrite({
      method: request.method,
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    })
  ) {
    return NextResponse.json({ error: { code: "cross_site_request", message: "Cross-site requests are not allowed." } }, { status: 403 });
  }

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
