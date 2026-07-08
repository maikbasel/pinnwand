import { useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ConfirmSheet } from "@/shared/components/confirm-sheet";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { useDeleteBoard } from "../hooks/use-delete-board";
import { useLeaveBoard } from "../hooks/use-leave-board";
import { useMyBoards } from "../hooks/use-my-boards";
import { useRenameBoard } from "../hooks/use-rename-board";
import {
  BOARD_NOT_FOUND,
  BOARDS_LOAD_ERROR,
  DELETE_BOARD_BUTTON,
  DELETE_BOARD_CONFIRM,
  DELETE_BOARD_TITLE,
  LEAVE_BOARD_BUTTON,
  LEAVE_BOARD_CONFIRM,
  LEAVE_BOARD_TITLE,
  RENAME_LABEL,
  TASKS_PLACEHOLDER,
} from "../lib/copy";
import type { Board } from "../types";
import { BoardSharePanel } from "./board-share-panel";

type BoardHeadingProps = {
  board: Board;
  isOwner: boolean;
};

function BoardHeading({ board, isOwner }: BoardHeadingProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(board.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameBoard = useRenameBoard(board.id);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  function cancel(): void {
    setIsEditing(false);
    setName(board.name);
  }

  async function commit(): Promise<void> {
    // The input stays mounted-but-disabled while pending, and disabling it
    // fires onBlur -> commit again; bail so a single rename never double-fires.
    if (renameBoard.isPending) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed === board.name) {
      cancel();
      return;
    }
    try {
      await renameBoard.mutateAsync({ name: trimmed });
      setIsEditing(false);
    } catch {
      // The optimistic update rolled back and the global toast shows the error;
      // close the editor so the reverted name is shown.
      cancel();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  if (isEditing) {
    return (
      <Input
        aria-label={RENAME_LABEL}
        disabled={renameBoard.isPending}
        onBlur={commit}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={onKeyDown}
        ref={inputRef}
        value={name}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <h1 className="min-w-0 flex-1 truncate font-semibold text-2xl tracking-tight">
        {board.name}
      </h1>
      {isOwner ? (
        <Button
          aria-label={RENAME_LABEL}
          onClick={() => setIsEditing(true)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Pencil className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function DeleteBoardControl({ boardId }: { boardId: string }) {
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  const deleteBoard = useDeleteBoard(boardId);

  async function confirmDelete(): Promise<void> {
    try {
      await deleteBoard.mutateAsync();
    } catch {
      // The global toast surfaces the failure; close so the owner can retry.
      setConfirming(false);
      return;
    }
    setConfirming(false);
    await navigate({ to: "/" });
  }

  return (
    <>
      <Button
        className="w-full"
        onClick={() => setConfirming(true)}
        type="button"
        variant="destructive"
      >
        {DELETE_BOARD_BUTTON}
      </Button>
      <ConfirmSheet
        confirmLabel={DELETE_BOARD_BUTTON}
        confirmTestId="confirm-delete-board"
        description={DELETE_BOARD_CONFIRM}
        onConfirm={confirmDelete}
        onOpenChange={setConfirming}
        open={confirming}
        title={DELETE_BOARD_TITLE}
      />
    </>
  );
}

function LeaveBoardControl({ boardId }: { boardId: string }) {
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  const leaveBoard = useLeaveBoard(boardId);

  async function confirmLeave(): Promise<void> {
    try {
      await leaveBoard.mutateAsync();
    } catch {
      // The global toast surfaces the failure; close so the user can retry.
      setConfirming(false);
      return;
    }
    setConfirming(false);
    await navigate({ to: "/" });
  }

  return (
    <>
      <Button
        className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setConfirming(true)}
        type="button"
        variant="outline"
      >
        {LEAVE_BOARD_BUTTON}
      </Button>
      <ConfirmSheet
        confirmLabel={LEAVE_BOARD_BUTTON}
        confirmTestId="confirm-leave-board"
        description={LEAVE_BOARD_CONFIRM}
        onConfirm={confirmLeave}
        onOpenChange={setConfirming}
        open={confirming}
        title={LEAVE_BOARD_TITLE}
      />
    </>
  );
}

type BoardDetailPageProps = {
  boardId: string;
};

export function BoardDetailPage({ boardId }: BoardDetailPageProps) {
  const { memberships, isPending, isError } = useMyBoards();
  const membership = memberships.find((m) => m.board.id === boardId);

  if (isPending && !membership) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (isError && !membership) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <Alert variant="destructive">
          <AlertDescription>{BOARDS_LOAD_ERROR}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!membership) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        <p className="text-muted-foreground text-sm">{BOARD_NOT_FOUND}</p>
      </div>
    );
  }

  const { board, role } = membership;
  const isOwner = role === "owner";

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <BoardHeading board={board} isOwner={isOwner} />
      <BoardSharePanel board={board} isOwner={isOwner} />
      <Card className="border-dashed bg-muted/30">
        <CardContent className="py-6 text-center text-muted-foreground text-sm">
          {TASKS_PLACEHOLDER}
        </CardContent>
      </Card>
      {isOwner ? (
        <DeleteBoardControl boardId={board.id} />
      ) : (
        <LeaveBoardControl boardId={board.id} />
      )}
    </div>
  );
}
