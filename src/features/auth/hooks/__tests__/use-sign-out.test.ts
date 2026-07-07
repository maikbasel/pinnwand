import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn(() => Promise.resolve());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

// vi.mock factories are hoisted above top-level const declarations, so a
// plain `const purgePersistedCache = vi.fn(...)` referenced by shorthand
// inside the factory throws "Cannot access before initialization". vi.hoisted
// hoists this declaration alongside vi.mock so the factory can see it.
const purgePersistedCache = vi.hoisted(() => vi.fn(() => Promise.resolve()));
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
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  }

  it("clears local state, purges cache, and redirects even if the remote call fails", async () => {
    vi.mocked(signOut).mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useSignOut(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/sign-in" })
    );
    expect(queryClient.getQueryData(AUTH_KEYS.session())).toBeNull();
    expect(queryClient.getQueryData(["boards", "list"])).toBeUndefined();
    expect(purgePersistedCache).toHaveBeenCalledOnce();
  });
});
