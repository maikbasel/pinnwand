import {
  type MutateOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { deleteTask, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import type { DeleteTaskMutation } from "../mutation-defaults";
import type { Task } from "../types";

export type DeleteTaskVars = { taskId: string };
type DeleteTaskContext = { previous: Task[] | undefined };

/**
 * Optimistic task delete for the deferred-delete flow. Removes the task from the
 * cached board list instantly so the card disappears the moment the undo window
 * opens, rolls back on error (global toast surfaces it), then reconciles on
 * settle. The `["tasks", ...]` write is self-contained, so it replays offline
 * via the resumable defaults in `mutation-defaults.ts`.
 */
export function useDeleteTask(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  const mutation = useMutation<
    void,
    Error,
    DeleteTaskMutation,
    DeleteTaskContext
  >({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "deleteTask", scope: { board: boardId } },
    mutationFn: (vars) => deleteTask({ taskId: vars.taskId }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (cur) =>
        (cur ?? []).filter((t) => t.id !== vars.taskId)
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const mutate = (
    vars: DeleteTaskVars,
    options?: MutateOptions<void, Error, DeleteTaskMutation, DeleteTaskContext>
  ): void => {
    mutation.mutate({ op: "delete", taskId: vars.taskId }, options);
  };

  return {
    mutate,
    isPending: mutation.isPending,
    isError: mutation.isError,
  };
}
