import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TASK_KEYS, TASK_MUTATION_KEYS, updateTask } from "../api/tasks";
import type { TaskPriorityId } from "../columns";
import type { UpdateTaskMutation } from "../mutation-defaults";
import type { Task } from "../types";

export type UpdateTaskVars = {
  taskId: string;
  title: string;
  description: string;
  priority: TaskPriorityId;
  dueDate: string | null;
};

type UpdateTaskContext = { previous: Task[] | undefined };

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
      updateTask({
        taskId: vars.taskId,
        title: vars.title,
        description: vars.description,
        priority: vars.priority,
        dueDate: vars.dueDate,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Task[]>(queryKey);
      queryClient.setQueryData<Task[]>(queryKey, (current) =>
        (current ?? []).map((task) =>
          task.id === vars.taskId
            ? {
                ...task,
                title: vars.title,
                description: vars.description,
                priority: vars.priority,
                dueDate: vars.dueDate,
              }
            : task
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

  const mutateAsync = (vars: UpdateTaskVars): Promise<Task> =>
    mutation.mutateAsync({ op: "update", ...vars });

  return {
    mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
  };
}
