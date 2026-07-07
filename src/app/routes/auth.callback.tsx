import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  BACK_TO_SIGN_IN,
  CALLBACK_BODY,
  CALLBACK_ERROR_HEADING,
  CALLBACK_ERROR_TIMEOUT,
  CALLBACK_HEADING,
  sanitizeRedirect,
  subscribeToAuthChanges,
} from "@/features/auth";
import { noop } from "@/shared/lib/noop";

const SearchSchema = z.object({
  redirect: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

// Generous enough for a mobile cold start plus a flaky cellular GoTrue verify
// round-trip. Below this, valid links produced false "couldn't sign you in".
const EXCHANGE_TIMEOUT_MS = 8000;

// Intentionally public: NO requireGuest. The magic-link lands here mid-PKCE
// exchange with no session yet, the effect below waits for onAuthStateChange
// to yield the session, then navigates. Guarding with requireGuest could bounce
// the user before the exchange completes.
export const Route = createFileRoute("/auth/callback")({
  validateSearch: SearchSchema,
  component: AuthCallback,
});

function AuthCallback() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState<string | null>(
    search.error ? (search.error_description ?? CALLBACK_ERROR_TIMEOUT) : null
  );

  useEffect(() => {
    if (errorMessage) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setErrorMessage(CALLBACK_ERROR_TIMEOUT);
    }, EXCHANGE_TIMEOUT_MS);

    const unsubscribe = subscribeToAuthChanges((session) => {
      if (!session) {
        return;
      }
      window.clearTimeout(timeout);
      navigate({ to: sanitizeRedirect(search.redirect) }).then(noop, noop);
    });

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, [errorMessage, navigate, search.redirect]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      {errorMessage ? (
        <>
          <h1 className="font-semibold text-2xl tracking-tight">
            {CALLBACK_ERROR_HEADING}
          </h1>
          <p className="max-w-sm text-muted-foreground text-sm">
            {errorMessage}
          </p>
          <Link
            className="rounded-md border px-4 py-2 font-medium text-sm"
            to="/sign-in"
          >
            {BACK_TO_SIGN_IN}
          </Link>
        </>
      ) : (
        <>
          <h1 className="font-semibold text-2xl tracking-tight">
            {CALLBACK_HEADING}
          </h1>
          <p className="text-muted-foreground text-sm">{CALLBACK_BODY}</p>
        </>
      )}
    </div>
  );
}
