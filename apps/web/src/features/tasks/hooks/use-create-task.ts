import {
  DEFAULT_TASK_PRIORITY,
  type TaskColumnId,
  type TaskPriorityId,
} from "@pinnwand/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTask, TASK_KEYS, TASK_MUTATION_KEYS } from "../api/tasks";
import { bottomPosition } from "../lib/position";
import type { CreateTaskMutation } from "../mutation-defaults";
import type { Task } from "../types";

export type CreateTaskVars = {
  column: TaskColumnId;
  title: string;
  description: string;
  priority: TaskPriorityId;
  dueDate: string | null;
};

const TEMP_ID_PREFIX = "temp-";

type CreateTaskContext = { previous: Task[] | undefined; tempId: string };

/**
 * Optimistic create for both the inline quick-add composer and the full task
 * detail sheet. The mutation takes the full task shape (title, description,
 * priority, due date); `create(column, title)` is a title-only convenience for
 * the composer that fills the remaining fields with sensible defaults. Reads the
 * board's cached tasks to resolve the new card's bottom position, inserts an
 * optimistic row instantly, swaps in the server row on success, then reconciles
 * on settle. Rolls back and surfaces the error (global toast) on failure.
 *
 * The bottom position is resolved into the mutation variables before dispatch,
 * so the durable `["tasks", ...]` write replays offline from its variables alone
 * (defaults registered in `mutation-defaults.ts`) with no cache read.
 */
export function useCreateTask(boardId: string) {
  const queryClient = useQueryClient();
  const queryKey = TASK_KEYS.byBoard(boardId);

  const mutation = useMutation<
    Task,
    Error,
    CreateTaskMutation,
    CreateTaskContext
  >({
    mutationKey: TASK_MUTATION_KEYS.forBoard(boardId),
    meta: { op: "createTask", scope: { board: boardId } },
    mutationFn: (vars) =>
      createTask({
        boardId: vars.boardId,
        column: vars.column,
        title: vars.title,
        description: vars.description,
        priority: vars.priority,
        dueDate: vars.dueDate,
        position: vars.position,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Task[]>(queryKey);
      const tempId = `${TEMP_ID_PREFIX}${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const optimistic: Task = {
        id: tempId,
        boardId,
        column: vars.column,
        title: vars.title,
        description: vars.description,
        priority: vars.priority,
        dueDate: vars.dueDate,
        position: vars.position,
        assigneeIds: [],
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      };
      queryClient.setQueryData<Task[]>(queryKey, (current) => [
        ...(current ?? []),
        optimistic,
      ]);
      return { previous, tempId };
    },
    onSuccess: (created, _vars, context) => {
      queryClient.setQueryData<Task[]>(queryKey, (current) =>
        (current ?? []).map((task) =>
          task.id === context.tempId ? created : task
        )
      );
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

  // Resolve the bottom position from the persisted (non-temp) siblings so the
  // variables are self-contained for offline replay. Optimistic temp cards are
  // excluded so a rapid second add is not placed past an unsaved sibling.
  const toResumable = (vars: CreateTaskVars): CreateTaskMutation => {
    const inColumn = (queryClient.getQueryData<Task[]>(queryKey) ?? []).filter(
      (task) =>
        task.column === vars.column && !task.id.startsWith(TEMP_ID_PREFIX)
    );
    return {
      op: "create",
      boardId,
      column: vars.column,
      title: vars.title,
      description: vars.description,
      priority: vars.priority,
      dueDate: vars.dueDate,
      position: bottomPosition(inColumn),
    };
  };

  // Title-only quick-add for the inline column composer; the sheet calls
  // `mutateAsync` directly with the full form.
  const create = (column: TaskColumnId, title: string): void => {
    mutation.mutate(
      toResumable({
        column,
        title,
        description: "",
        priority: DEFAULT_TASK_PRIORITY,
        dueDate: null,
      })
    );
  };

  const mutateAsync = (vars: CreateTaskVars): Promise<Task> =>
    mutation.mutateAsync(toResumable(vars));

  return {
    create,
    mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
  };
}
