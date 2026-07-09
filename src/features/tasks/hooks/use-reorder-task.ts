import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import type { TaskColumnId } from "../columns";
import { hasRepresentableGap, midpoint, renormalize } from "../lib/position";
import {
  type RenormalizeColumnMutation,
  type ReorderTaskMutation,
  runResumableTaskMutation,
} from "../mutation-defaults";
import type { Task } from "../types";

export type ReorderTaskVars = {
  taskId: string;
  column: TaskColumnId;
  toIndex: number;
};
type ReorderMutation = ReorderTaskMutation | RenormalizeColumnMutation;
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

// The optimistic cache patch mirrors what the server will do, per op: a plain
// reorder moves one card; a renormalize rewrites every id in the column to its
// clean 1024-spaced position (the same formula the RPC applies), so the board
// shows the final order immediately.
function applyOptimistic(tasks: Task[], vars: ReorderMutation): Task[] {
  if (vars.op === "reorder") {
    return tasks.map((t) =>
      t.id === vars.taskId ? { ...t, position: vars.position } : t
    );
  }
  const positionById = new Map(
    renormalize(vars.orderedIds.map((id) => ({ id }))).map((r) => [
      r.id,
      r.position,
    ])
  );
  return tasks.map((t) => {
    const next = positionById.get(t.id);
    return next === undefined ? t : { ...t, position: next };
  });
}

/**
 * Optimistic within-column reorder. A normal drop writes the midpoint between
 * the two neighbours (one row). When that gap is exhausted — the neighbours are
 * adjacent doubles with no representable midpoint — no single-row write can
 * place the card, so it falls back to `renormalizeColumn`: the full desired
 * order is renumbered to clean 1024-spacing in one atomic RPC. Both ops are
 * resolved into serialized variables before dispatch, so a write paused offline
 * replays from its variables alone (resumable defaults in `mutation-defaults.ts`)
 * with no cache read.
 */
export function useReorderTask(boardId: string) {
  const queryClient = useQueryClient();
  const key = TASK_KEYS.byBoard(boardId);

  const mutation = useMutation<Task | undefined, Error, ReorderMutation, Ctx>({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "reorderTask", scope: { board: boardId } },
    mutationFn: (vars) => runResumableTaskMutation(vars),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Task[]>(key);
      queryClient.setQueryData<Task[]>(key, (cur) =>
        applyOptimistic(cur ?? [], vars)
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

  const toResumable = (vars: ReorderTaskVars): ReorderMutation => {
    const tasks = queryClient.getQueryData<Task[]>(key) ?? [];
    const siblings = orderedColumn(tasks, vars.column, vars.taskId);
    const prev = vars.toIndex > 0 ? (siblings[vars.toIndex - 1] ?? null) : null;
    const next =
      vars.toIndex < siblings.length ? (siblings[vars.toIndex] ?? null) : null;
    const prevPos = prev?.position ?? null;
    const nextPos = next?.position ?? null;
    if (hasRepresentableGap(prevPos, nextPos)) {
      return {
        op: "reorder",
        taskId: vars.taskId,
        position: midpoint(prevPos, nextPos),
      };
    }
    // Precision exhausted between these neighbours: renumber the whole column,
    // placing the moved task at its target index, in one atomic write.
    const moved = tasks.find((t) => t.id === vars.taskId);
    const finalOrder = [...siblings];
    if (moved) {
      finalOrder.splice(vars.toIndex, 0, moved);
    }
    return {
      op: "renormalizeColumn",
      boardId,
      column: vars.column,
      orderedIds: finalOrder.map((t) => t.id),
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
