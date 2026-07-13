import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_KEYS } from "../../api/tasks";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return {
    ...actual,
    reorderTask: vi.fn(),
    renormalizeColumnPositions: vi.fn(),
  };
});

import { renormalizeColumnPositions, reorderTask } from "../../api/tasks";
import { useReorderTask } from "../use-reorder-task";

function task(id: string, position: number): Task {
  return {
    id,
    boardId: "b",
    column: "offen",
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

describe("useReorderTask", () => {
  it("writes the midpoint position for the target index", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    client.setQueryData(TASK_KEYS.byBoard("b"), [
      task("a", 1024),
      task("b", 2048),
      task("c", 3072),
    ]);
    vi.mocked(reorderTask).mockImplementation(async (i) =>
      task("c", i.position)
    );
    const { result } = renderHook(() => useReorderTask("b"), {
      wrapper: wrapperFor(client),
    });
    act(() => {
      result.current.mutate({ taskId: "c", column: "offen", toIndex: 0 });
    });
    await waitFor(() =>
      expect(reorderTask).toHaveBeenCalledWith({
        op: "reorder",
        taskId: "c",
        position: 512,
      })
    );
  });

  it("renumbers the whole column when the target gap is exhausted", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    // `a` and `b` are adjacent doubles: there is no representable midpoint
    // between them, so a single-row reorder cannot place `c` between them.
    const a = task("a", 1);
    const b = task("b", 1 + Number.EPSILON);
    client.setQueryData(TASK_KEYS.byBoard("b"), [a, b, task("c", 3072)]);
    vi.mocked(renormalizeColumnPositions).mockResolvedValue();
    const { result } = renderHook(() => useReorderTask("b"), {
      wrapper: wrapperFor(client),
    });
    // Drop `c` between `a` and `b`.
    act(() => {
      result.current.mutate({ taskId: "c", column: "offen", toIndex: 1 });
    });

    await waitFor(() =>
      expect(renormalizeColumnPositions).toHaveBeenCalledWith({
        op: "renormalizeColumn",
        boardId: "b",
        column: "offen",
        orderedIds: ["a", "c", "b"],
      })
    );
    // The single-row path must not be taken for an exhausted gap.
    expect(reorderTask).not.toHaveBeenCalled();
    // The optimistic cache already shows the final order, clean-spaced.
    const cached = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b")) ?? [];
    const order = [...cached]
      .sort((x, y) => x.position - y.position)
      .map((t) => t.id);
    expect(order).toEqual(["a", "c", "b"]);
    expect(cached.find((t) => t.id === "c")?.position).toBe(2048);
  });

  it("rolls the cache back when the reorder fails", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const initial = [task("a", 1024), task("b", 2048), task("c", 3072)];
    client.setQueryData(TASK_KEYS.byBoard("b"), initial);
    vi.mocked(reorderTask).mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useReorderTask("b"), {
      wrapper: wrapperFor(client),
    });
    act(() => {
      result.current.mutate({ taskId: "c", column: "offen", toIndex: 0 });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const cached = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b"));
    expect(cached?.find((t) => t.id === "c")?.position).toBe(3072);
  });
});
