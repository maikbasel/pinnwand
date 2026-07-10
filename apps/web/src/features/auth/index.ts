// biome-ignore-all lint/performance/noBarrelFile: feature public surface per .claude/rules/architecture.md
export { AUTH_KEYS, subscribeToAuthChanges } from "./api/auth";
export { AuthSync } from "./components/auth-sync";
export { OAuthConsent } from "./components/oauth-consent";
export { SignInForm } from "./components/sign-in-form";
export { SignOutButton } from "./components/sign-out-button";
export { requireAuth, requireGuest, seedSessionFromStorage } from "./guards";
export {
  useAuthorizationDetails,
  useSubmitConsent,
} from "./hooks/use-oauth-consent";
export { useSession } from "./hooks/use-session";
export { useSignIn } from "./hooks/use-sign-in";
export { useSignOut } from "./hooks/use-sign-out";
export { useVerifyOtp } from "./hooks/use-verify-otp";
export {
  BACK_TO_SIGN_IN,
  CALLBACK_BODY,
  CALLBACK_ERROR_HEADING,
  CALLBACK_ERROR_TIMEOUT,
  CALLBACK_HEADING,
} from "./lib/copy";
export { sanitizeRedirect } from "./lib/sanitize-redirect";
export type { AuthSession, AuthUser } from "./types";
