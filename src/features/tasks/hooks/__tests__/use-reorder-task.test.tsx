import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_KEYS } from "../../api/tasks";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, reorderTask: vi.fn() };
});

import { reorderTask } from "../../api/tasks";
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
      expect(reorderTask).toHaveBeenCalledWith({ taskId: "c", position: 512 })
    );
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
