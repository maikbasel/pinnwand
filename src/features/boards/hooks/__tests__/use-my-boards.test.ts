import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardMembership } from "../../types";

const MOCK_USER_ID = "11111111-1111-1111-1111-111111111111";

vi.mock("@/features/auth", () => ({
  useSession: () => ({
    user: { id: MOCK_USER_ID },
    session: null,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/features/boards/api/boards", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/boards/api/boards")
  >("@/features/boards/api/boards");
  return { ...actual, listMyBoards: vi.fn() };
});

import { listMyBoards } from "../../api/boards";
import { useMyBoards } from "../use-my-boards";

const MEMBERSHIPS: BoardMembership[] = [
  {
    role: "owner",
    board: {
      id: "b1",
      name: "Team-Board",
      joinCode: "ABCD2345",
      createdBy: MOCK_USER_ID,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  },
];

describe("useMyBoards", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.mocked(listMyBoards).mockReset();
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

  it("returns the memberships the api resolves", async () => {
    vi.mocked(listMyBoards).mockResolvedValueOnce(MEMBERSHIPS);
    const { result } = renderHook(() => useMyBoards(), { wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.memberships).toEqual(MEMBERSHIPS);
    expect(result.current.isError).toBe(false);
    expect(listMyBoards).toHaveBeenCalledWith(MOCK_USER_ID);
  });

  it("surfaces the error state when the api rejects", async () => {
    vi.mocked(listMyBoards).mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() => useMyBoards(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.memberships).toEqual([]);
  });
});
