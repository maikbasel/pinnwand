# Auth slice design

Date: 2026-07-07
Status: Approved, ready for implementation plan

## Goal

Ship the `auth` feature slice end to end: passwordless sign-in (magic link plus 6-digit OTP), a session the whole app reads from one source, a route guard that protects the app shell, and sign-out. The backend is already complete. The Supabase client is configured for PKCE with `signInWithOtp` and `verifyOtp`, signup is disabled server-side, and identity lives in `public.profiles`.

Every other slice is gated behind a session, so this one comes first. It gives later RLS-scoped slices a real signed-in user to test against.

## Reference

This slice ports the proven auth implementation from the Mahlzeit template (`/home/maikb/IdeaProjects/mahlzeit`, same stack and preset), dropping the parts pinnwand does not need (passkeys, email-change confirmation). The patterns below match Mahlzeit's `src/features/auth` unless noted.

## Decisions

1. **Route guard: pathless `_authed` layout with `beforeLoad`.** The idiomatic TanStack Router pattern for an authenticated section, matching the official docs. The guard runs during route matching, before any protected component renders, so there is no flash. Writing it once on the layout route protects every nested route. Its `beforeLoad` calls the shared `requireAuth` guard function (see below). This is the one place pinnwand diverges from Mahlzeit, which attaches `requireAuth` per route; pinnwand prefers the layout because the whole app is gated and it keeps new routes protected by construction.

2. **Sign-in flow: two-step email then OTP, with magic-link fallback.** Step one takes the email and calls `requestMagicLink`. Step two shows a 6-digit `input-otp` field. Clicking the magic link in the same email lands on `/auth/callback`, which completes the PKCE exchange. Both paths match the seed data, `config.toml`, and the e2e harness.

3. **Auth state: a TanStack Query, kept fresh by `onAuthStateChange`.** `AUTH_KEYS.session()` holds the session. `AuthSync` subscribes to `onAuthStateChange` and calls `setQueryData(AUTH_KEYS.session(), session)` with the authoritative event payload (not invalidate; the "invalidate, don't merge" rule applies to `postgres_changes` data, not the auth event). `seedSessionFromStorage` primes the cache synchronously at boot from the localStorage blob so the guard resolves offline without a blocking `getSession()`.

Sign-out ships in this slice as a minimal control in the `_authed` header. The richer profile menu supersedes it when that slice lands.

## Layers

Strict feature-slice boundaries apply: `components` to `hooks` to `api` to `shared/lib/supabase`. Files use kebab-case, matching pinnwand's existing files (`create-board.integration.test.ts`, `idb-persister`).

### `api/auth.ts` (no React imports)

- `AUTH_KEYS = { all: ['auth'], session: () => ['auth','session'] }`. No string-literal query keys.
- `readStoredSession()`: reads `SUPABASE_AUTH_STORAGE_KEY` from localStorage synchronously, validates a minimal shape (`access_token`, `user.id`) with `zod`, returns the session or null. Lets the guard resolve a returning user offline. It gates UI only; RLS stays the authorization boundary.
- `requestMagicLink({ email, redirectTo })`: `signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } })`. `shouldCreateUser: false` is explicit so the call never mints an account and the enumeration-safe handling has a defined error to key on. `zod`-validates `email` and `redirectTo`.
- `verifyEmailOtp({ email, token })`: `verifyOtp({ email, token, type: 'email' })`. `type: 'email'` is the user-typed 6-digit code, not `magiclink` (the URL-hashed token). `zod`-validates the email and a 6-digit token.
- `signOut()`: `supabase.auth.signOut({ scope: 'local' })`.
- `getSession()`: `supabase.auth.getSession()`, throws on error.
- `subscribeToAuthChanges(handler)`: wraps `onAuthStateChange`, returns an unsubscribe function.

### `guards.ts` (router guards, imports `api/auth`)

- `seedSessionFromStorage(queryClient)`: if the session key is unset, seed it from `readStoredSession()`. Called once at boot. No-op when already cached.
- `requireAuth({ context, location })`: read the cached session (warm, sync); on a cold cache fall back to `fetchQuery(getSession)`. If a session exists, return. Otherwise `throw redirect({ to: '/sign-in', search: { redirect: sanitizeRedirect(location.href) } })`.
- `requireGuest({ context })`: if a session exists, `throw redirect({ to: '/' })`. Used by `/sign-in` only.

**Resolved deviation**: `/auth/callback` does not use `requireGuest`, even though it is a guest-facing route. The route is intentionally public: the magic link lands there mid-PKCE exchange with no session yet, so guarding it would bounce the user before the exchange completes. See the comment above the route definition in `src/app/routes/auth.callback.tsx`.

### `lib/`

- `sanitize-redirect.ts`: `sanitizeRedirect(value)` accepts only same-origin absolute paths (starts with `/`, no `//`, no `:`), else returns `/`. Blocks open redirects.
- `classify-auth-error.ts`: `classifyEmailSubmitError(error)` returns `anti-enumeration` (HTTP 422), `rate-limit` (429), or `transport` (else). `classifyOtpError(error)` returns `rate-limit` (429), `invalid-or-expired` (401/403/400), or `transport`. Extracted from the form so both are unit-tested directly.
- `copy.ts`: German UI strings as named constants. No em dashes.

### `hooks/`

- `use-session.ts` → `useSession()`: reads `AUTH_KEYS.session()` with `staleTime: Infinity`; returns `{ session, user, isLoading, isError }`.
- `use-sign-in.ts` → `useSignIn()`: mutation wrapping `requestMagicLink`, `meta: { suppressToast: true }` so the enumeration-safe success branch and inline errors are not doubled by a global toast.
- `use-verify-otp.ts` → `useVerifyOtp()`: mutation wrapping `verifyEmailOtp`, `meta: { suppressToast: true }`.
- `use-sign-out.ts` → `useSignOut()`: swallows the remote error (exit path must not block), then `removeQueries` for all non-auth keys, `setQueryData(session, null)`, purges the persisted IDB cache (shared-device safety), and navigates to `/sign-in`.

### `components/`

- `auth-sync.tsx` → `AuthSync`: subscribes to `onAuthStateChange`, `setQueryData(AUTH_KEYS.session(), session)`. Renders null. Mounted in `__root.tsx`.
- `sign-in-form.tsx` → `SignInForm`: two-step form (email, then `input-otp`) with resend and "andere E-Mail" controls. Uses the classifiers for error handling and the enumeration-safe advance. Loading, error, and sent states.
- `sign-out-button.tsx` → `SignOutButton`: calls `useSignOut`.

### `types.ts`

`AuthSession` and `AuthUser` aliased from supabase-js `Session` / `User`.

### `index.ts`

Public surface: `AUTH_KEYS`, `subscribeToAuthChanges`, `requireAuth`, `requireGuest`, `seedSessionFromStorage`, `sanitizeRedirect`, `useSession`, `useSignIn`, `useVerifyOtp`, `useSignOut`, `AuthSync`, `SignInForm`, `SignOutButton`, and the `AuthSession` / `AuthUser` types.

## Routing

- `routes/__root.tsx`: mount `<AuthSync />`.
- `routes/_authed.tsx`: pathless layout. `beforeLoad: requireAuth`. Renders the app header with `SignOutButton` and an `<Outlet />`.
- `routes/index.tsx` moves to `routes/_authed.index.tsx` (boards list).
- `routes/boards.$boardId.tsx` moves to `routes/_authed.boards.$boardId.tsx`.
- `routes/sign-in.tsx`: `beforeLoad: requireGuest`, `validateSearch` for `{ redirect?: string }`, renders `SignInForm`.
- `routes/auth.callback.tsx`: public landing for the magic link. Waits for `onAuthStateChange` to yield a session, then navigates to `sanitizeRedirect(redirect)`. An 8s timeout shows a fallback that points the user to the OTP field on the sign-in page. Drops Mahlzeit's email-change branch.
- `app/main.tsx`: calls `seedSessionFromStorage(queryClient)` once at boot, at the marked registration point before the persister resumes.
- `routeTree.gen.ts` regenerates from the renamed files. It is generated, never hand-edited.

## Setup

Add the `input-otp` shadcn primitive: `pnpm dlx shadcn@latest add input-otp`. `emailRedirectTo` builds from `window.location.origin + '/auth/callback'` with the sanitized `redirect` carried as a search param.

## States

- Send code: idle, sending, sent, error. On success the form advances to the OTP step. To prevent account enumeration, a 422 (unknown address or signup disabled) is treated as success: the form advances and shows neutral copy ("Falls ein Konto mit dieser Adresse existiert, ist ein Code unterwegs"). Only 429 (rate limit) and transport faults render an inline error.
- Verify code: idle, verifying, invalid-or-expired, too-many, success. Errors render inline below the code cells with one generic message, never distinguishing an unknown email.
- Callback: loading, then redirect on session, or a timeout fallback pointing to the OTP field.
- Guard: no flash, since `beforeLoad` runs before render and the warm cache resolves synchronously.
- Sign-out: local cache cleared and IDB purged even if the remote call fails, then redirect to `/sign-in`.

## Tests

Coverage splits along the harness boundaries. The integration harness (`src/test/integration-setup.ts`) boots Supabase Postgres only, with no GoTrue, so the GoTrue-facing adapter cannot run there. Its live path is an e2e concern.

- **Unit (Vitest, jsdom):** `classifyEmailSubmitError` / `classifyOtpError` across statuses, `sanitizeRedirect`, `useSignIn` and `useVerifyOtp` success and error paths (adapter mocked), and the `useSession` shape.
- **Integration (Vitest, testcontainers, `.integration.test.ts`):** the auth-adjacent SQL the harness can reach. Assert that inserting an `auth.users` row fires `handle_new_user` and seeds a matching `public.profiles` row, and that `profiles` RLS lets a user read profiles but update only their own. Follows the `create-board.integration.test.ts` pattern with `createAuthUser` / `withRls` / `asService`.
- **e2e (Playwright, `docker-compose.e2e.yml`):** the live adapter path. `smoke.spec.ts` with the mailpit and direct-auth helpers drives the real magic-link and OTP sign-in, the callback, the guard redirect, and sign-out.

## Out of scope

Passkeys, email-change confirmation, profile editing, richer navigation chrome, and board data. Those belong to later slices or are dropped from the port.

## Conventions

All UI copy is German. No em dashes in any prose or copy. Run copy and docs through the stop-slop skill before finalizing.
