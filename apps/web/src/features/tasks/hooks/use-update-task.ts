import type { TaskPriorityId } from "@pinnwand/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TASK_KEYS, TASK_MUTATION_KEYS, updateTask } from "../api/tasks";
import type { UpdateTaskMutation } from "../mutation-defaults";
import type { Task } from "../types";

// Every field but taskId is optional: the detail sheet auto-saves one field at
// a time, so a call carries only what changed. Omit a field to leave it
// untouched; pass `dueDate: null` to clear the date.
export type UpdateTaskVars = {
  taskId: string;
  title?: string;
  description?: string;
  priority?: TaskPriorityId;
  dueDate?: string | null;
};

type UpdateTaskContext = { previous: Task[] | undefined };

// Only the fields the caller actually set. Omitted fields (undefined) are left
// out so a per-field write never overwrites its neighbours; `dueDate: null` is
// kept, since null clears the date. Shared by the server write and the
// optimistic cache patch so both apply exactly the same delta.
function updatePatch(
  vars: UpdateTaskMutation
): Partial<Pick<Task, "title" | "description" | "priority" | "dueDate">> {
  return {
    ...(vars.title === undefined ? {} : { title: vars.title }),
    ...(vars.description === undefined
      ? {}
      : { description: vars.description }),
    ...(vars.priority === undefined ? {} : { priority: vars.priority }),
    ...(vars.dueDate === undefined ? {} : { dueDate: vars.dueDate }),
  };
}

/**
 * Optimistic edit of a task's title, description, priority and due date. Patches
 * the cached row instantly, rolls back on error (global toast surfaces it), and
 * reconciles on settle. Column moves go through `useMoveTask`, not here. The
 * `["tasks", ...]` write is self-contained, so it replays offline via the
 * resumable defaults in `mutation-defaults.ts`.
 */
export function useUpdateTask(boardId: string) {
  const queryClient = useQueryClient();
  const queryKey = TASK_KEYS.byBoard(boardId);

  const mutation = useMutation<
    Task,
    Error,
    UpdateTaskMutation,
    UpdateTaskContext
  >({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "updateTask", scope: { board: boardId } },
    mutationFn: (vars) =>
      updateTask({ taskId: vars.taskId, ...updatePatch(vars) }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Task[]>(queryKey);
      const patch = updatePatch(vars);
      queryClient.setQueryData<Task[]>(queryKey, (current) =>
        (current ?? []).map((task) =>
          task.id === vars.taskId ? { ...task, ...patch } : task
        )
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const mutate = (vars: UpdateTaskVars): void => {
    mutation.mutate({ op: "update", ...vars });
  };

  const mutateAsync = (vars: UpdateTaskVars): Promise<Task> =>
    mutation.mutateAsync({ op: "update", ...vars });

  return {
    mutate,
    mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
  };
}
