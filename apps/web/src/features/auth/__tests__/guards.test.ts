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
      options: { to: "/sign-in", search: { redirect: "/boards/b1" } },
    });
  });
});

describe("requireGuest", () => {
  it("throws a redirect to / when a session is cached", async () => {
    const qc = new QueryClient();
    qc.setQueryData(AUTH_KEYS.session(), SESSION);
    await expect(
      requireGuest({ context: { queryClient: qc } })
    ).rejects.toMatchObject({ options: { to: "/" } });
  });

  it("resolves when there is no session", async () => {
    const qc = new QueryClient();
    qc.setQueryData(AUTH_KEYS.session(), null);
    await expect(
      requireGuest({ context: { queryClient: qc } })
    ).resolves.toBeUndefined();
  });
});
