import { Card } from "@/shared/components/ui/card";
import type { Task } from "../types";
import { AssigneeAvatars } from "./assignee-avatars";
import { PriorityDot } from "./priority-badge";

// Compact Trello-style card: a single row of priority dot + title, with
// assignee avatars appended only when the task has any. A card with no
// assignees is one title line tall, which keeps the mobile column short and
// makes drag-to-reorder easier.
export function TaskCard({
  task,
  onOpen,
}: {
  task: Task;
  onOpen: (task: Task) => void;
}) {
  return (
    <Card
      className="flex cursor-pointer flex-row items-start gap-2 px-2.5 py-2 text-left"
      data-testid="task-card"
      onClick={() => onOpen(task)}
    >
      <PriorityDot priority={task.priority} />
      <p className="line-clamp-2 min-w-0 flex-1 font-medium text-sm leading-snug">
        {task.title}
      </p>
      <AssigneeAvatars assigneeIds={task.assigneeIds} boardId={task.boardId} />
    </Card>
  );
}
