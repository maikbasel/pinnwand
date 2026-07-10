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
    if (!StoredSessionShape.safeParse(parsed).success) {
      return null;
    }
    // Validated: `parsed` carries at least the guard's fields. Widen to the
    // SDK's Session, which owns the full persisted shape.
    return parsed as AuthSession;
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
