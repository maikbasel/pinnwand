import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Board, BoardMembership } from "../../types";

const MOCK_USER_ID = "22222222-2222-2222-2222-222222222222";

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
  return {
    ...actual,
    createBoard: vi.fn(),
    listMyBoards: vi.fn(),
  };
});

import { createBoard, listMyBoards } from "../../api/boards";
import { useCreateBoard } from "../use-create-board";
import { useMyBoards } from "../use-my-boards";

const NEW_BOARD: Board = {
  id: "b2",
  name: "Neues Board",
  joinCode: "WXYZ6789",
  createdBy: MOCK_USER_ID,
  createdAt: "2026-01-02T00:00:00.000Z",
};

const REFRESHED_MEMBERSHIPS: BoardMembership[] = [
  { role: "owner", board: NEW_BOARD },
];

function useCombined() {
  return { list: useMyBoards(), create: useCreateBoard() };
}

describe("useCreateBoard", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.mocked(createBoard).mockReset();
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

  it("resolves the created board and refetches the board list via invalidation", async () => {
    vi.mocked(listMyBoards).mockResolvedValueOnce([]);
    vi.mocked(createBoard).mockResolvedValueOnce(NEW_BOARD);
    vi.mocked(listMyBoards).mockResolvedValueOnce(REFRESHED_MEMBERSHIPS);

    const { result } = renderHook(() => useCombined(), { wrapper });

    // Active observer for the board list, seeded with the first resolved value.
    await waitFor(() => expect(result.current.list.memberships).toEqual([]));

    let created: Board | undefined;
    await act(async () => {
      created = await result.current.create.mutateAsync({
        name: "Neues Board",
      });
    });

    expect(created).toEqual(NEW_BOARD);
    await waitFor(() =>
      expect(result.current.list.memberships).toEqual(REFRESHED_MEMBERSHIPS)
    );
    expect(listMyBoards).toHaveBeenCalledTimes(2);
  });
});
