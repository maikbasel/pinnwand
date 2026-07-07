import { useMutation } from "@tanstack/react-query";
import { type RequestMagicLinkInput, requestMagicLink } from "../api/auth";

export function useSignIn() {
  return useMutation<void, Error, RequestMagicLinkInput>({
    mutationFn: requestMagicLink,
    // The sign-in form classifies a 422 as success (unknown email) and renders
    // its own inline error for rate-limit/transport. Suppress the global toast
    // so it never contradicts the anti-enumeration success screen.
    meta: { op: "signIn.request", suppressToast: true },
  });
}
