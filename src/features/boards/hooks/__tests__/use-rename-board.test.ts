import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardMembership } from "../../types";

const MOCK_USER_ID = "33333333-3333-3333-3333-333333333333";
const BOARD_ID = "b3";

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
  return { ...actual, renameBoard: vi.fn() };
});

import { BOARD_KEYS, renameBoard } from "../../api/boards";
import { useRenameBoard } from "../use-rename-board";

const INITIAL_BOARD = {
  id: BOARD_ID,
  name: "Altes Board",
  joinCode: "ABCD2345",
  createdBy: MOCK_USER_ID,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const INITIAL_MEMBERSHIPS: BoardMembership[] = [
  { role: "owner", board: INITIAL_BOARD },
];

describe("useRenameBoard", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.mocked(renameBoard).mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(
      BOARD_KEYS.byUser(MOCK_USER_ID),
      INITIAL_MEMBERSHIPS
    );
  });

  function wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  }

  it("optimistically updates the cached board name before the api resolves", async () => {
    let resolveRename: () => void = () => undefined;
    vi.mocked(renameBoard).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRename = () =>
            resolve({ ...INITIAL_BOARD, name: "Neuer Name" });
        })
    );

    const { result } = renderHook(() => useRenameBoard(BOARD_ID), { wrapper });

    act(() => {
      result.current.mutate({ name: "Neuer Name" });
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<BoardMembership[]>(
        BOARD_KEYS.byUser(MOCK_USER_ID)
      );
      expect(cached?.[0]?.board.name).toBe("Neuer Name");
    });

    resolveRename();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back the cached name when the api rejects", async () => {
    vi.mocked(renameBoard).mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useRenameBoard(BOARD_ID), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ name: "Wird zurückgerollt" })
        .catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = queryClient.getQueryData<BoardMembership[]>(
      BOARD_KEYS.byUser(MOCK_USER_ID)
    );
    expect(cached?.[0]?.board.name).toBe("Altes Board");
  });
});
