import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ error: null })
);
const verifyOtp = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ error: null })
);

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
