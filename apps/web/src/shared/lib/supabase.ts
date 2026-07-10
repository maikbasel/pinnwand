import type { Database } from "@pinnwand/contracts";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/app/env";

// Explicit storage key so e2e/test helpers can install a session under the same
// key the app reads from, independent of the URL host.
export const SUPABASE_AUTH_STORAGE_KEY = "sb-pinnwand-auth-token";

export const supabase = createClient<Database>(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  }
);

export type SupabaseClient = typeof supabase;
