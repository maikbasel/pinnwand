import { createHash, randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { test } from "./fixtures";
import { createAuthenticatedUser } from "./helpers/direct-auth";

// Sealed e2e stack: Playwright shares the `web` container's network
// namespace, so GoTrue is reachable at the kong gateway's Docker DNS name
// (matches SUPABASE_URL in docker-compose.e2e.yml / helpers/direct-auth.ts).
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:8000";

// Mirror of SUPABASE_AUTH_STORAGE_KEY from src/shared/lib/supabase.ts. Not
// imported (see helpers/direct-auth.ts): this file runs in the Playwright
// Node context, which cannot resolve `@/shared/lib/supabase`'s React imports.
const STORAGE_KEY = "sb-pinnwand-auth-token";

// A throwaway OAuth client redirect_uri. `page.route` below intercepts any
// navigation to it before the browser resolves DNS, so the test never leaves
// the sealed network; only its shape (a distinct, matchable origin) matters.
const CLIENT_REDIRECT_URI = "https://mcp-client.pinnwand.test/callback";

const StoredSession = z.object({ access_token: z.string().min(1) });
const ClientRegistration = z.object({ client_id: z.string().min(1) });
const APPROVE_BUTTON_PATTERN = /zugriff erlauben/i;

function base64Url(input: Buffer): string {
  return input.toString("base64url");
}

async function readAccessToken(page: Page): Promise<string> {
  const raw = await page.evaluate<string | null, string>(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY
  );
  if (!raw) {
    throw new Error("expected a session in localStorage after sign-in");
  }
  return StoredSession.parse(JSON.parse(raw)).access_token;
}

// Dynamic client registration (RFC 7591), enabled via
// GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION in docker-compose.e2e.yml.
async function registerOAuthClient(): Promise<string> {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/oauth/clients/register`,
    {
      body: JSON.stringify({
        client_name: "pinnwand-e2e-oauth-consent",
        grant_types: ["authorization_code"],
        redirect_uris: [CLIENT_REDIRECT_URI],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw new Error(
      `client registration failed with status ${response.status}`
    );
  }
  const body: unknown = await response.json();
  return ClientRegistration.parse(body).client_id;
}

// Drives GoTrue's `/oauth/authorize` as the signed-in user (Bearer token) and
// returns the `Location` it 302s to: `{SITE_URL}/oauth/consent?authorization_id=…`.
async function requestAuthorization(
  clientId: string,
  accessToken: string
): Promise<string> {
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest()
  );
  const query = new URLSearchParams({
    client_id: clientId,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: CLIENT_REDIRECT_URI,
    response_type: "code",
    scope: "openid",
    state: base64Url(randomBytes(8)),
  });
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/oauth/authorize?${query.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "manual",
    }
  );
  const location = response.headers.get("location");
  if (!location) {
    throw new Error(
      `expected /oauth/authorize to redirect to the consent page, got status ${response.status}`
    );
  }
  return location;
}

// This spec mints its own OAuth client + user per run, so it must not ride
// the shared authenticated storageState (see .claude/rules/playwright.md
// "Specs that mutate board-scoped state must self-isolate").
test.use({ storageState: { cookies: [], origins: [] } });

test("an authenticated user approves an OAuth client and is redirected back with a code", async ({
  page,
}) => {
  const user = await createAuthenticatedUser(page);

  try {
    const accessToken = await readAccessToken(page);
    const clientId = await registerOAuthClient();
    const authorizeLocation = await requestAuthorization(clientId, accessToken);
    const consentUrl = new URL(authorizeLocation, SUPABASE_URL);

    // Intercept the final client-redirect navigation instead of letting the
    // browser actually resolve `mcp-client.pinnwand.test`.
    await page.route(`${CLIENT_REDIRECT_URI}**`, (route) =>
      route.fulfill({
        body: "<p>ok</p>",
        contentType: "text/html",
        status: 200,
      })
    );

    await page.goto(`${consentUrl.pathname}${consentUrl.search}`);

    // The client name comes straight from the registered client's
    // `client_name`.
    await expect(page.getByText("pinnwand-e2e-oauth-consent")).toBeVisible();

    const approveButton = page.getByRole("button", {
      name: APPROVE_BUTTON_PATTERN,
    });
    await expect(approveButton).toBeVisible();
    await approveButton.click();

    await page.waitForURL(
      (url) =>
        url.href.startsWith(CLIENT_REDIRECT_URI) && url.searchParams.has("code")
    );
    expect(new URL(page.url()).searchParams.get("code")).toBeTruthy();
  } finally {
    await user.cleanup();
  }
});
