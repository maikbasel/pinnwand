---
paths:
  - "e2e/**/*"
  - "tests/e2e/**/*"
  - "playwright/**/*"
---

# Acceptance Tests (Playwright)

- Describe full observable behavior from a user's perspective.
- Stay red until the complete feature is implemented — that is expected and correct.
- Drive top-down: the failing acceptance test tells you what layer to build next.
- Use the **Page Object Model** pattern: one class per page/view in `e2e/pages/`, encapsulating selectors and interactions. Tests import POMs — never use raw selectors in test files.
- Organize test files by feature: `e2e/<feature-name>/<scenario>.spec.ts`.

## Authentication: three-layer pattern, Mailpit only in one spec

The magic-link path is slow (SMTP delivery + token polling). The suite uses three layers so Mailpit is hit at most once per browser engine per CI run:

1. **`e2e/auth.setup.ts`** — a Playwright `setup-<engine>` project that runs once per browser engine, calls `createAuthenticatedUser` from `e2e/helpers/direct-auth.ts`, and persists `storageState` to `e2e/.auth/<engine>.json` (gitignored).
2. **`e2e/helpers/direct-auth.ts`** — Node-side admin API: `auth.admin.createUser({ email_confirm: true })` + `auth.admin.generateLink({ type: 'magiclink' })` + `verifyOtp({ token_hash })` from the *anon* client (NOT the page) to get session tokens, then inject into the page's `localStorage` via `page.addInitScript` under `SUPABASE_AUTH_STORAGE_KEY`. Bypasses Mailpit AND the PKCE verifier limitation.
3. **`e2e/auth/magic-link-login.spec.ts`** — the ONE spec tagged `@email` that walks the real loop end-to-end (Mailpit poll → click PKCE link → land authenticated). Excluded from the fast iteration loop with `--grep-invert @email`.

Rules:

- **Use the persisted `storageState`** (configured via `dependencies: ["setup-<engine>"]` + `use.storageState` on every project in `playwright.config.ts`) for any test that needs an authenticated user. Don't call `createAuthenticatedUser` in individual specs — the setup project did it once per engine.
- **Specs that mutate household-scoped state must self-isolate**, not ride the shared `storageState`. The suite runs `fullyParallel`, so every spec on the shared session hits the *same household and same current week* concurrently; two specs writing meals there race each other, and (worse) a meal a failed attempt leaves behind survives into the retry, where an unscoped `getByText` then matches both copies and a strict-mode violation makes the flake permanent (retries can never recover). Mint a fresh user per test with `test.use({ storageState: { cookies: [], origins: [] } })` + `createAuthenticatedUser(page)` and clean up in `finally`. `direct-auth` bypasses Mailpit, so the only cost is one admin-API round-trip, cheap next to the contamination it prevents. `meals/meal-planning.spec.ts`, `meals/realtime.spec.ts`, and `dishes/realtime.spec.ts` follow this. Read-only or non-conflicting specs may still use the shared session.
- **Use `test.use({ storageState: { cookies: [], origins: [] } })`** at describe or file scope when you want a fresh anonymous context (route guard tests, sign-in spec).
- **The `direct-auth.verifyOtp` call passes ONLY `{ type, token_hash }`** — adding `email` causes GoTrue to return "Only the token_hash and type should be provided".
- **Do not navigate to `properties.action_link`** returned by `generateLink` — that consumes the PKCE link and trips auth-js#767. Always use `verifyOtp({ token_hash })` from the Node anon client and pass the resulting tokens to the page.
- **Service-role key is fenced to the Playwright Node runner** — never injected into the browser context. Vitest unit `no-service-role-key.test.ts` asserts no `VITE_SUPABASE_SERVICE*` ever ships to the client bundle.
- **Never** inline the magic-link wizard in tests — it triples runtime and adds flakiness.

## Realtime tests need two contexts

The whole point of this app is realtime sync between two users. Tests that exercise sync use `browser.newContext()` twice (one per user), perform an action in context A, and assert the change appears in context B. A single-context realtime test is a smoke test, not a sync test.

## Local Supabase for e2e

Run e2e against `supabase start` (local stack) and seed test data through the admin API in `globalSetup`. Reset the DB between test files via a transaction wrapper or migration replay — flaky cross-test contamination kills the suite.
