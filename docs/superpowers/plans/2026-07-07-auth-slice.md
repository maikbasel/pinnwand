# Auth Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `auth` feature slice end to end: passwordless sign-in (magic link plus 6-digit OTP), a session the whole app reads, a route guard, and sign-out.

**Architecture:** Port Mahlzeit's proven auth slice. A TanStack Query (`AUTH_KEYS.session()`) holds the session, kept fresh by a single `onAuthStateChange` subscription (`AuthSync`) and seeded synchronously from localStorage at boot for offline. A pathless `_authed` layout route guards the app via a shared `requireAuth` guard. Sign-in is a two-step form (email, then OTP), the magic link lands on `/auth/callback`.

**Tech Stack:** React 19, TypeScript (strict), TanStack Query + Router, Supabase JS (PKCE, GoTrue), zod, input-otp, Vitest (jsdom + testcontainers), Playwright.

## Global Constraints

- Layer boundaries: `components` → `hooks` → `api` → `shared/lib/supabase`. `api/` has no React imports; `components/` never import `api/` or `@supabase/*` directly.
- Filenames kebab-case. Hooks `use-*.ts`. Components `*.tsx` with kebab names.
- Strict TS: no `any`, no `as unknown as X`. `import type` for types (verbatimModuleSyntax).
- All UI copy is German. No em dashes in any prose, copy, or comments. Run copy through the stop-slop skill.
- `zod` validation at every API boundary.
- The only file that calls `createClient` is `src/shared/lib/supabase.ts`; import the `supabase` singleton from there.
- Never edit generated files: `src/shared/types/database.ts`, `src/app/routeTree.gen.ts`.
- Query keys go through `AUTH_KEYS`, never string literals.
- The session query stays out of the IDB persist allowlist (`query-client.ts` already excludes it; do not add `auth` to `OFFLINE_QUERY_ROOTS`).
- Commit after each task with a `feat:`/`test:` message. Do not push. Do not commit until the user says so at the end (per session instruction), but stage per task so the diff is reviewable.

**Reference implementation:** `/home/maikb/IdeaProjects/mahlzeit/src/features/auth`. Read the matching file there when a step is unclear.

---

### Task 1: Auth types and API adapter

**Files:**
- Create: `src/features/auth/types.ts`
- Create: `src/features/auth/api/auth.ts`
- Test: `src/features/auth/api/__tests__/auth.test.ts`

**Interfaces:**
- Produces:
  - `AUTH_KEYS = { all: readonly ['auth'], session: () => readonly ['auth','session'] }`
  - `readStoredSession(): AuthSession | null`
  - `requestMagicLink(input: { email: string; redirectTo: string }): Promise<void>`
  - `verifyEmailOtp(input: { email: string; token: string }): Promise<void>`
  - `signOut(): Promise<void>`
  - `getSession(): Promise<AuthSession | null>`
  - `subscribeToAuthChanges(handler: (session: AuthSession | null) => void): () => void`
  - Types `AuthSession = Session`, `AuthUser = User` (from `@supabase/supabase-js`)

- [ ] **Step 1: Create the types file**

`src/features/auth/types.ts`:

```ts
import type { Session, User } from "@supabase/supabase-js";

export type AuthSession = Session;
export type AuthUser = User;
```

- [ ] **Step 2: Write the failing test**

`src/features/auth/api/__tests__/auth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn(() => Promise.resolve({ error: null }));
const verifyOtp = vi.fn(() => Promise.resolve({ error: null }));

vi.mock("@/shared/lib/supabase", () => ({
  SUPABASE_AUTH_STORAGE_KEY: "sb-pinnwand-auth-token",
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => verifyOtp(...args),
    },
  },
}));

import {
  AUTH_KEYS,
  readStoredSession,
  requestMagicLink,
  verifyEmailOtp,
} from "../auth";

const STORAGE_KEY = "sb-pinnwand-auth-token";

describe("AUTH_KEYS", () => {
  it("builds a stable session key", () => {
    expect(AUTH_KEYS.session()).toEqual(["auth", "session"]);
  });
});

describe("readStoredSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no blob is stored", () => {
    expect(readStoredSession()).toBeNull();
  });

  it("returns null for a malformed blob", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readStoredSession()).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: {} }));
    expect(readStoredSession()).toBeNull();
  });

  it("returns the session when the shape is valid", () => {
    const blob = { access_token: "abc", user: { id: "u1" } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    expect(readStoredSession()).toMatchObject({ user: { id: "u1" } });
  });
});

describe("requestMagicLink", () => {
  beforeEach(() => signInWithOtp.mockClear());

  it("passes shouldCreateUser:false and emailRedirectTo", async () => {
    await requestMagicLink({
      email: "a@b.de",
      redirectTo: "https://app.local/auth/callback",
    });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "a@b.de",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "https://app.local/auth/callback",
      },
    });
  });

  it("rejects an invalid email before calling supabase", async () => {
    await expect(
      requestMagicLink({ email: "nope", redirectTo: "https://app.local/x" })
    ).rejects.toThrow();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});

describe("verifyEmailOtp", () => {
  beforeEach(() => verifyOtp.mockClear());

  it("verifies with type 'email'", async () => {
    await verifyEmailOtp({ email: "a@b.de", token: "123456" });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "a@b.de",
      token: "123456",
      type: "email",
    });
  });

  it("rejects a non 6-digit token before calling supabase", async () => {
    await expect(
      verifyEmailOtp({ email: "a@b.de", token: "12" })
    ).rejects.toThrow();
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- src/features/auth/api/__tests__/auth.test.ts`
Expected: FAIL, cannot resolve `../auth`.

- [ ] **Step 4: Implement the adapter**

`src/features/auth/api/auth.ts`:

```ts
import { z } from "zod";
import { SUPABASE_AUTH_STORAGE_KEY, supabase } from "@/shared/lib/supabase";
import type { AuthSession } from "../types";

export const AUTH_KEYS = {
  all: ["auth"] as const,
  session: () => [...AUTH_KEYS.all, "session"] as const,
};

// Minimal shape of Supabase's persisted session blob, enough to gate the route
// guard. supabase-js owns the full Session type; validate only the fields the
// guard relies on and pass the rest through.
const StoredSessionShape = z.object({
  access_token: z.string().min(1),
  user: z.object({ id: z.string().min(1) }),
});

/**
 * Read the persisted Supabase session synchronously from localStorage so the
 * route guard resolves a returning user offline without calling getSession(),
 * which can block on a token refresh that needs the network. Returns null when
 * absent or unreadable. Gates UI only; RLS stays the authorization boundary.
 */
export function readStoredSession(): AuthSession | null {
  try {
    const raw = globalThis.localStorage?.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return StoredSessionShape.safeParse(parsed).success
      ? (parsed as AuthSession)
      : null;
  } catch {
    return null;
  }
}

const RequestMagicLinkInput = z.object({
  email: z.email(),
  redirectTo: z.url(),
});
export type RequestMagicLinkInput = z.infer<typeof RequestMagicLinkInput>;

export async function requestMagicLink(
  input: RequestMagicLinkInput
): Promise<void> {
  const parsed = RequestMagicLinkInput.parse(input);
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: parsed.redirectTo,
    },
  });
  if (error) {
    throw error;
  }
}

// type: 'email' is the user-typed 6-digit code from the email body. type:
// 'magiclink' is the URL-hashed token in the link itself. Mixing them fails
// with a confusing error.
const VerifyEmailOtpInput = z.object({
  email: z.email(),
  token: z.string().regex(/^\d{6}$/),
});
export type VerifyEmailOtpInput = z.infer<typeof VerifyEmailOtpInput>;

export async function verifyEmailOtp(
  input: VerifyEmailOtpInput
): Promise<void> {
  const parsed = VerifyEmailOtpInput.parse(input);
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.email,
    token: parsed.token,
    type: "email",
  });
  if (error) {
    throw error;
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    throw error;
  }
}

export async function getSession(): Promise<AuthSession | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

type AuthChangeHandler = (session: AuthSession | null) => void;

export function subscribeToAuthChanges(handler: AuthChangeHandler): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    handler(session);
  });
  return () => {
    data.subscription.unsubscribe();
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- src/features/auth/api/__tests__/auth.test.ts`
Expected: PASS (all describes green).

- [ ] **Step 6: Lint and commit**

```bash
pnpm check
git add src/features/auth/types.ts src/features/auth/api/auth.ts src/features/auth/api/__tests__/auth.test.ts
git commit -m "feat(auth): add session types and GoTrue adapter"
```

---

### Task 2: Redirect sanitizer, error classifiers, copy

**Files:**
- Create: `src/features/auth/lib/sanitize-redirect.ts`
- Create: `src/features/auth/lib/classify-auth-error.ts`
- Create: `src/features/auth/lib/copy.ts`
- Test: `src/features/auth/lib/__tests__/sanitize-redirect.test.ts`
- Test: `src/features/auth/lib/__tests__/classify-auth-error.test.ts`

**Interfaces:**
- Produces:
  - `sanitizeRedirect(value: unknown): string`
  - `classifyEmailSubmitError(error: unknown): "anti-enumeration" | "rate-limit" | "transport"`
  - `classifyOtpError(error: unknown): "invalid-or-expired" | "rate-limit" | "transport"`
  - Copy constants (German strings) from `copy.ts`

- [ ] **Step 1: Write the failing sanitizer test**

`src/features/auth/lib/__tests__/sanitize-redirect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeRedirect } from "../sanitize-redirect";

describe("sanitizeRedirect", () => {
  it("accepts a plain absolute path", () => {
    expect(sanitizeRedirect("/boards/abc")).toBe("/boards/abc");
  });
  it("accepts a path with a query string", () => {
    expect(sanitizeRedirect("/boards?x=1")).toBe("/boards?x=1");
  });
  it("rejects a protocol-relative URL", () => {
    expect(sanitizeRedirect("//evil.example/x")).toBe("/");
  });
  it("rejects an absolute URL", () => {
    expect(sanitizeRedirect("https://evil.example")).toBe("/");
  });
  it("rejects a javascript: pseudo-URL", () => {
    expect(sanitizeRedirect("javascript:alert(1)")).toBe("/");
  });
  it("rejects null, undefined, empty", () => {
    expect(sanitizeRedirect(null)).toBe("/");
    expect(sanitizeRedirect(undefined)).toBe("/");
    expect(sanitizeRedirect("")).toBe("/");
  });
  it("rejects a path that does not start with /", () => {
    expect(sanitizeRedirect("boards/abc")).toBe("/");
  });
});
```

- [ ] **Step 2: Write the failing classifier test**

`src/features/auth/lib/__tests__/classify-auth-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyEmailSubmitError,
  classifyOtpError,
} from "../classify-auth-error";

function withStatus(status: number): unknown {
  return Object.assign(new Error("x"), { status });
}

describe("classifyEmailSubmitError", () => {
  it("maps 422 to anti-enumeration", () => {
    expect(classifyEmailSubmitError(withStatus(422))).toBe("anti-enumeration");
  });
  it("maps 429 to rate-limit", () => {
    expect(classifyEmailSubmitError(withStatus(429))).toBe("rate-limit");
  });
  it("maps anything else to transport", () => {
    expect(classifyEmailSubmitError(withStatus(500))).toBe("transport");
    expect(classifyEmailSubmitError(new Error("boom"))).toBe("transport");
    expect(classifyEmailSubmitError(null)).toBe("transport");
  });
});

describe("classifyOtpError", () => {
  it("maps 429 to rate-limit", () => {
    expect(classifyOtpError(withStatus(429))).toBe("rate-limit");
  });
  it("maps 400/401/403 to invalid-or-expired", () => {
    expect(classifyOtpError(withStatus(400))).toBe("invalid-or-expired");
    expect(classifyOtpError(withStatus(401))).toBe("invalid-or-expired");
    expect(classifyOtpError(withStatus(403))).toBe("invalid-or-expired");
  });
  it("maps anything else to transport", () => {
    expect(classifyOtpError(withStatus(500))).toBe("transport");
    expect(classifyOtpError(new Error("boom"))).toBe("transport");
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm test -- src/features/auth/lib`
Expected: FAIL, cannot resolve modules.

- [ ] **Step 4: Implement the three lib files**

`src/features/auth/lib/sanitize-redirect.ts`:

```ts
// Accept same-origin absolute paths only; reject anything that could leave the
// origin (javascript:, data:, //evil.example). Auth-route loop-back is not
// blocked here; requireGuest is the authority on who can be where.
const FORBIDDEN_SUBSTRINGS = ["//", ":"];

export function sanitizeRedirect(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "/";
  }
  if (!value.startsWith("/")) {
    return "/";
  }
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (value.includes(forbidden)) {
      return "/";
    }
  }
  return value;
}
```

`src/features/auth/lib/classify-auth-error.ts`:

```ts
function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

export type EmailSubmitErrorKind =
  | "anti-enumeration"
  | "rate-limit"
  | "transport";

// 422 means the address is unknown or signup is disabled. Treat it as an
// anti-enumeration success at the UI layer; never distinguish enrolled from
// unenrolled emails on the sign-in surface.
export function classifyEmailSubmitError(error: unknown): EmailSubmitErrorKind {
  const status = statusOf(error);
  if (status === 422) {
    return "anti-enumeration";
  }
  if (status === 429) {
    return "rate-limit";
  }
  return "transport";
}

export type OtpErrorKind = "invalid-or-expired" | "rate-limit" | "transport";

export function classifyOtpError(error: unknown): OtpErrorKind {
  const status = statusOf(error);
  if (status === 429) {
    return "rate-limit";
  }
  if (status === 400 || status === 401 || status === 403) {
    return "invalid-or-expired";
  }
  return "transport";
}
```

`src/features/auth/lib/copy.ts`:

```ts
// German UI copy for the auth surface. No em dashes.
export const SIGN_IN_HEADING = "Anmelden";
export const SIGN_IN_SUBHEAD = "Melde dich mit deiner E-Mail an.";
export const EMAIL_LABEL = "E-Mail";
export const EMAIL_PLACEHOLDER = "du@beispiel.de";
export const CTA_SEND_CODE = "Anmeldelink senden";
export const CTA_SENDING = "Wird gesendet …";
export const OTP_HEADING = "Code eingeben";
export const OTP_SENT_NEUTRAL =
  "Falls ein Konto mit dieser Adresse existiert, ist ein Code unterwegs. Klicke den Link in der E-Mail oder gib den 6-stelligen Code ein.";
export const CTA_VERIFY = "Anmelden";
export const CTA_VERIFYING = "Wird geprüft …";
export const CTA_USE_OTHER_EMAIL = "Andere E-Mail verwenden";
export const CTA_RESEND = "Code erneut senden";
export const ERROR_RATE_LIMIT =
  "Zu viele Versuche. Warte einen Moment und versuche es erneut.";
export const ERROR_TRANSPORT =
  "Verbindung fehlgeschlagen. Prüfe dein Netz und versuche es erneut.";
export const ERROR_OTP_INVALID =
  "Der Code ist ungültig oder abgelaufen. Fordere einen neuen an.";
export const CALLBACK_HEADING = "Anmeldung läuft …";
export const CALLBACK_BODY = "Einen Moment, wir bestätigen deinen Link.";
export const CALLBACK_ERROR_HEADING = "Anmeldung fehlgeschlagen";
export const CALLBACK_ERROR_TIMEOUT =
  "Das dauert länger als gewohnt. Der Link ist womöglich abgelaufen oder wurde auf einem anderen Gerät angefragt. Gib stattdessen den Code aus der E-Mail auf der Anmeldeseite ein.";
export const BACK_TO_SIGN_IN = "Zurück zur Anmeldung";
export const SIGN_OUT = "Abmelden";
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `pnpm test -- src/features/auth/lib`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
pnpm check
git add src/features/auth/lib
git commit -m "feat(auth): add redirect sanitizer, error classifiers, copy"
```

---

### Task 3: Session and mutation hooks

**Files:**
- Create: `src/features/auth/hooks/use-session.ts`
- Create: `src/features/auth/hooks/use-sign-in.ts`
- Create: `src/features/auth/hooks/use-verify-otp.ts`
- Create: `src/features/auth/hooks/use-sign-out.ts`
- Test: `src/features/auth/hooks/__tests__/use-sign-in.test.ts`
- Test: `src/features/auth/hooks/__tests__/use-verify-otp.test.ts`
- Test: `src/features/auth/hooks/__tests__/use-sign-out.test.ts`

**Interfaces:**
- Consumes: `AUTH_KEYS`, `getSession`, `requestMagicLink`, `verifyEmailOtp`, `signOut` (Task 1); `purgePersistedCache` from `@/shared/lib/idb-persister`; `noop` from `@/shared/lib/noop`.
- Produces:
  - `useSession(): { session: AuthSession | null; user: AuthUser | null; isLoading: boolean; isError: boolean }`
  - `useSignIn()` mutation (`{ email, redirectTo }` → void), `meta.suppressToast`
  - `useVerifyOtp()` mutation (`{ email, token }` → void), `meta.suppressToast`
  - `useSignOut()` mutation (void → void)

- [ ] **Step 1: Write the failing use-sign-in test**

`src/features/auth/hooks/__tests__/use-sign-in.test.ts`:

```ts
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

vi.mock("@/features/auth/api/auth", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/auth/api/auth")
  >("@/features/auth/api/auth");
  return { ...actual, requestMagicLink: vi.fn(() => Promise.resolve()) };
});

import { queryClient } from "@/shared/lib/query-client";
import { requestMagicLink } from "../../api/auth";
import { useSignIn } from "../use-sign-in";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useSignIn", () => {
  beforeEach(() => {
    vi.mocked(requestMagicLink).mockReset();
    toastError.mockReset();
    queryClient.clear();
  });

  it("passes the input through to requestMagicLink", async () => {
    vi.mocked(requestMagicLink).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useSignIn(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        email: "a@b.de",
        redirectTo: "https://app.local/auth/callback",
      });
    });
    expect(requestMagicLink).toHaveBeenCalledWith({
      email: "a@b.de",
      redirectTo: "https://app.local/auth/callback",
    });
  });

  it("does not emit a global toast on failure (suppressToast)", async () => {
    const err = Object.assign(new Error("Signups not allowed"), {
      status: 422,
    });
    vi.mocked(requestMagicLink).mockRejectedValueOnce(err);
    const { result } = renderHook(() => useSignIn(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ email: "x@y.de", redirectTo: "https://app.local/x" })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write the failing use-verify-otp test**

`src/features/auth/hooks/__tests__/use-verify-otp.test.ts`:

```ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/api/auth", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/auth/api/auth")
  >("@/features/auth/api/auth");
  return { ...actual, verifyEmailOtp: vi.fn(() => Promise.resolve()) };
});

import { verifyEmailOtp } from "../../api/auth";
import { useVerifyOtp } from "../use-verify-otp";

describe("useVerifyOtp", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.mocked(verifyEmailOtp).mockReset();
    vi.mocked(verifyEmailOtp).mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  it("calls verifyEmailOtp with the input verbatim", async () => {
    const { result } = renderHook(() => useVerifyOtp(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ email: "u@e.de", token: "123456" });
    });
    await waitFor(() => expect(verifyEmailOtp).toHaveBeenCalledOnce());
    expect(vi.mocked(verifyEmailOtp).mock.calls.at(0)?.[0]).toEqual({
      email: "u@e.de",
      token: "123456",
    });
  });

  it("surfaces rejection through the mutation error state", async () => {
    const err = Object.assign(new Error("invalid_otp"), { status: 401 });
    vi.mocked(verifyEmailOtp).mockRejectedValueOnce(err);
    const { result } = renderHook(() => useVerifyOtp(), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ email: "u@e.de", token: "000000" })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(err);
  });
});
```

- [ ] **Step 3: Write the failing use-sign-out test**

`src/features/auth/hooks/__tests__/use-sign-out.test.ts`:

```ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn(() => Promise.resolve());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const purgePersistedCache = vi.fn(() => Promise.resolve());
vi.mock("@/shared/lib/idb-persister", () => ({ purgePersistedCache }));

vi.mock("@/features/auth/api/auth", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/auth/api/auth")
  >("@/features/auth/api/auth");
  return { ...actual, signOut: vi.fn(() => Promise.resolve()) };
});

import { AUTH_KEYS, signOut } from "../../api/auth";
import { useSignOut } from "../use-sign-out";

describe("useSignOut", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    navigate.mockClear();
    purgePersistedCache.mockClear();
    vi.mocked(signOut).mockReset();
    vi.mocked(signOut).mockResolvedValue(undefined);
    queryClient = new QueryClient();
    queryClient.setQueryData(AUTH_KEYS.session(), { user: { id: "u1" } });
    queryClient.setQueryData(["boards", "list"], [{ id: "b1" }]);
  });
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }

  it("clears local state, purges cache, and redirects even if the remote call fails", async () => {
    vi.mocked(signOut).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useSignOut(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/sign-in" }));
    expect(queryClient.getQueryData(AUTH_KEYS.session())).toBeNull();
    expect(queryClient.getQueryData(["boards", "list"])).toBeUndefined();
    expect(purgePersistedCache).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm test -- src/features/auth/hooks`
Expected: FAIL, cannot resolve the hook modules.

- [ ] **Step 5: Implement the four hooks**

`src/features/auth/hooks/use-session.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { AUTH_KEYS, getSession } from "../api/auth";
import type { AuthSession, AuthUser } from "../types";

type UseSessionResult = {
  session: AuthSession | null;
  user: AuthUser | null;
  isLoading: boolean;
  isError: boolean;
};

export function useSession(): UseSessionResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: AUTH_KEYS.session(),
    queryFn: getSession,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return {
    session: data ?? null,
    user: data?.user ?? null,
    isLoading,
    isError,
  };
}
```

`src/features/auth/hooks/use-sign-in.ts`:

```ts
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
```

`src/features/auth/hooks/use-verify-otp.ts`:

```ts
import { useMutation } from "@tanstack/react-query";
import { type VerifyEmailOtpInput, verifyEmailOtp } from "../api/auth";

export function useVerifyOtp() {
  return useMutation<void, Error, VerifyEmailOtpInput>({
    mutationFn: verifyEmailOtp,
    // OTP failures render inline below the code cells; suppress the global
    // toast to avoid doubling up.
    meta: { op: "signIn.verifyOtp", suppressToast: true },
  });
}
```

`src/features/auth/hooks/use-sign-out.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { purgePersistedCache } from "@/shared/lib/idb-persister";
import { noop } from "@/shared/lib/noop";
import { AUTH_KEYS, signOut } from "../api/auth";

export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation<void, never, void>({
    // Sign-out is an exit path: a failing remote call (offline, expired token)
    // must not prevent the local cache clear and redirect.
    mutationFn: async () => {
      try {
        await signOut();
      } catch {
        // intentionally swallowed; the user is leaving regardless
      }
    },
    onSettled: async () => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== AUTH_KEYS.all[0],
      });
      queryClient.setQueryData(AUTH_KEYS.session(), null);
      // Purge the persisted offline cache so a shared device never carries
      // this user's board data into the next session. Best-effort.
      await purgePersistedCache().then(noop, noop);
      await navigate({ to: "/sign-in" });
    },
  });
}
```

- [ ] **Step 6: Confirm `purgePersistedCache` and `noop` exist**

Run: `rg -n "export function purgePersistedCache|export const noop|export function noop" src/shared/lib/idb-persister.ts src/shared/lib/noop.ts`
Expected: both symbols found. If `purgePersistedCache` is absent, check the actual export name in `src/shared/lib/idb-persister.ts` and use it.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test -- src/features/auth/hooks`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
pnpm check
git add src/features/auth/hooks
git commit -m "feat(auth): add session and mutation hooks"
```

---

### Task 4: Route guards and boot-time session seed

**Files:**
- Create: `src/features/auth/guards.ts`
- Test: `src/features/auth/__tests__/guards.test.ts`

**Interfaces:**
- Consumes: `AUTH_KEYS`, `getSession`, `readStoredSession` (Task 1); `sanitizeRedirect` (Task 2); `redirect` from `@tanstack/react-router`.
- Produces:
  - `seedSessionFromStorage(queryClient: QueryClient): void`
  - `requireAuth(args: { context: { queryClient: QueryClient }; location: { href: string } }): Promise<void>`
  - `requireGuest(args: { context: { queryClient: QueryClient } }): Promise<void>`

- [ ] **Step 1: Write the failing test**

`src/features/auth/__tests__/guards.test.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/auth/api/auth", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/auth/api/auth")
  >("@/features/auth/api/auth");
  return {
    ...actual,
    readStoredSession: vi.fn(() => null),
    getSession: vi.fn(() => Promise.resolve(null)),
  };
});

import { AUTH_KEYS, readStoredSession } from "../api/auth";
import { requireAuth, requireGuest, seedSessionFromStorage } from "../guards";

const SESSION = { access_token: "t", user: { id: "u1" } };

describe("seedSessionFromStorage", () => {
  beforeEach(() => vi.mocked(readStoredSession).mockReset());

  it("seeds the cache from the stored blob", () => {
    vi.mocked(readStoredSession).mockReturnValueOnce(SESSION as never);
    const qc = new QueryClient();
    seedSessionFromStorage(qc);
    expect(qc.getQueryData(AUTH_KEYS.session())).toEqual(SESSION);
  });

  it("does not overwrite an already-cached session", () => {
    const qc = new QueryClient();
    qc.setQueryData(AUTH_KEYS.session(), SESSION);
    seedSessionFromStorage(qc);
    expect(readStoredSession).not.toHaveBeenCalled();
  });
});

describe("requireAuth", () => {
  it("resolves when a session is cached", async () => {
    const qc = new QueryClient();
    qc.setQueryData(AUTH_KEYS.session(), SESSION);
    await expect(
      requireAuth({ context: { queryClient: qc }, location: { href: "/x" } })
    ).resolves.toBeUndefined();
  });

  it("throws a redirect to /sign-in when there is no session", async () => {
    const qc = new QueryClient();
    qc.setQueryData(AUTH_KEYS.session(), null);
    await expect(
      requireAuth({
        context: { queryClient: qc },
        location: { href: "/boards/b1" },
      })
    ).rejects.toMatchObject({
      to: "/sign-in",
      search: { redirect: "/boards/b1" },
    });
  });
});

describe("requireGuest", () => {
  it("throws a redirect to / when a session is cached", async () => {
    const qc = new QueryClient();
    qc.setQueryData(AUTH_KEYS.session(), SESSION);
    await expect(
      requireGuest({ context: { queryClient: qc } })
    ).rejects.toMatchObject({ to: "/" });
  });

  it("resolves when there is no session", async () => {
    const qc = new QueryClient();
    qc.setQueryData(AUTH_KEYS.session(), null);
    await expect(
      requireGuest({ context: { queryClient: qc } })
    ).resolves.toBeUndefined();
  });
});
```

Note: TanStack Router's `redirect()` returns a throwable whose `.to` and `.search` are readable, so `rejects.toMatchObject` works.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/features/auth/__tests__/guards.test.ts`
Expected: FAIL, cannot resolve `../guards`.

- [ ] **Step 3: Implement the guards**

`src/features/auth/guards.ts`:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { AUTH_KEYS, getSession, readStoredSession } from "./api/auth";
import { sanitizeRedirect } from "./lib/sanitize-redirect";
import type { AuthSession } from "./types";

/**
 * Seed the cached session from Supabase's localStorage blob at startup so the
 * route guard resolves a returning user offline without the network-capable,
 * potentially-blocking getSession() on a cold boot. No-op when already cached.
 */
export function seedSessionFromStorage(queryClient: QueryClient): void {
  if (queryClient.getQueryData(AUTH_KEYS.session()) !== undefined) {
    return;
  }
  const stored = readStoredSession();
  if (stored) {
    queryClient.setQueryData(AUTH_KEYS.session(), stored);
  }
}

type GuardContext = { context: { queryClient: QueryClient } };
type RequireAuthArgs = GuardContext & { location: { href: string } };

// Synchronous on the warm path (cache populated by <AuthSync /> or the boot
// seed) so navigations skip the network. fetchQuery covers only the cold path.
function readSession(queryClient: QueryClient): Promise<AuthSession | null> {
  const cached = queryClient.getQueryData<AuthSession | null>(
    AUTH_KEYS.session()
  );
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  return queryClient.fetchQuery({
    queryKey: AUTH_KEYS.session(),
    queryFn: getSession,
  });
}

export async function requireAuth({
  context,
  location,
}: RequireAuthArgs): Promise<void> {
  const session = await readSession(context.queryClient);
  if (session) {
    return;
  }
  throw redirect({
    to: "/sign-in",
    search: { redirect: sanitizeRedirect(location.href) },
  });
}

export async function requireGuest({ context }: GuardContext): Promise<void> {
  const session = await readSession(context.queryClient);
  if (!session) {
    return;
  }
  throw redirect({ to: "/" });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/features/auth/__tests__/guards.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm check
git add src/features/auth/guards.ts src/features/auth/__tests__/guards.test.ts
git commit -m "feat(auth): add route guards and boot-time session seed"
```

---

### Task 5: AuthSync component

**Files:**
- Create: `src/features/auth/components/auth-sync.tsx`
- Test: `src/features/auth/components/__tests__/auth-sync.test.tsx`

**Interfaces:**
- Consumes: `AUTH_KEYS`, `subscribeToAuthChanges` (Task 1).
- Produces: `AuthSync(): null`.

- [ ] **Step 1: Write the failing test**

`src/features/auth/components/__tests__/auth-sync.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthSession } from "../../types";

let captured: ((session: AuthSession | null) => void) | null = null;
const unsubscribe = vi.fn();
vi.mock("@/features/auth/api/auth", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/auth/api/auth")
  >("@/features/auth/api/auth");
  return {
    ...actual,
    subscribeToAuthChanges: (handler: (s: AuthSession | null) => void) => {
      captured = handler;
      return unsubscribe;
    },
  };
});

import { AUTH_KEYS } from "../../api/auth";
import { AuthSync } from "../auth-sync";

describe("AuthSync", () => {
  beforeEach(() => {
    captured = null;
    unsubscribe.mockClear();
  });

  it("writes the session from an auth change into the cache", () => {
    const qc = new QueryClient();
    function wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    const { unmount } = render(<AuthSync />, { wrapper });
    const session = { access_token: "t", user: { id: "u1" } } as AuthSession;
    captured?.(session);
    expect(qc.getQueryData(AUTH_KEYS.session())).toEqual(session);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/features/auth/components/__tests__/auth-sync.test.tsx`
Expected: FAIL, cannot resolve `../auth-sync`.

- [ ] **Step 3: Implement AuthSync**

`src/features/auth/components/auth-sync.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AUTH_KEYS, subscribeToAuthChanges } from "../api/auth";

// Sets the session from the authoritative onAuthStateChange event (not
// invalidate; the "invalidate, don't merge" rule applies to postgres_changes
// data payloads, not the auth event).
export function AuthSync(): null {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((session) => {
      queryClient.setQueryData(AUTH_KEYS.session(), session);
    });
    return unsubscribe;
  }, [queryClient]);
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/features/auth/components/__tests__/auth-sync.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm check
git add src/features/auth/components/auth-sync.tsx src/features/auth/components/__tests__/auth-sync.test.tsx
git commit -m "feat(auth): add AuthSync to mirror GoTrue events into the cache"
```

---

### Task 6: SignInForm and SignOutButton components

**Files:**
- Setup: add `input-otp` shadcn primitive (`src/shared/components/ui/input-otp.tsx`)
- Create: `src/features/auth/components/sign-in-form.tsx`
- Create: `src/features/auth/components/sign-out-button.tsx`
- Test: `src/features/auth/components/__tests__/sign-in-form.test.tsx`

**Interfaces:**
- Consumes: `useSignIn`, `useVerifyOtp` (Task 3); `useSignOut` (Task 3); classifiers and copy (Task 2); `sanitizeRedirect` (Task 2).
- Produces:
  - `SignInForm(props: { redirect: string }): JSX.Element` — `redirect` is the sanitized post-login target.
  - `SignOutButton(): JSX.Element`.

- [ ] **Step 1: Add the input-otp primitive**

Run: `pnpm dlx shadcn@latest add input-otp`
Expected: creates `src/shared/components/ui/input-otp.tsx`. If it prompts, accept defaults. Confirm the file exists:
Run: `ls src/shared/components/ui/input-otp.tsx`

- [ ] **Step 2: Write the failing SignInForm test**

`src/features/auth/components/__tests__/sign-in-form.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMagicLink = vi.fn(() => Promise.resolve());
const verifyEmailOtp = vi.fn(() => Promise.resolve());
vi.mock("@/features/auth/api/auth", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/auth/api/auth")
  >("@/features/auth/api/auth");
  return {
    ...actual,
    requestMagicLink: (...a: unknown[]) => requestMagicLink(...a),
    verifyEmailOtp: (...a: unknown[]) => verifyEmailOtp(...a),
  };
});

import { SignInForm } from "../sign-in-form";

function renderForm() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return render(<SignInForm redirect="/" />, { wrapper });
}

describe("SignInForm", () => {
  beforeEach(() => {
    requestMagicLink.mockReset();
    requestMagicLink.mockResolvedValue(undefined);
    verifyEmailOtp.mockReset();
    verifyEmailOtp.mockResolvedValue(undefined);
  });

  it("advances to the OTP step after sending", async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/E-Mail/i), "alice@dev.local");
    await userEvent.click(screen.getByRole("button", { name: /Anmeldelink/i }));
    await waitFor(() =>
      expect(screen.getByText(/Code eingeben/i)).toBeInTheDocument()
    );
    expect(requestMagicLink).toHaveBeenCalledOnce();
  });

  it("advances to the OTP step even on a 422 (anti-enumeration)", async () => {
    requestMagicLink.mockRejectedValueOnce(
      Object.assign(new Error("Signups not allowed"), { status: 422 })
    );
    renderForm();
    await userEvent.type(screen.getByLabelText(/E-Mail/i), "nobody@dev.local");
    await userEvent.click(screen.getByRole("button", { name: /Anmeldelink/i }));
    await waitFor(() =>
      expect(screen.getByText(/Falls ein Konto/i)).toBeInTheDocument()
    );
  });

  it("shows an inline error on a rate limit (429)", async () => {
    requestMagicLink.mockRejectedValueOnce(
      Object.assign(new Error("rate"), { status: 429 })
    );
    renderForm();
    await userEvent.type(screen.getByLabelText(/E-Mail/i), "alice@dev.local");
    await userEvent.click(screen.getByRole("button", { name: /Anmeldelink/i }));
    await waitFor(() =>
      expect(screen.getByText(/Zu viele Versuche/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- src/features/auth/components/__tests__/sign-in-form.test.tsx`
Expected: FAIL, cannot resolve `../sign-in-form`.

- [ ] **Step 4: Implement SignInForm**

`src/features/auth/components/sign-in-form.tsx`:

```tsx
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { type FormEvent, useState } from "react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/shared/components/ui/input-otp";
import {
  classifyEmailSubmitError,
  classifyOtpError,
} from "../lib/classify-auth-error";
import {
  CTA_RESEND,
  CTA_SEND_CODE,
  CTA_SENDING,
  CTA_USE_OTHER_EMAIL,
  CTA_VERIFY,
  CTA_VERIFYING,
  EMAIL_LABEL,
  EMAIL_PLACEHOLDER,
  ERROR_OTP_INVALID,
  ERROR_RATE_LIMIT,
  ERROR_TRANSPORT,
  OTP_HEADING,
  OTP_SENT_NEUTRAL,
  SIGN_IN_HEADING,
  SIGN_IN_SUBHEAD,
} from "../lib/copy";
import { useSignIn } from "../hooks/use-sign-in";
import { useVerifyOtp } from "../hooks/use-verify-otp";

const OTP_LENGTH = 6;

type Step = "email" | "otp";

function callbackUrl(redirect: string): string {
  const target = encodeURIComponent(redirect);
  return `${window.location.origin}/auth/callback?redirect=${target}`;
}

export function SignInForm({ redirect }: { redirect: string }) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);

  const signIn = useSignIn();
  const verify = useVerifyOtp();

  async function send(): Promise<void> {
    setEmailError(null);
    try {
      await signIn.mutateAsync({ email, redirectTo: callbackUrl(redirect) });
      setStep("otp");
    } catch (error) {
      const kind = classifyEmailSubmitError(error);
      if (kind === "anti-enumeration") {
        // Never reveal that the address is unknown. Advance as if sent.
        setStep("otp");
        return;
      }
      setEmailError(kind === "rate-limit" ? ERROR_RATE_LIMIT : ERROR_TRANSPORT);
    }
  }

  function onEmailSubmit(event: FormEvent): void {
    event.preventDefault();
    void send();
  }

  async function onVerify(value: string): Promise<void> {
    setOtpError(null);
    try {
      await verify.mutateAsync({ email, token: value });
      // On success, onAuthStateChange fires and the guard reroutes.
    } catch (error) {
      const kind = classifyOtpError(error);
      setCode("");
      if (kind === "rate-limit") {
        setOtpError(ERROR_RATE_LIMIT);
      } else if (kind === "invalid-or-expired") {
        setOtpError(ERROR_OTP_INVALID);
      } else {
        setOtpError(ERROR_TRANSPORT);
      }
    }
  }

  function onCodeChange(value: string): void {
    setCode(value);
    if (value.length === OTP_LENGTH) {
      void onVerify(value);
    }
  }

  if (step === "otp") {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <div className="text-center">
          <h1 className="font-semibold text-2xl tracking-tight">{OTP_HEADING}</h1>
          <p className="mt-2 text-muted-foreground text-sm">{OTP_SENT_NEUTRAL}</p>
        </div>
        <div className="flex justify-center">
          <InputOTP
            aria-label={OTP_HEADING}
            disabled={verify.isPending}
            maxLength={OTP_LENGTH}
            onChange={onCodeChange}
            pattern={REGEXP_ONLY_DIGITS}
            value={code}
          >
            <InputOTPGroup>
              {Array.from({ length: OTP_LENGTH }, (_, i) => (
                <InputOTPSlot index={i} key={`otp-${i}`} />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>
        {otpError ? (
          <p className="text-center text-destructive text-sm" role="alert">
            {otpError}
          </p>
        ) : null}
        <button
          className="text-muted-foreground text-sm underline-offset-4 hover:underline disabled:opacity-60"
          disabled={signIn.isPending}
          onClick={() => void send()}
          type="button"
        >
          {CTA_RESEND}
        </button>
        <button
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          onClick={() => {
            setStep("email");
            setCode("");
            setOtpError(null);
          }}
          type="button"
        >
          {CTA_USE_OTHER_EMAIL}
        </button>
        <span aria-hidden className="sr-only">
          {verify.isPending ? CTA_VERIFYING : CTA_VERIFY}
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="text-center">
        <h1 className="font-semibold text-2xl tracking-tight">
          {SIGN_IN_HEADING}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">{SIGN_IN_SUBHEAD}</p>
      </div>
      <form className="flex flex-col gap-3" onSubmit={onEmailSubmit}>
        <label className="flex flex-col gap-1 text-sm" htmlFor="email">
          <span className="text-muted-foreground">{EMAIL_LABEL}</span>
          <input
            autoComplete="email"
            className="rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder={EMAIL_PLACEHOLDER}
            required
            type="email"
            value={email}
          />
        </label>
        {emailError ? (
          <p className="text-destructive text-sm" role="alert">
            {emailError}
          </p>
        ) : null}
        <button
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm disabled:opacity-60"
          disabled={signIn.isPending}
          type="submit"
        >
          {signIn.isPending ? CTA_SENDING : CTA_SEND_CODE}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Implement SignOutButton**

`src/features/auth/components/sign-out-button.tsx`:

```tsx
import { useSignOut } from "../hooks/use-sign-out";
import { SIGN_OUT } from "../lib/copy";

export function SignOutButton() {
  const signOut = useSignOut();
  return (
    <button
      className="rounded-md px-3 py-2 font-medium text-muted-foreground text-sm hover:text-foreground disabled:opacity-60"
      disabled={signOut.isPending}
      onClick={() => signOut.mutate()}
      type="button"
    >
      {SIGN_OUT}
    </button>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- src/features/auth/components/__tests__/sign-in-form.test.tsx`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
pnpm check
git add src/shared/components/ui/input-otp.tsx src/features/auth/components/sign-in-form.tsx src/features/auth/components/sign-out-button.tsx src/features/auth/components/__tests__/sign-in-form.test.tsx
git commit -m "feat(auth): add sign-in form and sign-out button"
```

---

### Task 7: Public API surface (index.ts)

**Files:**
- Create: `src/features/auth/index.ts`

**Interfaces:**
- Produces the feature's public exports consumed by `app/routes/*`.

- [ ] **Step 1: Write index.ts**

`src/features/auth/index.ts`:

```ts
// biome-ignore-all lint/performance/noBarrelFile: feature public surface per .claude/rules/architecture.md
export { AUTH_KEYS, subscribeToAuthChanges } from "./api/auth";
export { AuthSync } from "./components/auth-sync";
export { SignInForm } from "./components/sign-in-form";
export { SignOutButton } from "./components/sign-out-button";
export { requireAuth, requireGuest, seedSessionFromStorage } from "./guards";
export { useSession } from "./hooks/use-session";
export { useSignIn } from "./hooks/use-sign-in";
export { useSignOut } from "./hooks/use-sign-out";
export { useVerifyOtp } from "./hooks/use-verify-otp";
export { sanitizeRedirect } from "./lib/sanitize-redirect";
export type { AuthSession, AuthUser } from "./types";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: `tsc -b` passes (the exports resolve). Vite build may warn about unused routes; that is fine until Task 8.

- [ ] **Step 3: Commit**

```bash
pnpm check
git add src/features/auth/index.ts
git commit -m "feat(auth): expose the auth feature public API"
```

---

### Task 8: Route wiring (guard, sign-in, callback, boot seed)

**Files:**
- Modify: `src/app/routes/__root.tsx` (mount `<AuthSync />`)
- Create: `src/app/routes/_authed.tsx`
- Rename: `src/app/routes/index.tsx` → `src/app/routes/_authed.index.tsx`
- Rename: `src/app/routes/boards.$boardId.tsx` → `src/app/routes/_authed.boards.$boardId.tsx`
- Modify: `src/app/routes/sign-in.tsx`
- Create: `src/app/routes/auth.callback.tsx`
- Modify: `src/app/main.tsx` (call `seedSessionFromStorage`)

**Interfaces:**
- Consumes: `AuthSync`, `requireAuth`, `requireGuest`, `seedSessionFromStorage`, `SignInForm`, `SignOutButton`, `sanitizeRedirect`, `subscribeToAuthChanges` (Task 7).

- [ ] **Step 1: Mount AuthSync in the root**

In `src/app/routes/__root.tsx`, add the import and render `<AuthSync />` inside the layout, above `<Outlet />`:

```tsx
import { AuthSync } from "@/features/auth";
```

Change the layout body to:

```tsx
      <div className="mx-auto flex h-full max-w-6xl flex-col">
        <AuthSync />
        <Outlet />
      </div>
```

- [ ] **Step 2: Create the pathless authed layout**

`src/app/routes/_authed.tsx`:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth, SignOutButton } from "@/features/auth";

export const Route = createFileRoute("/_authed")({
  beforeLoad: requireAuth,
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold tracking-tight">Pinnwand</span>
        <SignOutButton />
      </header>
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 3: Move the boards index under the layout**

Move `src/app/routes/index.tsx` to `src/app/routes/_authed.index.tsx` and change the route id:

```bash
git mv src/app/routes/index.tsx src/app/routes/_authed.index.tsx
```

Then edit the `createFileRoute` path in that file from `"/"` to `"/_authed/"`:

```tsx
export const Route = createFileRoute("/_authed/")({
  component: BoardsIndex,
});
```

- [ ] **Step 4: Move the board detail under the layout**

```bash
git mv src/app/routes/boards.$boardId.tsx src/app/routes/_authed.boards.$boardId.tsx
```

Then change its `createFileRoute` path from `"/boards/$boardId"` to `"/_authed/boards/$boardId"`. Leave the component body unchanged.

- [ ] **Step 5: Rewrite the sign-in route**

`src/app/routes/sign-in.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireGuest, sanitizeRedirect, SignInForm } from "@/features/auth";

const SearchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/sign-in")({
  validateSearch: SearchSchema,
  beforeLoad: requireGuest,
  component: SignIn,
});

function SignIn() {
  const { redirect } = Route.useSearch();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <SignInForm redirect={sanitizeRedirect(redirect)} />
    </div>
  );
}
```

- [ ] **Step 6: Create the callback route**

`src/app/routes/auth.callback.tsx`:

```tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { sanitizeRedirect, subscribeToAuthChanges } from "@/features/auth";
import {
  BACK_TO_SIGN_IN,
  CALLBACK_BODY,
  CALLBACK_ERROR_HEADING,
  CALLBACK_ERROR_TIMEOUT,
  CALLBACK_HEADING,
} from "@/features/auth/lib/copy";

const SearchSchema = z.object({
  redirect: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

// Generous enough for a mobile cold start plus a flaky cellular GoTrue verify
// round-trip. Below this, valid links produced false "couldn't sign you in".
const EXCHANGE_TIMEOUT_MS = 8000;

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
      void navigate({ to: sanitizeRedirect(search.redirect) });
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
          <p className="max-w-sm text-muted-foreground text-sm">{errorMessage}</p>
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
```

- [ ] **Step 7: Seed the session at boot**

In `src/app/main.tsx`, add the import and call `seedSessionFromStorage(queryClient)` at the registration point (the block whose comment starts "NOTE: each offline-first feature registers..."), before `createIdbPersister()` is used:

```tsx
import { seedSessionFromStorage } from "@/features/auth";
```

```tsx
// Prime the session cache synchronously from Supabase's stored blob so the
// route guard resolves a returning user on a cold (possibly offline) boot
// without a blocking getSession().
seedSessionFromStorage(queryClient);
```

- [ ] **Step 8: Regenerate the route tree and build**

Run: `pnpm build`
Expected: the tanstack-router plugin regenerates `src/app/routeTree.gen.ts` with `_authed`, `_authed/`, `_authed/boards/$boardId`, `sign-in`, `auth/callback`. `tsc -b` and the vite build pass.
If the plugin does not run under `build`, run `pnpm dev` briefly to regenerate, then stop it and re-run `pnpm build`.

- [ ] **Step 9: Run the full unit suite**

Run: `pnpm test`
Expected: PASS (all auth unit/component tests green; no regressions).

- [ ] **Step 10: Lint and commit**

```bash
pnpm check
git add src/app
git commit -m "feat(auth): guard the app shell, wire sign-in and callback routes"
```

---

### Task 9: Profiles trigger and RLS integration test

**Files:**
- Test: `src/features/auth/api/profiles.integration.test.ts`

**Interfaces:**
- Consumes: `createAuthUser`, `withRls`, `asService`, `teardownPool` from `@/test/with-rls`.
- Asserts the behavior of `handle_new_user` and the `profiles` RLS policies from `supabase/migrations/20260706120000_init.sql`.

- [ ] **Step 1: Write the integration test**

`src/features/auth/api/profiles.integration.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asService, createAuthUser, teardownPool, withRls } from "@/test/with-rls";

type ProfileRow = { id: string; display_name: string };

afterAll(async () => {
  await teardownPool();
});

describe("handle_new_user trigger", () => {
  it("seeds a profiles row with the email local-part as display name", async () => {
    const email = `trig-${Date.now()}@test.local`;
    const userId = await createAuthUser(email);

    const rows = await asService(
      (sql) =>
        sql<ProfileRow[]>/* sql */ `
          select id, display_name from public.profiles where id = ${userId}
        `
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: userId,
      display_name: email.split("@")[0],
    });
  });
});

describe("profiles RLS", () => {
  it("lets a user read their own profile", async () => {
    const userId = await createAuthUser(`self-${Date.now()}@test.local`);
    const rows = await withRls(
      userId,
      (sql) =>
        sql<{ id: string }[]>/* sql */ `
          select id from public.profiles where id = ${userId}
        `
    );
    expect(rows).toEqual([{ id: userId }]);
  });

  it("hides an unrelated user's profile", async () => {
    const a = await createAuthUser(`iso-a-${Date.now()}@test.local`);
    const b = await createAuthUser(`iso-b-${Date.now()}@test.local`);
    const rows = await withRls(
      a,
      (sql) =>
        sql<{ id: string }[]>/* sql */ `
          select id from public.profiles where id = ${b}
        `
    );
    expect(rows).toEqual([]);
  });

  it("lets a user update only their own display name", async () => {
    const a = await createAuthUser(`upd-a-${Date.now()}@test.local`);
    const b = await createAuthUser(`upd-b-${Date.now()}@test.local`);

    await withRls(a, async (sql) => {
      await sql/* sql */ `
        update public.profiles set display_name = 'Alice' where id = ${a}
      `;
    });
    // The update targets B but RLS's WITH CHECK / USING scopes it to auth.uid(),
    // so zero rows change and B stays as seeded.
    await withRls(a, async (sql) => {
      await sql/* sql */ `
        update public.profiles set display_name = 'Hacked' where id = ${b}
      `;
    });

    const rows = await asService(
      (sql) =>
        sql<ProfileRow[]>/* sql */ `
          select id, display_name from public.profiles where id in (${a}, ${b})
        `
    );
    const byId = new Map(rows.map((r) => [r.id, r.display_name]));
    expect(byId.get(a)).toBe("Alice");
    expect(byId.get(b)).not.toBe("Hacked");
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `pnpm test:integration -- src/features/auth/api/profiles.integration.test.ts`

If no `test:integration` script exists, check `package.json` for the integration runner (it uses `vitest.integration.config.ts`), e.g.:
Run: `pnpm vitest run --config vitest.integration.config.ts src/features/auth/api/profiles.integration.test.ts`
Expected: PASS. First run boots the Supabase Postgres testcontainer (may take up to ~4 minutes).

- [ ] **Step 3: Commit**

```bash
git add src/features/auth/api/profiles.integration.test.ts
git commit -m "test(auth): cover handle_new_user trigger and profiles RLS"
```

---

### Task 10: End-to-end sign-in, guard, sign-out

**Files:**
- Modify: `e2e/smoke.spec.ts` (or add `e2e/auth.spec.ts` if smoke is reserved)
- Reference: `e2e/helpers/mailpit.ts`, `e2e/helpers/direct-auth.ts`

**Interfaces:**
- Consumes: `createAuthenticatedUser` (installs a session under the storage key), and the mailpit helper for the real OTP path.

- [ ] **Step 1: Read the current smoke spec and helpers**

Run: `cat e2e/smoke.spec.ts && rg -n "export" e2e/helpers/mailpit.ts`
Decide whether to extend `smoke.spec.ts` or add `e2e/auth.spec.ts`. The guard and sign-out cases below use the direct-auth helper; the real OTP case uses mailpit.

- [ ] **Step 2: Add the guard redirect test**

Add to the chosen spec file:

```ts
import { expect, test } from "@playwright/test";
import { createAuthenticatedUser } from "./helpers/direct-auth";

test("redirects an anonymous visitor to sign-in", async ({ page }) => {
  await page.goto("/boards/some-id");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: /Anmelden/i })).toBeVisible();
});

test("an authenticated user reaches the app and can sign out", async ({
  page,
}) => {
  const user = await createAuthenticatedUser(page);
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: /Abmelden/i }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await user.cleanup();
});
```

- [ ] **Step 3: Add the real OTP sign-in test**

Use the mailpit helper to read the 6-digit code. Confirm the helper's exported function name from Step 1 (for example `readLatestOtp(email)`); adjust the import to match. Then:

```ts
import { adminClient } from "./helpers/direct-auth";
// import { readLatestOtp } from "./helpers/mailpit"; // confirm the real name

test("signs in with the 6-digit OTP", async ({ page }) => {
  const email = `otp-${Date.now()}@example.com`;
  const { data } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  const userId = data.user?.id as string;

  await page.goto("/sign-in");
  await page.getByLabel(/E-Mail/i).fill(email);
  await page.getByRole("button", { name: /Anmeldelink/i }).click();
  await expect(page.getByText(/Code eingeben/i)).toBeVisible();

  const code = await readLatestOtp(email); // 6-digit string from the email
  await page.getByLabel(/Code eingeben/i).fill(code);

  await expect(page).toHaveURL(/\/$/);
  await adminClient.auth.admin.deleteUser(userId);
});
```

If `mailpit.ts` exposes only a magic-link extractor and not an OTP reader, add a small `readLatestOtp(email)` export there that fetches the latest message body for `to:email` and matches `/\b(\d{6})\b/` in the text part. Keep it consistent with the existing polling helper.

- [ ] **Step 4: Run e2e**

Run: `pnpm e2e`
Expected: the auth tests pass against the sealed Dockerized stack. First run builds the stack.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test(auth): e2e sign-in with OTP, guard redirect, sign-out"
```

---

## Self-Review

**Spec coverage:** Every spec section maps to a task. api/auth adapter (T1), sanitize-redirect + classifiers + copy (T2), hooks incl. hardened sign-out (T3), guards + boot seed (T4), AuthSync (T5), SignInForm + SignOutButton + input-otp (T6), index.ts public surface (T7), pathless `_authed` layout + sign-in + callback + main.tsx seed (T8), profiles trigger + RLS integration (T9), e2e live path + guard + sign-out (T10). Enumeration handling: classifiers (T2) + form behavior (T6). suppressToast: hooks (T3), already supported by `query-client.ts`. Offline-first guard: readStoredSession (T1) + seedSessionFromStorage + cache-first requireAuth (T4). Out-of-scope items (passkeys, email-change, profile editing) have no tasks, as intended.

**Placeholder scan:** No TBD/TODO. Each code step carries full code. The two spots that say "confirm the real name" (idb-persister export in T3 Step 6, mailpit OTP reader in T10 Step 3) are explicit verification steps against existing files, not deferred implementation.

**Type consistency:** `AUTH_KEYS.session()` returns `['auth','session']` everywhere. `requestMagicLink({ email, redirectTo })`, `verifyEmailOtp({ email, token })`, `signOut()`, `getSession()`, `subscribeToAuthChanges(handler) => () => void`, `readStoredSession()` consistent across T1/T3/T4/T5/T8. `SignInForm({ redirect })` consumed in T8 Step 5 matches T6 Step 4. `requireAuth`/`requireGuest`/`seedSessionFromStorage` signatures match between T4 and T8.
