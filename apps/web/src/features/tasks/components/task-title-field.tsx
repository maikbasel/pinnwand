import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/shared/components/ui/input";
import { TASK_TITLE_LABEL } from "../lib/copy";

/**
 * Click-to-edit task title for the detail sheet header (edit mode). Reads as a
 * heading until clicked, then becomes an input that commits on Enter/blur and
 * cancels on Escape. An emptied or unchanged title reverts without writing —
 * the commit itself is an immediate optimistic update owned by the caller, so
 * the title is decoupled from the sheet's Speichern button.
 */
export function TaskTitleField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the display in sync when the task title changes underneath us (a
  // realtime edit from the other user, or the reconciling refetch) while we are
  // not actively editing.
  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next === "" || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        aria-label={TASK_TITLE_LABEL}
        className="h-9 font-semibold text-base"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        ref={inputRef}
        value={draft}
      />
    );
  }

  return (
    <button
      className="group -mx-2 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-semibold text-base text-foreground transition-colors hover:bg-muted"
      onClick={() => setEditing(true)}
      type="button"
    >
      <span className="min-w-0 break-words">{value}</span>
      <Pencil
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
      />
    </button>
  );
}
