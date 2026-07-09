import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listBoardTasks, TASK_KEYS } from "../api/tasks";
import { groupByColumn, type TasksByColumn } from "../lib/group";
import type { Task } from "../types";

export function useBoardTasks(boardId: string): {
  tasks: Task[];
  tasksByColumn: TasksByColumn;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
} {
  const { data, isPending, isError, error } = useQuery({
    queryKey: TASK_KEYS.byBoard(boardId),
    queryFn: () => listBoardTasks(boardId),
    enabled: !!boardId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    meta: { op: "listBoardTasks", scope: { board: boardId } },
  });
  const tasks = data ?? [];
  return {
    tasks,
    tasksByColumn: groupByColumn(tasks),
    isPending,
    isError,
    error,
  };
}
