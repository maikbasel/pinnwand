import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setTaskAssignees, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import type { SetAssigneesMutation } from "../mutation-defaults";
import type { Task } from "../types";

export type SetAssigneesVars = { taskId: string; userIds: string[] };
type SetAssigneesContext = { previous: Task[] | undefined };

/**
 * Optimistic set-assignees for the task detail sheet. Writes the full desired
 * assignee id set (the api diffs it into inserts/deletes), patches the cached
 * task instantly so the card avatars update without a round trip, rolls back on
 * error (global toast surfaces it), then reconciles on settle. The
 * `["tasks", ...]` write is self-contained, so it replays offline via the
 * resumable defaults in `mutation-defaults.ts`.
 */
export function useSetAssignees(boardId: string) {
  const queryClient = useQueryClient();
  const queryKey = TASK_KEYS.byBoard(boardId);

  const mutation = useMutation<
    void,
    Error,
    SetAssigneesMutation,
    SetAssigneesContext
  >({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "setTaskAssignees", scope: { board: boardId } },
    mutationFn: (vars) =>
      setTaskAssignees({ taskId: vars.taskId, userIds: vars.userIds }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Task[]>(queryKey);
      queryClient.setQueryData<Task[]>(queryKey, (current) =>
        (current ?? []).map((task) =>
          task.id === vars.taskId
            ? { ...task, assigneeIds: vars.userIds }
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

  const mutate = (vars: SetAssigneesVars): void => {
    mutation.mutate({ op: "setAssignees", ...vars });
  };

  return {
    mutate,
    isPending: mutation.isPending,
    isError: mutation.isError,
  };
}
