import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Skeleton } from "@/shared/components/ui/skeleton";
import type { ConsentAction } from "../api/oauth-consent";
import {
  useAuthorizationDetails,
  useSubmitConsent,
} from "../hooks/use-oauth-consent";
import { useSession } from "../hooks/use-session";
import {
  CONSENT_HEADING,
  CONSENT_LOAD_ERROR,
  CONSENT_SCOPE_LABEL,
  CONSENT_SUBMIT_ERROR,
  CTA_APPROVE,
  CTA_DENY,
  CTA_SUBMITTING,
  consentDescription,
} from "../lib/copy";
import { sanitizeRedirect } from "../lib/sanitize-redirect";

type OAuthConsentProps = {
  authorizationId: string;
};

export function OAuthConsent({ authorizationId }: OAuthConsentProps) {
  const { session, isLoading: sessionLoading } = useSession();
  const navigate = useNavigate();
  const details = useAuthorizationDetails(authorizationId);
  const consent = useSubmitConsent(authorizationId);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const returnPath = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;

  useEffect(() => {
    if (sessionLoading || session) {
      return;
    }
    navigate({
      search: { redirect: sanitizeRedirect(returnPath) },
      to: "/sign-in",
    });
  }, [navigate, returnPath, session, sessionLoading]);

  async function respond(action: ConsentAction): Promise<void> {
    setSubmitError(null);
    try {
      const result = await consent.mutateAsync(action);
      window.location.assign(result.redirect_url);
    } catch {
      setSubmitError(CONSENT_SUBMIT_ERROR);
    }
  }

  if (sessionLoading || !session || details.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Skeleton className="h-48 w-full max-w-sm rounded-xl" />
      </div>
    );
  }

  if (details.isError || !details.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <Alert className="w-full max-w-sm" variant="destructive">
          <AlertDescription>{CONSENT_LOAD_ERROR}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { client, scope } = details.data;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl tracking-tight">
            {CONSENT_HEADING}
          </CardTitle>
          <CardDescription>{consentDescription(client.name)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
            <span className="text-muted-foreground text-xs">
              {CONSENT_SCOPE_LABEL}
            </span>
            <span className="font-medium">{scope}</span>
          </div>
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button
            className="w-full"
            disabled={consent.isPending}
            onClick={() => respond("approve")}
            type="button"
          >
            {consent.isPending ? CTA_SUBMITTING : CTA_APPROVE}
          </Button>
          <Button
            className="w-full"
            disabled={consent.isPending}
            onClick={() => respond("deny")}
            type="button"
            variant="outline"
          >
            {CTA_DENY}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
