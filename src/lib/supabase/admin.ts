import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";

let admin: SupabaseClient | null | undefined;

/**
 * Privileged client (secret / service-role key). Server-only: used solely to
 * call the trusted SQL functions that create sessions, record hints and
 * finalize results. Never import this from client code.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (admin === undefined) {
    const config = getSupabasePublicConfig();
    const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    admin =
      config && secret
        ? createClient(config.url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
        : null;
  }
  return admin;
}
