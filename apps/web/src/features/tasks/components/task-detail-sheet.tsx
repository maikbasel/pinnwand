import {
  TASK_COLUMNS,
  TASK_PRIORITIES,
  type TaskColumnId,
  type TaskPriorityId,
} from "@pinnwand/contracts";
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
import { useCreateTask } from "../hooks/use-create-task";
import { useMoveTask } from "../hooks/use-move-task";
import { useSetAssignees } from "../hooks/use-set-assignees";
import { type UpdateTaskVars, useUpdateTask } from "../hooks/use-update-task";
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

  // Only create has a submit button to gate; edit mode auto-saves every field.
  const busy = createTask.isPending;
  const canCreate = form.title.trim() !== "";

  // Edit mode auto-saves each field the moment it changes, one patch per field,
  // mirroring how the inline title and the assignees already write on their own.
  // Fire-and-forget: updateTask patches the cache optimistically and rolls back
  // with the global toast on failure. A no-op in create mode, where fields are
  // collected in `form` and inserted together by `createFromForm`.
  function patchTaskField(patch: Omit<UpdateTaskVars, "taskId">): void {
    if (mode.kind !== "edit") {
      return;
    }
    updateTask.mutate({ taskId: mode.task.id, ...patch });
  }

  // Inline title commit (edit mode): an immediate optimistic write, decoupled
  // from the rest, sending only the title.
  function commitTitle(nextTitle: string): void {
    patchTaskField({ title: nextTitle });
  }

  async function createFromForm(): Promise<void> {
    const title = form.title.trim();
    if (busy || title === "") {
      return;
    }
    try {
      await createTask.mutateAsync({
        column: form.column,
        title,
        description: form.description,
        priority: form.priority,
        dueDate: form.dueDate === "" ? null : form.dueDate,
      });
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
          // Persist on blur, not per keystroke: one write when the user leaves
          // the field, and only if it actually changed.
          onBlur={() => {
            if (
              mode.kind === "edit" &&
              form.description !== mode.task.description
            ) {
              patchTaskField({ description: form.description });
            }
          }}
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
            if (!next || next === form.column) {
              return;
            }
            const column = next as TaskColumnId;
            setForm((current) => ({ ...current, column }));
            // A column change is a move: it recomputes position in the target
            // column, so it goes through moveTask rather than a field patch.
            if (mode.kind === "edit") {
              moveTask.mutate({ taskId: mode.task.id, toColumn: column });
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
            if (!next || next === form.priority) {
              return;
            }
            const priority = next as TaskPriorityId;
            setForm((current) => ({ ...current, priority }));
            patchTaskField({ priority });
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
        onChange={(next) => {
          setForm((current) => ({ ...current, dueDate: next }));
          patchTaskField({ dueDate: next === "" ? null : next });
        }}
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
      {/* Create collects the whole form behind one submit (the task does not
          exist yet). Edit mode has no Save button: every field auto-saves. */}
      {mode.kind === "create" ? (
        <Button
          disabled={busy || !canCreate}
          onClick={createFromForm}
          type="button"
        >
          {SAVE_TASK_LABEL}
        </Button>
      ) : null}
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
          behind it. */}
      <DrawerContent className="max-h-[90dvh]">
        <DrawerHeader>
          <DrawerTitle className="sr-only">{accessibleTitle}</DrawerTitle>
          {titleField}
        </DrawerHeader>
        {/* The scroll lives on this inner div, not on DrawerContent: vaul tags
            the content root role="dialog" and its drag-gesture handling locks
            onto touches that start there, starving native scroll (the form
            below the fold becomes unreachable). A plain scrollable child keeps
            the header pinned and lets the fields scroll. min-h-0 lets the flex
            child shrink so overflow engages; the safe-area inset keeps the last
            action clear of the iOS home indicator. */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {body}
        </div>
        <DrawerClose className="sr-only">{CLOSE_LABEL}</DrawerClose>
      </DrawerContent>
    </Drawer>
  );
}
