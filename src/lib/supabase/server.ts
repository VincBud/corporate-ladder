import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "./config";

/**
 * Request-scoped client acting as the signed-in player (publishable key +
 * session cookies). Row Level Security applies to everything it reads.
 * Create one per request; never share between requests.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a context that can't set cookies; the proxy refreshes sessions.
        }
      },
    },
  });
}

/** The verified signed-in user (checked with Supabase Auth, not just decoded), or null. */
export async function getVerifiedUser(client: SupabaseClient): Promise<User | null> {
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}
