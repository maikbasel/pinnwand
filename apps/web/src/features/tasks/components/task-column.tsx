import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { TaskColumnId } from "@pinnwand/contracts";
import { Plus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { ADD_TASK_LABEL } from "../lib/copy";
import type { Task } from "../types";
import { SortableTaskCard } from "./sortable-task-card";
import { TaskComposer } from "./task-composer";

export function TaskColumn({
  boardId,
  columnId,
  label,
  tasks,
  isComposing,
  onOpen,
  onAdd,
  onCloseAdd,
}: {
  boardId: string;
  columnId: TaskColumnId;
  label: string;
  tasks: Task[];
  isComposing: boolean;
  onOpen: (task: Task) => void;
  onAdd: (columnId: TaskColumnId) => void;
  onCloseAdd: () => void;
}) {
  // The whole card list is the column's drop zone so a card can be dropped into
  // an empty column too (cross-column move is Task 9).
  const { setNodeRef } = useDroppable({
    id: `column:${columnId}`,
    data: { column: columnId },
  });
  return (
    <section
      aria-label={label}
      // max-h-full (not h-full) keeps the column sized to its content and
      // top-aligned on the canvas (Trello-style); it only grows to the
      // viewport when it has enough cards to need internal scroll.
      className="flex max-h-full min-h-0 w-[70vw] shrink-0 snap-start flex-col rounded-xl bg-muted/40 md:w-auto"
    >
      <header className="flex shrink-0 items-center px-3 pt-3 pb-2">
        <h2 className="font-semibold text-sm">
          {label}{" "}
          <span className="text-muted-foreground">({tasks.length})</span>
        </h2>
      </header>
      <div
        className="scrollbar-none flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-y-contain px-3 pb-3"
        ref={setNodeRef}
      >
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} onOpen={onOpen} task={task} />
          ))}
        </SortableContext>
        {/* Inline add affordance: opens the in-column composer for this column.
            Replaces the separate empty-board CTA — an empty column shows only
            this row, a filled one shows it after the last card. While the
            composer is open it takes the row's place. */}
        {isComposing ? (
          <TaskComposer
            boardId={boardId}
            column={columnId}
            onClose={onCloseAdd}
          />
        ) : (
          <Button
            aria-label={`${ADD_TASK_LABEL}: ${label}`}
            className="w-full justify-start gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onAdd(columnId)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Plus className="size-4" />
            {ADD_TASK_LABEL}
          </Button>
        )}
      </div>
    </section>
  );
}
