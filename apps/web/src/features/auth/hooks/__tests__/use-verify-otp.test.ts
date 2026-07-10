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
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
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
