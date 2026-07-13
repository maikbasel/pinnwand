import { TASK_COLUMNS, type TaskColumnId } from "@pinnwand/contracts";
import type { Task } from "../types";

export type TasksByColumn = Record<TaskColumnId, Task[]>;

export function groupByColumn(tasks: readonly Task[]): TasksByColumn {
  const grouped = Object.fromEntries(
    TASK_COLUMNS.map((column) => [column.id, [] as Task[]])
  ) as TasksByColumn;
  for (const task of tasks) {
    grouped[task.column].push(task);
  }
  for (const column of TASK_COLUMNS) {
    grouped[column.id].sort((a, b) => a.position - b.position);
  }
  return grouped;
}
