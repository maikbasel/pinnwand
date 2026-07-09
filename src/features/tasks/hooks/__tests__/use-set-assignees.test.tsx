import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_KEYS } from "../../api/tasks";
import type { Task } from "../../types";

vi.mock("../../api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/tasks")>("../../api/tasks");
  return { ...actual, setTaskAssignees: vi.fn().mockResolvedValue(undefined) };
});

import { setTaskAssignees } from "../../api/tasks";
import { useSetAssignees } from "../use-set-assignees";

function task(id: string, assigneeIds: string[]): Task {
  return {
    id,
    boardId: "b",
    column: "offen",
    title: id,
    description: "",
    priority: "mittel",
    dueDate: null,
    position: 1024,
    assigneeIds,
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

describe("useSetAssignees", () => {
  it("optimistically sets the assignee ids on the task", async () => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    client.setQueryData(TASK_KEYS.byBoard("b"), [task("t", [])]);
    const { result } = renderHook(() => useSetAssignees("b"), {
      wrapper: wrapperFor(client),
    });

    act(() => {
      result.current.mutate({ taskId: "t", userIds: ["u1", "u2"] });
    });

    await waitFor(() => {
      const cache = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b"));
      expect(cache?.find((t) => t.id === "t")?.assigneeIds).toEqual([
        "u1",
        "u2",
      ]);
    });
    expect(setTaskAssignees).toHaveBeenCalledWith({
      taskId: "t",
      userIds: ["u1", "u2"],
    });
  });

  it("rolls back the optimistic assignees when the write fails", async () => {
    vi.mocked(setTaskAssignees).mockRejectedValueOnce(new Error("nope"));
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    client.setQueryData(TASK_KEYS.byBoard("b"), [task("t", ["u1"])]);
    const { result } = renderHook(() => useSetAssignees("b"), {
      wrapper: wrapperFor(client),
    });

    act(() => {
      result.current.mutate({ taskId: "t", userIds: ["u2"] });
    });

    await waitFor(() => {
      const cache = client.getQueryData<Task[]>(TASK_KEYS.byBoard("b"));
      expect(cache?.find((t) => t.id === "t")?.assigneeIds).toEqual(["u1"]);
    });
  });
});
