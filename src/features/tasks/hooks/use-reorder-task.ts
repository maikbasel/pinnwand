import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reorderTask, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import type { TaskColumnId } from "../columns";
import {
  hasRepresentableGap,
  positionForMove,
  renormalize,
} from "../lib/position";
import type { ReorderTaskMutation } from "../mutation-defaults";
import type { Task } from "../types";

export type ReorderTaskVars = {
  taskId: string;
  column: TaskColumnId;
  toIndex: number;
};
type Ctx = { previous: Task[] | undefined };

function orderedColumn(
  tasks: Task[],
  column: TaskColumnId,
  exceptId: string
): Task[] {
  return tasks
    .filter((t) => t.column === column && t.id !== exceptId)
    .sort((a, b) => a.position - b.position);
}

/**
 * Optimistic within-column reorder. The target fractional-index position is
 * resolved into the mutation variables before dispatch (renormalizing the
 * column when the gap between neighbours is exhausted), so the `["tasks", ...]`
 * write replays offline from its variables alone (resumable defaults in
 * `mutation-defaults.ts`) with no cache read.
 */
export function useReorderTask(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  const mutation = useMutation<Task, Error, ReorderTaskMutation, Ctx>({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "reorderTask", scope: { board: boardId } },
    mutationFn: (vars) =>
      reorderTask({ taskId: vars.taskId, position: vars.position }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (cur) =>
        (cur ?? []).map((t) =>
          t.id === vars.taskId ? { ...t, position: vars.position } : t
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

  const toResumable = (vars: ReorderTaskVars): ReorderTaskMutation => {
    const tasks = queryClient.getQueryData<Task[]>(key) ?? [];
    const siblings = orderedColumn(tasks, vars.column, vars.taskId);
    const prev = vars.toIndex > 0 ? (siblings[vars.toIndex - 1] ?? null) : null;
    const next =
      vars.toIndex < siblings.length ? (siblings[vars.toIndex] ?? null) : null;
    // Precision exhausted between these neighbours: renormalize the column,
    // then place the moved task at its target index in one write.
    const base = hasRepresentableGap(
      prev?.position ?? null,
      next?.position ?? null
    )
      ? siblings
      : renormalize(siblings);
    return {
      op: "reorder",
      taskId: vars.taskId,
      position: positionForMove(base, vars.toIndex),
    };
  };

  const mutate = (vars: ReorderTaskVars): void => {
    mutation.mutate(toResumable(vars));
  };

  return {
    mutate,
    isPending: mutation.isPending,
    isError: mutation.isError,
  };
}
