import { createClient } from "@supabase/supabase-js";

// Wipes every user whose email starts with `e2e-` after the suite finishes.
// Specs that forget a `finally { deleteTestUser }` would otherwise leak users
// into the local dev DB across many runs. CI tears the whole stack down anyway,
// so this is a no-op there.
const E2E_EMAIL_PREFIX = "e2e-";
const PER_PAGE = 200;

async function globalTeardown(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!(url && serviceKey)) {
    return;
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) {
      // Swallowing here is intentional: teardown should never fail the suite.
      // Stale users from one run will be swept by the next.
      process.stderr.write(
        `e2e globalTeardown: listUsers page ${page} failed: ${error.message}\n`
      );
      return;
    }

    const targets = data.users.filter((user) =>
      user.email?.startsWith(E2E_EMAIL_PREFIX)
    );
    await Promise.all(
      targets.map((user) => admin.auth.admin.deleteUser(user.id))
    );

    if (data.users.length < PER_PAGE) {
      return;
    }
    page += 1;
  }
}

export default globalTeardown;
