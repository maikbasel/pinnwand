import type { TaskColumnId, TaskPriorityId } from "@pinnwand/contracts";
import type { QueryClient } from "@tanstack/react-query";
import {
  createTask,
  deleteTask,
  moveTask,
  renormalizeColumnPositions,
  reorderTask,
  setTaskAssignees,
  TASK_MUTATION_KEYS,
  updateTask,
} from "./api/tasks";
import type { Task } from "./types";

// A task write, tagged by op and carrying every value its api call needs. The
// fields are fully resolved (positions are numbers, not "bottom of column")
// because a write paused offline replays from these serialized variables alone,
// with no cache to read a neighbour's position from. `runResumableTaskMutation`
// dispatches on `op`; each hook builds the matching member before calling
// `mutate`, so the live path and the replay path run identical variables.
export type CreateTaskMutation = {
  op: "create";
  boardId: string;
  column: TaskColumnId;
  title: string;
  description: string;
  priority: TaskPriorityId;
  dueDate: string | null;
  position: number;
};

export type UpdateTaskMutation = {
  op: "update";
  taskId: string;
  // Omitted when the caller does not own the title (see UpdateTaskInput).
  title?: string;
  description: string;
  priority: TaskPriorityId;
  dueDate: string | null;
};

export type MoveTaskMutation = {
  op: "move";
  taskId: string;
  column: TaskColumnId;
  position: number;
};

export type ReorderTaskMutation = {
  op: "reorder";
  taskId: string;
  position: number;
};

// The fallback for an exhausted fractional-index gap: the full desired order of
// a column's task ids, renumbered server-side to clean 1024-spacing in one
// write. Self-contained (board, column, ids) so it replays offline like the rest.
export type RenormalizeColumnMutation = {
  op: "renormalizeColumn";
  boardId: string;
  column: TaskColumnId;
  orderedIds: string[];
};

export type DeleteTaskMutation = { op: "delete"; taskId: string };

export type SetAssigneesMutation = {
  op: "setAssignees";
  taskId: string;
  userIds: string[];
};

export type ResumableTaskMutation =
  | CreateTaskMutation
  | UpdateTaskMutation
  | MoveTaskMutation
  | ReorderTaskMutation
  | RenormalizeColumnMutation
  | DeleteTaskMutation
  | SetAssigneesMutation;

// The api functions zod-parse their input and drop the extra `op` discriminator.
export async function runResumableTaskMutation(
  vars: ResumableTaskMutation
): Promise<Task | undefined> {
  switch (vars.op) {
    case "create":
      return createTask(vars);
    case "update":
      return updateTask(vars);
    case "move":
      return moveTask(vars);
    case "reorder":
      return reorderTask(vars);
    case "renormalizeColumn":
      await renormalizeColumnPositions(vars);
      return;
    case "delete":
      await deleteTask(vars);
      return;
    case "setAssignees":
      await setTaskAssignees(vars);
      return;
    default: {
      const unreachable: never = vars;
      throw new Error(
        `Unknown resumable task mutation: ${JSON.stringify(unreachable)}`
      );
    }
  }
}

/**
 * Registers the resumable mutationFn for every task write under the generic
 * `["tasks", "mutate"]` prefix. A mutation paused in a prior offline session
 * rehydrates with only its serialized variables — no React hook survives the
 * restart to supply a mutationFn — so this default runs it on replay. Call once
 * from `main.tsx` before the persister resumes paused mutations.
 */
export function registerTaskMutationDefaults(queryClient: QueryClient): void {
  queryClient.setMutationDefaults<
    Task | undefined,
    Error,
    ResumableTaskMutation
  >(TASK_MUTATION_KEYS.root, {
    mutationFn: (variables) => runResumableTaskMutation(variables),
  });
}
