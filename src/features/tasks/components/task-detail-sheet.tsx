import { AlignLeft, Columns3, Flag } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/components/ui/drawer";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/components/ui/toggle-group";
import { useMediaQuery } from "@/shared/hooks/use-media-query";
import {
  TASK_COLUMNS,
  TASK_PRIORITIES,
  type TaskColumnId,
  type TaskPriorityId,
} from "../columns";
import { useCreateTask } from "../hooks/use-create-task";
import { useMoveTask } from "../hooks/use-move-task";
import { useSetAssignees } from "../hooks/use-set-assignees";
import { useUpdateTask } from "../hooks/use-update-task";
import {
  CLOSE_LABEL,
  CREATE_TASK_TITLE,
  DELETE_TASK_LABEL,
  SAVE_TASK_LABEL,
  TASK_COLUMN_LABEL,
  TASK_DESCRIPTION_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_TITLE_LABEL,
  TASK_TITLE_PLACEHOLDER,
} from "../lib/copy";
import type { Task } from "../types";
import { AssigneePicker } from "./assignee-picker";
import { useDeferredDelete } from "./deferred-delete";
import { DueDateField } from "./due-date-field";
import { TaskTitleField } from "./task-title-field";

const DESKTOP_QUERY = "(min-width: 768px)";

// Every field label carries a leading icon; the icon is decorative (the label
// text is the accessible name), so it is aria-hidden.
const FIELD_ICON_CLASS = "size-4 text-muted-foreground";

export type TaskDetailMode =
  | { kind: "create"; column: TaskColumnId }
  | { kind: "edit"; task: Task };

type FormState = {
  title: string;
  description: string;
  column: TaskColumnId;
  priority: TaskPriorityId;
  dueDate: string;
};

function initialForm(mode: TaskDetailMode): FormState {
  if (mode.kind === "create") {
    return {
      title: "",
      description: "",
      column: mode.column,
      priority: "mittel",
      dueDate: "",
    };
  }
  const { task } = mode;
  return {
    title: task.title,
    description: task.description,
    column: task.column,
    priority: task.priority,
    dueDate: task.dueDate ?? "",
  };
}

export function TaskDetailSheet({
  boardId,
  mode,
  open,
  onOpenChange,
}: {
  boardId: string;
  mode: TaskDetailMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const createTask = useCreateTask(boardId);
  const updateTask = useUpdateTask(boardId);
  const moveTask = useMoveTask(boardId);
  const setAssignees = useSetAssignees(boardId);
  const deferredDelete = useDeferredDelete();
  const [form, setForm] = useState<FormState>(() => initialForm(mode));
  const [assigneeIds, setAssigneeIds] = useState<string[]>(() =>
    mode.kind === "edit" ? mode.task.assigneeIds : []
  );

  const busy =
    createTask.isPending || updateTask.isPending || moveTask.isPending;
  // Create needs a non-empty title before Save; in edit mode the title is
  // committed inline (immediately), so it is never part of this gate.
  const canSave = mode.kind === "create" ? form.title.trim() !== "" : true;

  // Inline title commit (edit mode): an immediate optimistic write, decoupled
  // from Save, mirroring how assignees write on their own. The other fields are
  // sent at their last-persisted values so an in-progress (unsaved) body edit is
  // never flushed early by a title change.
  async function commitTitle(nextTitle: string): Promise<void> {
    if (mode.kind !== "edit") {
      return;
    }
    try {
      await updateTask.mutateAsync({
        taskId: mode.task.id,
        title: nextTitle,
        description: mode.task.description,
        priority: mode.task.priority,
        dueDate: mode.task.dueDate,
      });
    } catch {
      // Optimistic update rolled back; the global toast surfaces the error.
    }
  }

  async function save(): Promise<void> {
    const title = mode.kind === "create" ? form.title.trim() : mode.task.title;
    if (busy || title === "") {
      return;
    }
    const dueDate = form.dueDate === "" ? null : form.dueDate;
    try {
      if (mode.kind === "create") {
        await createTask.mutateAsync({
          column: form.column,
          title,
          description: form.description,
          priority: form.priority,
          dueDate,
        });
      } else {
        await updateTask.mutateAsync({
          taskId: mode.task.id,
          title,
          description: form.description,
          priority: form.priority,
          dueDate,
        });
        // A column change in edit mode is a move (recomputes position in the
        // target column), so it goes through moveTask rather than updateTask.
        if (form.column !== mode.task.column) {
          await moveTask.mutateAsync({
            taskId: mode.task.id,
            toColumn: form.column,
          });
        }
      }
      onOpenChange(false);
    } catch {
      // Optimistic update rolled back; the global toast surfaces the error.
    }
  }

  const body = (
    <div className="flex flex-col gap-4 px-4 pb-4">
      <div className="flex flex-col gap-2">
        <Label className="flex items-center gap-2" htmlFor="task-desc">
          <AlignLeft aria-hidden="true" className={FIELD_ICON_CLASS} />
          {TASK_DESCRIPTION_LABEL}
        </Label>
        <Textarea
          id="task-desc"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              description: event.target.value,
            }))
          }
          value={form.description}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 font-medium text-sm">
          <Columns3 aria-hidden="true" className={FIELD_ICON_CLASS} />
          {TASK_COLUMN_LABEL}
        </span>
        <ToggleGroup
          className="flex-col md:flex-row"
          onValueChange={(value) => {
            const next = value[0];
            if (next) {
              setForm((current) => ({
                ...current,
                column: next as TaskColumnId,
              }));
            }
          }}
          value={[form.column]}
        >
          {TASK_COLUMNS.map((column) => (
            <ToggleGroupItem key={column.id} value={column.id}>
              {column.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 font-medium text-sm">
          <Flag aria-hidden="true" className={FIELD_ICON_CLASS} />
          {TASK_PRIORITY_LABEL}
        </span>
        <ToggleGroup
          onValueChange={(value) => {
            const next = value[0];
            if (next) {
              setForm((current) => ({
                ...current,
                priority: next as TaskPriorityId,
              }));
            }
          }}
          value={[form.priority]}
        >
          {TASK_PRIORITIES.map((priority) => (
            <ToggleGroupItem key={priority.id} value={priority.id}>
              {priority.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <DueDateField
        onChange={(next) =>
          setForm((current) => ({ ...current, dueDate: next }))
        }
        value={form.dueDate}
      />
      {/* Assignees write immediately (they need a persisted task id), so the
          picker exists in edit mode only and each toggle fires its own
          optimistic set-assignees rather than waiting for Save. */}
      {mode.kind === "edit" ? (
        <AssigneePicker
          boardId={boardId}
          onChange={(next) => {
            setAssigneeIds(next);
            setAssignees.mutate({ taskId: mode.task.id, userIds: next });
          }}
          value={assigneeIds}
        />
      ) : null}
      <Button disabled={busy || !canSave} onClick={save} type="button">
        {SAVE_TASK_LABEL}
      </Button>
      {/* Delete routes through the deferred-delete flow: the sheet closes, the
          card vanishes, and an undo snackbar holds the real DELETE for ~5s. */}
      {mode.kind === "edit" ? (
        <Button
          onClick={() => {
            deferredDelete.requestDelete(mode.task);
            onOpenChange(false);
          }}
          type="button"
          variant="destructive"
        >
          {DELETE_TASK_LABEL}
        </Button>
      ) : null}
    </div>
  );

  // Keeps a stable accessible name on the dialog while the visible title is an
  // interactive control (an inline editor in edit mode, an input in create).
  const accessibleTitle =
    mode.kind === "create" ? CREATE_TASK_TITLE : mode.task.title;

  const titleField =
    mode.kind === "edit" ? (
      <TaskTitleField onCommit={commitTitle} value={mode.task.title} />
    ) : (
      <Input
        // Autofocus on desktop only. In the mobile Drawer, focusing the field
        // pops the soft keyboard mid-open-animation, which fights vaul's
        // viewport repositioning and makes the sheet jump.
        aria-label={TASK_TITLE_LABEL}
        autoFocus={isDesktop}
        className="h-9 font-semibold text-base"
        onChange={(event) =>
          setForm((current) => ({ ...current, title: event.target.value }))
        }
        placeholder={TASK_TITLE_PLACEHOLDER}
        value={form.title}
      />
    );

  if (isDesktop) {
    return (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent
          className="w-full overflow-y-auto sm:max-w-md"
          side="right"
        >
          <SheetHeader>
            <SheetTitle className="sr-only">{accessibleTitle}</SheetTitle>
            {titleField}
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      {/* dvh, not vh: the dynamic viewport shrinks when the soft keyboard
          opens, so the drawer stays above the keyboard instead of extending
          behind it. With overflow-y-auto + vaul's input repositioning, the
          focused field scrolls into the visible area. */}
      <DrawerContent className="max-h-[90dvh] overflow-y-auto">
        <DrawerHeader>
          <DrawerTitle className="sr-only">{accessibleTitle}</DrawerTitle>
          {titleField}
        </DrawerHeader>
        {body}
        <DrawerClose className="sr-only">{CLOSE_LABEL}</DrawerClose>
      </DrawerContent>
    </Drawer>
  );
}
