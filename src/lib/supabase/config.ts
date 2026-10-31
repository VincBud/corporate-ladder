/**
 * Public Supabase configuration (safe to ship to browsers). The secret key is
 * read only in lib/supabase/admin.ts, which is server-only.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so they must be referenced
 * literally here.
 */
export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/** False when no Supabase project is configured: the app then runs guest-only. */
export function isSupabaseConfigured(): boolean {
  return getSupabasePublicConfig() !== null;
}
