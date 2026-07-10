import type { TaskColumnId } from "@pinnwand/contracts";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useCreateTask } from "../hooks/use-create-task";
import {
  ADD_TASK_SUBMIT,
  CANCEL_LABEL,
  TASK_TITLE_PLACEHOLDER,
} from "../lib/copy";

// Trello-style inline quick-add: type a card title directly in the column and
// submit. Stays open and refocused after each add for rapid entry; an empty
// blur or Escape closes it. Full edit (priority/due/assignees) lives in the
// task detail sheet.
export function TaskComposer({
  boardId,
  column,
  onClose,
}: {
  boardId: string;
  column: TaskColumnId;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const { create, isPending } = useCreateTask(boardId);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    create(column, trimmed);
    setTitle("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      onClose();
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <Input
        aria-label={TASK_TITLE_PLACEHOLDER}
        autoFocus
        onBlur={() => {
          if (!title.trim()) {
            onClose();
          }
        }}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={TASK_TITLE_PLACEHOLDER}
        ref={inputRef}
        value={title}
      />
      <div className="flex items-center gap-2">
        <Button disabled={isPending} size="sm" type="submit">
          {ADD_TASK_SUBMIT}
        </Button>
        <Button onClick={onClose} size="sm" type="button" variant="ghost">
          {CANCEL_LABEL}
        </Button>
      </div>
    </form>
  );
}
