import { useMutation, useQuery } from "@tanstack/react-query";
import {
  type AuthorizationDetails,
  type ConsentAction,
  type ConsentResult,
  getAuthorizationDetails,
  submitConsent,
} from "../api/oauth-consent";
import { useSession } from "./use-session";

export const OAUTH_CONSENT_KEYS = {
  all: ["oauthConsent"] as const,
  authorization: (authorizationId: string) =>
    [...OAUTH_CONSENT_KEYS.all, authorizationId] as const,
};

export function useAuthorizationDetails(authorizationId: string) {
  const { session } = useSession();
  const accessToken = session?.access_token;
  return useQuery<AuthorizationDetails>({
    enabled: Boolean(accessToken),
    queryFn: () => {
      if (!accessToken) {
        throw new Error("Not authenticated");
      }
      return getAuthorizationDetails(authorizationId, accessToken);
    },
    queryKey: OAUTH_CONSENT_KEYS.authorization(authorizationId),
    retry: false,
  });
}

export function useSubmitConsent(authorizationId: string) {
  const { session } = useSession();
  return useMutation<ConsentResult, Error, ConsentAction>({
    meta: { op: "oauthConsent.submit", suppressToast: true },
    mutationFn: (action) => {
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Not authenticated");
      }
      return submitConsent(authorizationId, action, accessToken);
    },
  });
}
