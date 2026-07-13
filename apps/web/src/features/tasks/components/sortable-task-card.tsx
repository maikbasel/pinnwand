import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "../types";
import { TaskCard } from "./task-card";

// Whole-card drag: the split sensors (mouse distance, touch delay) in
// board-surface keep a tap from starting a drag, so tap-to-open still works.
export function SortableTaskCard({
  task,
  onOpen,
}: {
  task: Task;
  onOpen: (task: Task) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { column: task.column } });
  return (
    <div
      className={isDragging ? "opacity-50" : undefined}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <TaskCard onOpen={onOpen} task={task} />
    </div>
  );
}
