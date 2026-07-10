import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_MUTATION_KEYS } from "./api/tasks";

vi.mock("./api/tasks", async () => {
  const actual =
    await vi.importActual<typeof import("./api/tasks")>("./api/tasks");
  return {
    ...actual,
    createTask: vi.fn(),
    updateTask: vi.fn(),
    moveTask: vi.fn(),
    reorderTask: vi.fn(),
    deleteTask: vi.fn(),
    setTaskAssignees: vi.fn(),
  };
});

import {
  createTask,
  deleteTask,
  moveTask,
  reorderTask,
  setTaskAssignees,
  updateTask,
} from "./api/tasks";
import {
  registerTaskMutationDefaults,
  runResumableTaskMutation,
} from "./mutation-defaults";

afterEach(() => vi.clearAllMocks());

describe("registerTaskMutationDefaults", () => {
  it("resolves a mutationFn for a board-scoped mutation key via prefix match", () => {
    const client = new QueryClient();
    registerTaskMutationDefaults(client);
    const defaults = client.getMutationDefaults(
      TASK_MUTATION_KEYS.forBoard("board-1")
    );
    expect(typeof defaults.mutationFn).toBe("function");
  });
});

describe("runResumableTaskMutation", () => {
  it("dispatches each op to its api function", async () => {
    await runResumableTaskMutation({
      op: "create",
      boardId: "b",
      column: "offen",
      title: "t",
      description: "",
      priority: "mittel",
      dueDate: null,
      position: 1024,
    });
    await runResumableTaskMutation({
      op: "update",
      taskId: "t",
      title: "t2",
      description: "d",
      priority: "hoch",
      dueDate: null,
    });
    await runResumableTaskMutation({
      op: "move",
      taskId: "t",
      column: "erledigt",
      position: 2048,
    });
    await runResumableTaskMutation({
      op: "reorder",
      taskId: "t",
      position: 512,
    });
    await runResumableTaskMutation({ op: "delete", taskId: "t" });
    await runResumableTaskMutation({
      op: "setAssignees",
      taskId: "t",
      userIds: ["u1"],
    });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ position: 1024, column: "offen" })
    );
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t", title: "t2" })
    );
    expect(moveTask).toHaveBeenCalledWith(
      expect.objectContaining({ column: "erledigt", position: 2048 })
    );
    expect(reorderTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t", position: 512 })
    );
    expect(deleteTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t" })
    );
    expect(setTaskAssignees).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t", userIds: ["u1"] })
    );
  });
});
