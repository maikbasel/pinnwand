import type { TaskColumnId } from "@pinnwand/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { moveTask, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import { bottomPosition } from "../lib/position";
import type { MoveTaskMutation } from "../mutation-defaults";
import type { Task } from "../types";

export type MoveTaskVars = { taskId: string; toColumn: TaskColumnId };
type Ctx = { previous: Task[] | undefined };

function targetPosition(
  tasks: Task[],
  toColumn: TaskColumnId,
  taskId: string
): number {
  const inColumn = tasks.filter(
    (t) => t.column === toColumn && t.id !== taskId
  );
  return bottomPosition(inColumn);
}

/**
 * Optimistic cross-column move to the bottom of the target column. The target
 * position is resolved into the mutation variables before dispatch, so the
 * `["tasks", ...]` write replays offline from its variables alone (resumable
 * defaults in `mutation-defaults.ts`) with no cache read.
 */
export function useMoveTask(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  const mutation = useMutation<Task, Error, MoveTaskMutation, Ctx>({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "moveTask", scope: { board: boardId } },
    mutationFn: (vars) =>
      moveTask({
        taskId: vars.taskId,
        column: vars.column,
        position: vars.position,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (cur) =>
        (cur ?? []).map((t) =>
          t.id === vars.taskId
            ? { ...t, column: vars.column, position: vars.position }
            : t
        )
      );
      return { previous };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(key, ctx.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const toResumable = (vars: MoveTaskVars): MoveTaskMutation => {
    const tasks = queryClient.getQueryData<Task[]>(key) ?? [];
    return {
      op: "move",
      taskId: vars.taskId,
      column: vars.toColumn,
      position: targetPosition(tasks, vars.toColumn, vars.taskId),
    };
  };

  const mutate = (vars: MoveTaskVars): void => {
    mutation.mutate(toResumable(vars));
  };

  const mutateAsync = (vars: MoveTaskVars): Promise<Task> =>
    mutation.mutateAsync(toResumable(vars));

  return {
    mutate,
    mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
  };
}
