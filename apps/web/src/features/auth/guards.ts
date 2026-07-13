import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { AUTH_KEYS, getSession, readStoredSession } from "./api/auth";
import { sanitizeRedirect } from "./lib/sanitize-redirect";
import type { AuthSession } from "./types";

/**
 * Seed the cached session from Supabase's localStorage blob at startup so the
 * route guard resolves a returning user offline without the network-capable,
 * potentially-blocking getSession() on a cold boot. No-op when already cached.
 */
export function seedSessionFromStorage(queryClient: QueryClient): void {
  if (queryClient.getQueryData(AUTH_KEYS.session()) !== undefined) {
    return;
  }
  const stored = readStoredSession();
  if (stored) {
    queryClient.setQueryData(AUTH_KEYS.session(), stored);
  }
}

type GuardContext = { context: { queryClient: QueryClient } };
type RequireAuthArgs = GuardContext & { location: { href: string } };

// Synchronous on the warm path (cache populated by <AuthSync /> or the boot
// seed) so navigations skip the network. fetchQuery covers only the cold path.
function readSession(queryClient: QueryClient): Promise<AuthSession | null> {
  const cached = queryClient.getQueryData<AuthSession | null>(
    AUTH_KEYS.session()
  );
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  return queryClient.fetchQuery({
    queryKey: AUTH_KEYS.session(),
    queryFn: getSession,
  });
}

export async function requireAuth({
  context,
  location,
}: RequireAuthArgs): Promise<void> {
  const session = await readSession(context.queryClient);
  if (session) {
    return;
  }
  throw redirect({
    to: "/sign-in",
    search: { redirect: sanitizeRedirect(location.href) },
  });
}

export async function requireGuest({ context }: GuardContext): Promise<void> {
  const session = await readSession(context.queryClient);
  if (!session) {
    return;
  }
  throw redirect({ to: "/" });
}
