import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:8000";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is required for the e2e direct-auth helper"
  );
}
if (!SUPABASE_ANON_KEY) {
  throw new Error(
    "SUPABASE_ANON_KEY is required for the e2e direct-auth helper"
  );
}

export const adminClient: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const anonClient: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

export type AuthenticatedUser = {
  email: string;
  userId: string;
  cleanup: () => Promise<void>;
};

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
}

// Mirror of `SUPABASE_AUTH_STORAGE_KEY` from `src/shared/lib/supabase.ts`.
// Hard-coded here (not imported) because this helper runs in the Playwright
// Node context, which cannot resolve `@/shared/lib/supabase`'s React imports.
const STORAGE_KEY = "sb-pinnwand-auth-token";

export async function createAuthenticatedUser(
  page: Page,
  options: { email?: string; displayName?: string; landOnHome?: boolean } = {}
): Promise<AuthenticatedUser> {
  const email = options.email ?? uniqueEmail();
  // The session is installed via addInitScript, which runs on the test's first
  // real navigation. Pass `landOnHome: false` to install the session without
  // navigating yet (e.g. a test that first visits a join surface). Defaults to
  // true so the common case lands on `/` ready to go.
  const landOnHome = options.landOnHome ?? true;

  const { data: created, error: createErr } =
    await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
    });
  if (createErr || !created.user) {
    throw new Error(
      `admin.createUser failed for ${email}: ${createErr?.message ?? "no user returned"}`
    );
  }
  const userId = created.user.id;

  // The `handle_new_user` trigger has already inserted the matching
  // `public.profiles` row by the time `createUser` returns. When a test needs a
  // deterministic identity string (e.g. asserting an assignee avatar's title),
  // set `display_name` here (the single source of truth for identity) rather
  // than depending on the app's email-derived fallback.
  if (options.displayName) {
    const { error: profileErr } = await adminClient
      .from("profiles")
      .update({ display_name: options.displayName })
      .eq("id", userId);
    if (profileErr) {
      await adminClient.auth.admin.deleteUser(userId);
      throw new Error(
        `profiles.display_name update failed for ${email}: ${profileErr.message}`
      );
    }
  }

  const { data: link, error: linkErr } =
    await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
  if (linkErr || !link.properties?.hashed_token) {
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error(
      `admin.generateLink failed for ${email}: ${linkErr?.message ?? "no hashed_token"}`
    );
  }
  const tokenHash = link.properties.hashed_token;

  // Consume the magic-link token from Node; `verifyOtp({ token_hash })` does
  // NOT require a PKCE verifier, so we sidestep the "must be the same browser"
  // PKCE limitation. The returned session contains the tokens we install on the
  // browser context.
  const { data: verifyData, error: verifyErr } =
    await anonClient.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
  if (verifyErr || !verifyData.session) {
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error(
      `verifyOtp failed for ${email}: ${verifyErr?.message ?? "no session"}`
    );
  }

  const storedShape = {
    access_token: verifyData.session.access_token,
    refresh_token: verifyData.session.refresh_token,
    expires_in: verifyData.session.expires_in,
    expires_at: verifyData.session.expires_at,
    token_type: verifyData.session.token_type,
    user: verifyData.session.user,
  };

  // Install the session in localStorage BEFORE the app boots so the singleton
  // picks it up on first render. addInitScript runs on every navigation.
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: storedShape }
  );

  if (landOnHome) {
    await page.goto("/");
  }

  return {
    email,
    userId,
    cleanup: () => deleteTestUser(userId),
  };
}

export async function deleteTestUser(userId: string): Promise<void> {
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`admin.deleteUser failed for ${userId}: ${error.message}`);
  }
}
