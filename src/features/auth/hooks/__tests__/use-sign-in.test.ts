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
    // @tanstack/react-query 5.100+ invokes mutationFn with a second
    // `mutationFnContext` argument ({ client, meta, mutationKey }); assert on
    // the input argument only.
    expect(vi.mocked(requestMagicLink).mock.calls.at(0)?.[0]).toEqual({
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
