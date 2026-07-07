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
