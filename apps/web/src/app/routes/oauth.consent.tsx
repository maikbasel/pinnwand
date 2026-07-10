import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OAuthConsent } from "@/features/auth";

const SearchSchema = z.object({ authorization_id: z.string().min(1) });

// Intentionally public: no `requireAuth` beforeLoad. OAuthConsent itself
// checks the session and redirects into sign-in with a return path, and this
// route (unlike `_authed/*`) renders bare, without the app's NavigationShell,
// matching /sign-in and /auth/callback.
export const Route = createFileRoute("/oauth/consent")({
  component: OAuthConsentRoute,
  validateSearch: SearchSchema,
});

function OAuthConsentRoute() {
  const search = Route.useSearch();
  return <OAuthConsent authorizationId={search.authorization_id} />;
}
