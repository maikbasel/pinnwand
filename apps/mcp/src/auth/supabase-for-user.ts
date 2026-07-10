import type { Database } from "@pinnwand/contracts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

/**
 * Per-request, user-scoped Supabase client. Authenticates via the caller's
 * bearer JWT (never the service role key) so RLS remains the only
 * authorization boundary.
 */
export function supabaseForUser(token: string): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
