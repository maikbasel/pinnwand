import { type FormEvent, useState } from "react";
import { ResponsiveDialog } from "@/shared/components/responsive-dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useRenameBoard } from "../hooks/use-rename-board";
import {
  CREATE_BOARD_PLACEHOLDER,
  RENAME_BOARD_SAVE,
  RENAME_BOARD_TITLE,
  RENAME_LABEL,
} from "../lib/copy";
import type { Board } from "../types";

type BoardRenameSurfaceProps = {
  board: Board;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Owner-only rename surface, opened from the board actions menu. Responsive
 * Dialog/Drawer with a single name field; the write is optimistic (rollback +
 * global toast on failure via `useRenameBoard`).
 */
export function BoardRenameSurface({
  board,
  open,
  onOpenChange,
}: BoardRenameSurfaceProps) {
  const [name, setName] = useState(board.name);
  const renameBoard = useRenameBoard(board.id);

  function handleOpenChange(next: boolean): void {
    // Reset the field to the current name whenever the surface reopens, so a
    // cancelled edit does not persist into the next open.
    if (next) {
      setName(board.name);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (renameBoard.isPending) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed === board.name) {
      onOpenChange(false);
      return;
    }
    try {
      await renameBoard.mutateAsync({ name: trimmed });
      onOpenChange(false);
    } catch {
      // The optimistic update rolled back and the global toast shows the
      // error; close so the reverted name is shown.
      onOpenChange(false);
    }
  }

  return (
    <ResponsiveDialog
      onOpenChange={handleOpenChange}
      open={open}
      title={RENAME_BOARD_TITLE}
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Input
          aria-label={RENAME_LABEL}
          disabled={renameBoard.isPending}
          onChange={(event) => setName(event.target.value)}
          placeholder={CREATE_BOARD_PLACEHOLDER}
          value={name}
        />
        <Button
          className="w-full"
          disabled={renameBoard.isPending}
          type="submit"
        >
          {RENAME_BOARD_SAVE}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}
