import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { TASK_COLUMNS, type TaskColumnId } from "@pinnwand/contracts";
import { useIsRestoring } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { useBoardRealtime } from "../hooks/use-board-realtime";
import { useBoardTasks } from "../hooks/use-board-tasks";
import { useEdgeAutoScroll } from "../hooks/use-edge-auto-scroll";
import { useMoveTask } from "../hooks/use-move-task";
import { useReorderTask } from "../hooks/use-reorder-task";
import { TASKS_LOAD_ERROR } from "../lib/copy";
import { groupByColumn } from "../lib/group";
import type { Task } from "../types";
import { DeferredDeleteProvider, useDeferredDelete } from "./deferred-delete";
import { DELETE_ZONE_ID, DeleteDropZone } from "./delete-drop-zone";
import { TaskCard } from "./task-card";
import { TaskColumn } from "./task-column";
import { TaskDetailSheet } from "./task-detail-sheet";

// The dragged card renders in a portaled DragOverlay (below), so its onOpen
// never fires — a card only opens on a real tap, which the split sensors keep
// distinct from a drag.
const noopOpen = (): void => undefined;

// The horizontal column strip fills the board canvas. On mobile it scroll-snaps
// between columns; on desktop the four sit side by side. `items-start` keeps the
// columns sized to their content and top-aligned (Trello-style) rather than
// stretched to full height. `scrollbar-none` hides the scrollbar.
const COLUMN_STRIP =
  "flex min-h-0 flex-1 items-start gap-3 overflow-x-auto overscroll-x-contain scrollbar-none px-4 py-4 md:grid md:grid-cols-4 md:items-start md:overflow-x-visible";

// Scroll-snap for manual browsing. Removed while a drag is active: mandatory
// snap fights the custom edge auto-scroll (the snap engine yanks scrollLeft back
// to a column boundary each frame).
const SNAP_COLUMNS = "snap-x snap-mandatory";

// The provider owns the deferred-delete state (pending ids + undo timers), so
// it must wrap the board that reads `useDeferredDelete()`. The inner BoardBoard
// holds all the drag/render logic; this thin shell only supplies the context.
export function BoardSurface({ boardId }: { boardId: string }) {
  return (
    <DeferredDeleteProvider boardId={boardId}>
      <BoardBoard boardId={boardId} />
    </DeferredDeleteProvider>
  );
}

function BoardBoard({ boardId }: { boardId: string }) {
  const isRestoring = useIsRestoring();
  const { subscribed } = useBoardRealtime(boardId);
  const { tasks, isPending, isError } = useBoardTasks(boardId);
  const { requestDelete, pendingDeleteIds } = useDeferredDelete();
  // Hold the open card by id and resolve it from the live cache, so a realtime
  // update flows through and a remote delete closes the sheet instead of
  // leaving an edit surface over a task that no longer exists.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = openTaskId
    ? (tasks.find((t) => t.id === openTaskId) ?? null)
    : null;
  const [createColumn, setCreateColumn] = useState<TaskColumnId | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  // A card in its undo window is hidden immediately: filter the pending ids out
  // of every column, and drive both the render and the reorder index off this
  // visible grouping so an in-flight delete never shifts a neighbour's slot.
  const visibleByColumn = useMemo(
    () => groupByColumn(tasks.filter((t) => !pendingDeleteIds.has(t.id))),
    [tasks, pendingDeleteIds]
  );
  // dnd-kit's built-in auto-scroll cannot drive this horizontal strip because
  // its columns are vertically scrollable (clauderic/dnd-kit#1108): it flings to
  // the end and ignores acceleration. So the strip is excluded from dnd-kit
  // auto-scroll (canScroll below) and scrolled by our own edge auto-scroller
  // instead, at a controlled speed. Vertical auto-scroll on the card lists (not
  // the strip) stays with dnd-kit.
  const stripRef = useRef<HTMLDivElement>(null);
  useEdgeAutoScroll(stripRef, activeTask !== null);
  const reorderTask = useReorderTask(boardId, pendingDeleteIds);
  const moveTask = useMoveTask(boardId);
  const sensors = useSensors(
    // Mouse: a short drag distance so a click still opens the sheet.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Touch: a long-press delay so scrolling the column strip never drags.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function onDragStart(event: DragStartEvent): void {
    setActiveTask(tasks.find((t) => t.id === event.active.id) ?? null);
  }

  function onDragEnd(event: DragEndEvent): void {
    setActiveTask(null);
    const { active, over } = event;
    if (over?.id === DELETE_ZONE_ID) {
      const task = tasks.find((t) => t.id === active.id);
      if (task) {
        requestDelete(task);
      }
      return;
    }
    if (!over || active.id === over.id) {
      return;
    }
    const activeColumn = active.data.current?.column as
      | TaskColumnId
      | undefined;
    const overColumn = (over.data.current?.column ?? activeColumn) as
      | TaskColumnId
      | undefined;
    if (!(activeColumn && overColumn)) {
      return;
    }
    if (activeColumn !== overColumn) {
      // Desktop cross-column drop: append to the target column's bottom.
      // Mobile cross-column changes go through the detail sheet, not drag.
      moveTask.mutate({ taskId: String(active.id), toColumn: overColumn });
      return;
    }
    const columnTasks = visibleByColumn[activeColumn];
    const overIndex = columnTasks.findIndex((t) => t.id === over.id);
    // -1 means the drop landed on the column body, not a card (below the last
    // card, or an empty column): append to the bottom. `columnTasks` includes
    // the dragged card, so the bottom index among its siblings is length - 1.
    const toIndex = overIndex === -1 ? columnTasks.length - 1 : overIndex;
    reorderTask.mutate({
      taskId: String(active.id),
      column: activeColumn,
      toIndex,
    });
  }

  if ((isPending || isRestoring) && tasks.length === 0) {
    return (
      <div className={cn(COLUMN_STRIP, SNAP_COLUMNS)}>
        {TASK_COLUMNS.map((column) => (
          <Skeleton
            className="h-64 w-[70vw] shrink-0 rounded-xl md:w-auto"
            key={column.id}
          />
        ))}
      </div>
    );
  }

  if (isError && tasks.length === 0) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription>{TASKS_LOAD_ERROR}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <DndContext
      autoScroll={{ canScroll: (element) => element !== stripRef.current }}
      onDragCancel={() => setActiveTask(null)}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      sensors={sensors}
    >
      {/* Positioning context for the floating delete zone, which overlays the
          top of the board without pushing the columns down. `data-realtime-status`
          reflects the live channel handshake (a second client only observes
          writes once "subscribed"). */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        data-realtime-status={subscribed ? "subscribed" : "connecting"}
      >
        {/* Only visible while a card is being dragged; dropping onto it routes
            the card through the deferred-delete flow. */}
        <DeleteDropZone active={activeTask !== null} />
        <div
          className={cn(COLUMN_STRIP, activeTask ? undefined : SNAP_COLUMNS)}
          ref={stripRef}
        >
          {TASK_COLUMNS.map((column) => (
            <TaskColumn
              boardId={boardId}
              columnId={column.id}
              isComposing={createColumn === column.id}
              key={column.id}
              label={column.label}
              onAdd={setCreateColumn}
              onCloseAdd={() => setCreateColumn(null)}
              onOpen={(task) => setOpenTaskId(task.id)}
              tasks={visibleByColumn[column.id]}
            />
          ))}
        </div>
      </div>
      {/* Tap a card to edit it. Create-on-mobile is the inline column composer
          (TaskColumn), so the sheet is used in edit mode only here. It portals
          to the body, so its position in this tree does not matter. */}
      {openTask ? (
        <TaskDetailSheet
          boardId={boardId}
          key={openTask.id}
          mode={{ kind: "edit", task: openTask }}
          onOpenChange={(next) => {
            if (!next) {
              setOpenTaskId(null);
            }
          }}
          open
        />
      ) : null}
      {/* Portaled overlay: the dragged card floats above the column overflow so
          it stays visible once it leaves its column bounds. A slight lift
          (upward nudge + shadow + ring) is the "picked up" cue, Trello-style.
          dropAnimation is disabled: the optimistic reorder already places the
          card in its new slot, so the default animate-back-to-origin would show
          the card snapping to its old spot first. */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className="-translate-y-1 cursor-grabbing rounded-xl shadow-2xl ring-2 ring-primary">
            <TaskCard onOpen={noopOpen} task={activeTask} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
