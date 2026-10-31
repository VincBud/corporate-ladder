"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "./config";

let client: SupabaseClient | null | undefined;

/** Browser client (publishable key, RLS applies). Null when Supabase isn't configured. */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (client === undefined) {
    const config = getSupabasePublicConfig();
    client = config ? createBrowserClient(config.url, config.publishableKey) : null;
  }
  return client;
}
