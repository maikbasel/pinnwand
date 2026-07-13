import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_KEYS } from "../../api/tasks";
import { POSITION_STEP } from "../../lib/position";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, moveTask: vi.fn() };
});

import { moveTask } from "../../api/tasks";
import { useMoveTask } from "../use-move-task";

function task(id: string, column: Task["column"], position: number): Task {
  return {
    id,
    boardId: "b",
    column,
    title: id,
    description: "",
    priority: "mittel",
    dueDate: null,
    position,
    assigneeIds: [],
    createdBy: null,
    createdAt: "",
    updatedAt: "",
  };
}

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => vi.clearAllMocks());

describe("useMoveTask", () => {
  it("moves to the bottom of the target column and updates the cache column", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    client.setQueryData(TASK_KEYS.byBoard("b"), [
      task("x", "offen", 1024),
      task("y", "erledigt", 5000),
    ]);
    vi.mocked(moveTask).mockImplementation(async (i) =>
      task("x", i.column, i.position)
    );
    const { result } = renderHook(() => useMoveTask("b"), {
      wrapper: wrapperFor(client),
    });
    act(() => {
      result.current.mutate({ taskId: "x", toColumn: "erledigt" });
    });
    await waitFor(() =>
      expect(moveTask).toHaveBeenCalledWith({
        taskId: "x",
        column: "erledigt",
        position: 5000 + POSITION_STEP,
      })
    );
    const cache = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b"));
    expect(cache?.find((t) => t.id === "x")?.column).toBe("erledigt");
  });

  it("rolls the cache back when the move fails", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    client.setQueryData(TASK_KEYS.byBoard("b"), [task("x", "offen", 1024)]);
    vi.mocked(moveTask).mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useMoveTask("b"), {
      wrapper: wrapperFor(client),
    });
    act(() => {
      result.current.mutate({ taskId: "x", toColumn: "erledigt" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const cache = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b"));
    expect(cache?.find((t) => t.id === "x")?.column).toBe("offen");
  });
});
