// GoTrue OAuth consent contract, live-verified against
// supabase/gotrue:v2.189.0 (see .superpowers/sdd/task-2-consent-contract.md).
// Both endpoints require the signed-in user's Supabase access token as
// `Authorization: Bearer <access_token>` — no anon/service key.
//
// GET  {SUPABASE_URL}/auth/v1/oauth/authorizations/{authorization_id}
//   -> 200 { authorization_id, redirect_uri, client: { id, name }, user: { id, email }, scope }
//   -> 401 { code: 401, error_code: "no_authorization", ... } (missing/invalid Bearer)
//   -> 404 { error_code: "oauth_authorization_not_found" } (unknown/expired id)
//
// POST {SUPABASE_URL}/auth/v1/oauth/authorizations/{authorization_id}/consent
//   body { action: "approve" | "deny" }
//   -> 200 { redirect_url } — GoTrue has already composed the full redirect back
//      to the OAuth client (?code=...&state=... on approve, error=access_denied
//      on deny). The caller does `window.location.assign(redirect_url)`.
import { z } from "zod";
import { env } from "@/app/env";

const AuthorizationDetailsResponse = z.object({
  authorization_id: z.string().min(1),
  redirect_uri: z.url(),
  client: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  user: z.object({ id: z.string().min(1), email: z.email() }),
  scope: z.string(),
});
export type AuthorizationDetails = z.infer<typeof AuthorizationDetailsResponse>;

const ConsentResponse = z.object({ redirect_url: z.url() });
export type ConsentResult = z.infer<typeof ConsentResponse>;

const ConsentAction = z.enum(["approve", "deny"]);
export type ConsentAction = z.infer<typeof ConsentAction>;

// Loose shape for GoTrue's error bodies ({"code":401,"error_code":"..."} or
// {"error_code":"..."}); only `error_code` is used, everything else is opaque.
const OAuthErrorBody = z.object({ error_code: z.string() }).partial();

function authorizationUrl(authorizationId: string): string {
  return `${env.VITE_SUPABASE_URL}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}`;
}

function extractErrorMessage(body: unknown, status: number): string {
  const parsed = OAuthErrorBody.safeParse(body);
  if (parsed.success && parsed.data.error_code) {
    return parsed.data.error_code;
  }
  return `request failed with status ${status}`;
}

async function requestJson<T>(
  input: string,
  init: RequestInit,
  schema: z.ZodType<T>
): Promise<T> {
  const response = await fetch(input, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(extractErrorMessage(body, response.status));
  }
  return schema.parse(body);
}

const GetAuthorizationDetailsInput = z.object({
  authorizationId: z.string().min(1),
  accessToken: z.string().min(1),
});

export function getAuthorizationDetails(
  authorizationId: string,
  accessToken: string
): Promise<AuthorizationDetails> {
  const input = GetAuthorizationDetailsInput.parse({
    authorizationId,
    accessToken,
  });
  return requestJson(
    authorizationUrl(input.authorizationId),
    { headers: { Authorization: `Bearer ${input.accessToken}` } },
    AuthorizationDetailsResponse
  );
}

const SubmitConsentInput = z.object({
  authorizationId: z.string().min(1),
  action: ConsentAction,
  accessToken: z.string().min(1),
});

export function submitConsent(
  authorizationId: string,
  action: ConsentAction,
  accessToken: string
): Promise<ConsentResult> {
  const input = SubmitConsentInput.parse({
    authorizationId,
    action,
    accessToken,
  });
  return requestJson(
    `${authorizationUrl(input.authorizationId)}/consent`,
    {
      body: JSON.stringify({ action: input.action }),
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    ConsentResponse
  );
}
