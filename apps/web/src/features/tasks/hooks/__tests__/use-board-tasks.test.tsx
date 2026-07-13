import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, listBoardTasks: vi.fn() };
});

import { listBoardTasks } from "../../api/tasks";
import { useBoardTasks } from "../use-board-tasks";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const sample: Task = {
  id: "1",
  boardId: "b",
  column: "offen",
  title: "A",
  description: "",
  priority: "mittel",
  dueDate: null,
  position: 10,
  assigneeIds: [],
  createdBy: null,
  createdAt: "",
  updatedAt: "",
};

afterEach(() => vi.clearAllMocks());

describe("useBoardTasks", () => {
  it("returns tasks grouped by column once loaded", async () => {
    vi.mocked(listBoardTasks).mockResolvedValue([sample]);
    const { result } = renderHook(() => useBoardTasks("b"), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.tasksByColumn.offen.map((t) => t.id)).toEqual(["1"]);
    expect(result.current.tasksByColumn.erledigt).toEqual([]);
  });
});
