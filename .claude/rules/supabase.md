---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "supabase/**/*"
---

# Supabase Conventions

## Client instantiation

- `src/shared/lib/supabase.ts` is the only file that calls `createClient`. Everything else imports the singleton.
- The client uses the **anon key** from `import.meta.env.VITE_SUPABASE_ANON_KEY`. The service role key is never imported into the React bundle.
- Auth persistence + session detection are configured in this single file; don't re-configure them at call sites.

## Auth: magic link

- Sign-in is via Supabase Auth magic link. The flow is: enter email → Supabase emails the link → user clicks → app receives the session via `onAuthStateChange`.
- Self-serve signup is disabled (`GOTRUE_DISABLE_SIGNUP=true`). Always pass `shouldCreateUser: false` to `signInWithOtp` as a client-side complement. Sign-in for an unknown email returns a 422 — surface a generic "if this email is registered, a sign-in link is on its way" message regardless of the GoTrue response, so the form does not leak which addresses are enrolled.
- Use `signOut({ scope: 'local' })` — never the default `'global'`. Default scope invalidates every active session this user holds across all their devices.
- The router's auth guard reads from the cached `["auth", "session"]` query key (populated by `<AuthSync />` mirroring `onAuthStateChange`), not directly from `supabase.auth.getSession()` at the call site.
- For UX gates ("decide what to render"), the cached session is fine — RLS is the actual authz boundary. For trust-sensitive client-side checks (admin-only UI, JWT-payload-based feature flags) call `supabase.auth.getClaims()`, which validates the signature; `getSession()` returns whatever's in `localStorage` without verification.
- The Supabase client singleton sets an explicit `storageKey: SUPABASE_AUTH_STORAGE_KEY = "sb-mahlzeit-auth-token"` so e2e helpers can install sessions under a stable key. Don't change this constant casually — the e2e direct-auth helper hard-codes a mirror of it.
- PKCE is the configured flow. The verifier is per-browser, so opening a magic link on a different device than the one that requested it intentionally fails — surfaced as a clear error in `/auth/callback`. Do not switch to the implicit flow to "fix" this.
- **6-digit OTP fallback:** GoTrue v2.189+ also includes a 6-digit code in the magic-link email. The app verifies it via `supabase.auth.verifyOtp({ email, token, type: 'email' })` — exposed as `verifyEmailOtp` in `src/features/auth/api/auth.ts` and as `useVerifyOtp` in hooks. The OTP path is independent of the PKCE verifier and therefore works cross-device. **Footgun:** the `type` parameter is `'email'` for the user-typed 6-digit code; `'magiclink'` is for the URL-hashed token from the link itself. Mixing them up fails silently with a confusing error. The cross-device disclosure on `/sign-in` ("Hast du bereits einen Code?") calls only `verifyOtp` — never `signInWithOtp`, which would invalidate the code the user is already holding.
- **No self-serve signup, ever, until explicitly authorized by the project owner.** The sign-in surface MUST NOT carry any signup link, button, or copy. `GOTRUE_DISABLE_SIGNUP=true` in every compose file; `shouldCreateUser: false` on every `signInWithOtp` call. New accounts are provisioned by an operator via Supabase Studio. The absence of signup UI is a load-bearing product decision, encoded in the spec ("Sign-in surface contains no self-serve signup affordance") and asserted by both Vitest and Playwright.
- **Rate limits are configured in `docker-compose.coolify.yml` only.** Local dev (`docker-compose.yml`) and the sealed e2e stack (`docker-compose.e2e.yml`) run with GoTrue defaults so tests and rapid iteration aren't gated. Prod sets `GOTRUE_RATE_LIMIT_HEADER: X-Forwarded-For` — this switches every GoTrue limit from instance-global to per-IP, which is what closes the unknown-email enumeration vector on `/auth/v1/otp`. When tightening or relaxing limits, change `docker-compose.coolify.yml` only; never propagate to the other compose files.

## UI error handling for auth mutations

- `useSignIn` and `useVerifyOtp` set `meta.suppressToast: true`. Reason: the sign-in form classifies its own errors (422 → success screen for anti-enumeration; rate-limit / transport / invalid-OTP → inline text under the input). The global `MutationCache.onError` toast would contradict the anti-enumeration success screen and double up the inline OTP error. If you add a new auth mutation that bubbles errors to the user via toast, set `suppressToast: false` (or omit the flag) explicitly so the intent is clear.

## Auth: passkey

- Native GoTrue (v2.188.0+) passkey endpoints are the only source of truth for passkey state. The app MUST NOT mint Supabase-compatible JWTs in a custom Edge Function. Credentials live in `auth.webauthn_credentials` (managed by GoTrue), exposed to operators read-only via the `public.user_passkeys_overview` view.
- The Supabase client singleton enables passkey methods via `auth.experimental.passkey: true`. Without this flag, every passkey method on the SDK throws at call time.
- Only `src/features/auth/api/passkey.ts` calls `supabase.auth.signInWithPasskey`, `supabase.auth.registerPasskey`, or the `auth.passkey.*` namespace. Components consume the hooks (`useRegisterPasskey`, `useAuthenticateWithPasskey`, `useUserPasskeys`, `useRenamePasskey`, `useDeletePasskey`).
- **Terminology:** user-facing CTAs, headings, and primary labels use `Passkey` as the noun. Body text MAY name `Face ID`, `Fingerabdruck`, and `Windows Hello` as examples of what the OS will prompt with; CTAs and headings MUST stay platform-agnostic. Naming a single platform's biometric primitive ("Mit Face ID anmelden") is forbidden because it excludes the other platforms.
- **Sign-out invariant:** `useSignOut` MUST leave every registered passkey intact. Passkeys are device-managed credentials (iCloud Keychain, Google Password Manager, Windows Hello, hardware security keys); clearing the local Supabase session has no effect on the OS-side credential, and the next sign-in on the same device sees the same passkey. Do not call `supabase.auth.passkey.delete` from sign-out flows.
- **Conditional UI** (autofill chip in the email field) ships via the low-level two-step API: `supabase.auth.passkey.startAuthentication()` returns the options, `@simplewebauthn/browser`'s `startAuthentication({ useBrowserAutofill: true })` runs `navigator.credentials.get()` with `mediation: 'conditional'`, then `supabase.auth.passkey.verifyAuthentication()` mints the session. This is `authenticateWithPasskeyConditional` in `api/passkey.ts`, driven on `/sign-in` mount by `useConditionalPasskey`. The SDK's high-level `signInWithPasskey` is modal-only, so the explicit "Mit Passkey anmelden" button (the fail-open path, design D10 of `add-passkey-auth`) uses it directly.
- **One WebAuthn ceremony at a time.** The spec allows a single in-flight `navigator.credentials.get()` per page, so the conditional ceremony and the modal button collide if both run at once (browser throws "A request is already pending", the SDK re-wraps it as "a Non-Webauthn related error has occurred"). `authenticateWithPasskey` calls `WebAuthnAbortService.cancelCeremony()` before its modal `get()` to free the slot; `useConditionalPasskey` treats the resulting `ERROR_CEREMONY_ABORTED` rejection (matched by `isCeremonyAborted` from `api/passkey.ts`) as normal flow and does not report it. A deliberate abort is never a Sentry event nor a toast.
- **Friendly name:** registration captures a UA-derived label via `deriveDeviceLabel(navigator.userAgent)` and writes it to the credential via `auth.passkey.update`. Users rename it via `/settings/security`. Do not try to identify authenticator models from the WebAuthn attestation; some platforms strip it.
- **Operator-only DB surfaces:** `public.user_passkeys_overview` (view) and `public.list_user_passkeys_overview()` (its backing plpgsql function) are operator-only audit surfaces, `service_role` only. Both appear in `src/shared/types/database.ts` because Supabase emits every public-schema object regardless of grant scope. Calling `supabase.rpc('list_user_passkeys_overview')` or `supabase.from('user_passkeys_overview').select()` from the client returns a 403 at runtime. Never wire either into a hook or component. Users see their own passkeys via `auth.passkey.list()`.

## Identity & display name

- Every row in `auth.users` has a matching row in `public.profiles`, inserted by the `handle_new_user` `after insert` trigger (idempotent via the primary key). Application code can read `public.profiles` immediately after sign-in — the row is guaranteed to exist by the time RLS sees the request.
- **Single source of truth for identity is `public.profiles`.** `display_name` lives there, gated by RLS to `auth.uid() = id`. **Never** write user-facing identity to `auth.users.raw_user_meta_data`; it's unindexed, unvalidated, and not surfaced through the generated `database.ts` types.
- Operators set `display_name` directly on the profile row via Studio (Database → `public.profiles`). Operator workflow is documented in the README under "Signing in (creating users)".
- Users self-edit `display_name` on the profile page (`/profile`). The write goes through `src/features/profile/api/profile.ts` → `supabase.from("profiles").update({ display_name }).eq("id", uid)`, gated by the existing `profiles_update_self` RLS policy (`auth.uid() = id`). `useUpdateDisplayName` does it optimistically over `PROFILE_KEYS.byUser`. Still `public.profiles` only, never `auth.users.raw_user_meta_data`.
- `INSERT` and `DELETE` on `public.profiles` are intentionally not granted to `authenticated` — rows are created by the trigger and removed via the `ON DELETE CASCADE` from `auth.users`. Don't add an INSERT policy "just in case"; the trigger is the only correct path.

## Email change

- A user changes their email on `/profile` via `supabase.auth.updateUser({ email }, { emailRedirectTo })` (`requestEmailChange` in `src/features/profile/api/profile.ts`). `emailRedirectTo` is `/auth/callback?flow=email-change` — that `flow` marker is **ours** (preserved verbatim on the GoTrue redirect, like the sign-in flow's `?redirect=`); GoTrue's PKCE verify redirect does not surface a usable `type`.
- `GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED` is `true` in dev, prod, AND e2e, so GoTrue sends a confirmation link to **both** the current and the new address and requires **both** to be confirmed before `auth.users.email` changes. The UI MUST NOT optimistically display the new address as active, and the copy MUST tell the user to confirm both links. `useRequestEmailChange` is online-only (`networkMode: "always"`) with no optimistic cache write.
- **The callback reflects the true double-confirm state.** On `flow=email-change` it calls `getCurrentUser()` (server truth): if `new_email` is still set, one link is outstanding → it shows "Fast geschafft / bestätige auch den anderen Link"; otherwise the change is complete → "E-Mail geändert" + a one-shot `refreshSession()`. A `new_email`-bearing user is the load-bearing signal — do not show a "done" confirmation after only one link (the original bug: a premature "bestätigt" while `email_change_confirm_status` was still 1).
- **Every surface that displays the account email reads server truth, not the JWT claim.** `useAccountEmail` (lives in `src/features/auth/`, exported from `@/features/auth`) reads `getCurrentUser().email` (`refetchOnMount: "always"`), because the local JWT `email` claim stays stale until the token refreshes — reading it would show the old address on a reload even after the change completed. `getUser()` validates against GoTrue and returns the current email. The profile page, the mobile Konto screen, and the desktop rail account control all consume this hook, so none shows a stale address after a change confirmed elsewhere.
- **Email is a sign-in credential here** (magic-link + OTP), so the change interacts with auth: passkeys are bound to `auth.users.id` and are unaffected; the canonical `email` (and thus magic-link/OTP identity) stays the OLD address until both links are confirmed, so there is no lockout window, then becomes the new address. The session is NOT invalidated — do **not** sign the user out on an email change.
- The originating tab picks up the new `email` claim via the SDK's built-in cross-tab BroadcastChannel (we set a stable `storageKey`, so this is automatic) plus the one-shot refresh on the confirmation tab. **Do NOT add a `visibilitychange`/`refetchOnWindowFocus` session refresh** to "fix" a stale tab — blocking auth calls on visibility are the known cause of self-hosted GoTrue tab-freeze/redirect loops, and the SDK already manages visibility-based auto-refresh. A different browser context (a mail app's in-app browser) can't share the channel and simply catches up on its next auto-refresh; that's expected.

## Sharing model

- A `household` row + a row per member in `household_members` (`role` ∈ `owner` | `member`). A user can belong to multiple households. Invitation is via a tokenised `household_invites` row, surfaced as a `/join/<token>` URL; acceptance runs through the `accept_household_invite` `security definer` RPC so atomicity + privilege boundaries live in Postgres.
- **Only an owner can mint an invite.** The `household_invites` insert policy is `created_by = auth.uid() AND is_household_owner(household_id)`. `is_household_owner(uuid)` is the owner-scoped sibling of `is_household_member(uuid)`. A plain member who joins a household does not gain invite rights. The `Mitglied einladen` action is rendered on the per-household detail page (`/households/$id`) only for the `owner`; the UI gate mirrors the RLS policy but is not the boundary.
- Every query that reads household-scoped data filters by `household_id`. RLS enforces that the user is a member of that household; the client filter exists for query efficiency, not security.
- **Never expose other users' data.** When in doubt, write a Vitest test that signs in as user B and asserts the API returns empty for user A's household.

## Generated types

- `src/shared/types/database.ts` is generated by `supabase gen types typescript`. **Never edit by hand.**
- Regenerate after every migration: `supabase gen types typescript --db-url $DATABASE_URL > src/shared/types/database.ts`.
- Import row/insert/update types from `Database['public']['Tables']['<table>']['Row']` etc. — don't redeclare them.

## Validation at the boundary

- Supabase responses are typed but not validated. For any field where the schema constrains values beyond "string" (enums, regex-matched strings, JSON columns with structure), parse with `zod` in the `api/` layer before returning to hooks.
- Realtime payloads in particular are JSON over the wire — validate them.

## Database column conventions

- `snake_case` columns (Supabase / PostgreSQL convention).
- Generated types map them to TypeScript automatically — your TypeScript code uses `camelCase` and the type system bridges the two via the generated types.
- Timestamps are `timestamptz`.
