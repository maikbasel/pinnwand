import type { TaskColumnId, TaskPriorityId } from "./columns";

export type Task = {
  id: string;
  boardId: string;
  column: TaskColumnId;
  title: string;
  description: string;
  priority: TaskPriorityId;
  dueDate: string | null;
  position: number;
  assigneeIds: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};
